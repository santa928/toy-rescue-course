import fs from 'node:fs';
import { chromium } from 'playwright';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:5173';
const outputDirectory = 'output/voxel-game';
fs.mkdirSync(outputDirectory, { recursive: true });
const results = {};

/** 指定した描画frame数だけ待ち、物理とR3Fの更新を短い入力burst単位で進める。 */
async function waitForFrames(page, frameCount) {
  await page.evaluate(
    (count) => new Promise((resolve) => {
      let remaining = count;
      const tick = () => {
        remaining -= 1;
        if (remaining <= 0) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
    frameCount,
  );
}

/** 公開text hookから車両telemetryを含む現在状態を読む。 */
async function readGameState(page) {
  const renderedState = await page.evaluate(() => window.render_game_to_text?.());
  if (!renderedState) {
    throw new Error('Voxel Game text state is unavailable.');
  }
  const state = JSON.parse(renderedState);
  if (!state.vehicle) {
    throw new Error('Voxel Game vehicle telemetry is unavailable.');
  }
  return state;
}

/** resetとtelemetry読取を同じbrowser taskで行い、次frameの重力step前を観測する。 */
async function resetAndReadGameState(page) {
  const renderedState = await page.evaluate(() => {
    window.reset_voxel_game_vehicle?.();
    return window.render_game_to_text?.();
  });
  if (!renderedState) {
    throw new Error('Voxel Game text state is unavailable after reset.');
  }
  return JSON.parse(renderedState);
}

/** 3次元vector間のユークリッド距離を返す。 */
function vectorDistance(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

/** 車庫内で西へ向きを変え、南側道路上の目視しやすい位置まで走らせる。 */
async function prepareRoadScreenshot(page) {
  const initialState = await readGameState(page);
  await page.keyboard.down('KeyA');
  try {
    for (let frame = 0; frame < 60; frame += 1) {
      await waitForFrames(page, 3);
      const state = await readGameState(page);
      if (state.vehicle.resetCount !== initialState.vehicle.resetCount) {
        throw new Error(`Vehicle reset while turning toward the road (${JSON.stringify(state.vehicle)}).`);
      }
      if (state.vehicle.forward[0] <= -0.97) break;
      if (frame === 59) throw new Error('Vehicle did not turn toward the west road within 180 frames.');
    }
  } finally {
    await page.keyboard.up('KeyA');
  }

  await page.keyboard.down('KeyW');
  try {
    for (let frame = 0; frame < 80; frame += 1) {
      await waitForFrames(page, 3);
      const state = await readGameState(page);
      if (state.vehicle.resetCount !== initialState.vehicle.resetCount) {
        throw new Error(`Vehicle reset before reaching the west road (${JSON.stringify(state.vehicle)}).`);
      }
      if (state.vehicle.position[0] <= -10) return state;
    }
  } finally {
    await page.keyboard.up('KeyW');
  }
  throw new Error('Vehicle did not reach the west road within 240 frames.');
}

/** 2枚のPNGを粗く比較し、世界全体がcamera yawで回転していないかを数値化する。 */
async function imageDifferenceRatio(page, before, after) {
  return page.evaluate(async ({ afterBase64, beforeBase64 }) => {
    const decode = async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    };
    const [beforePixels, afterPixels] = await Promise.all([
      decode(beforeBase64),
      decode(afterBase64),
    ]);
    let changed = 0;
    let sampled = 0;
    for (let index = 0; index < beforePixels.length; index += 16) {
      sampled += 1;
      const difference = Math.abs(beforePixels[index] - afterPixels[index])
        + Math.abs(beforePixels[index + 1] - afterPixels[index + 1])
        + Math.abs(beforePixels[index + 2] - afterPixels[index + 2]);
      if (difference > 36) changed += 1;
    }
    return changed / sampled;
  }, {
    afterBase64: after.toString('base64'),
    beforeBase64: before.toString('base64'),
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { height: 720, width: 1280 } });
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') {
    errors.push(message.text());
  }
});
page.on('pageerror', (error) => errors.push(String(error)));

try {
  await page.goto(`${baseUrl}/voxel-game.html?verify=${Date.now()}`, {
    waitUntil: 'networkidle',
  });
  await page.locator('.voxel-game-canvas canvas').waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => document.documentElement.dataset.voxelSceneReady === 'true',
    undefined,
    { timeout: 3000 },
  );
  const initialState = await readGameState(page);
  results.initial = initialState.vehicle;
  if (initialState.mode !== 'drive-ready') {
    throw new Error(`Voxel Game mode is not drive-ready (${String(initialState.mode)}).`);
  }
  if (initialState.vehicle.forward[2] < 0.99) {
    throw new Error(`Vehicle initial forward is not aligned with the garage opening (${initialState.vehicle.forward.join(', ')}).`);
  }

  await page.keyboard.down('KeyW');
  await waitForFrames(page, 30);
  await page.keyboard.up('KeyW');
  const afterForward = await readGameState(page);
  results.afterForward = afterForward.vehicle;
  if (vectorDistance(initialState.vehicle.position, afterForward.vehicle.position) < 0.35) {
    throw new Error('W burst did not move the vehicle forward.');
  }
  if (afterForward.vehicle.speed < 0.5) {
    throw new Error(`W burst did not accelerate the vehicle (${afterForward.vehicle.speed}).`);
  }

  await page.keyboard.down('KeyA');
  await waitForFrames(page, 18);
  await page.keyboard.up('KeyA');
  const afterSteer = await readGameState(page);
  results.afterSteer = afterSteer.vehicle;
  if (vectorDistance(afterForward.vehicle.forward, afterSteer.vehicle.forward) < 0.04) {
    throw new Error('A burst did not change the vehicle forward vector.');
  }
  if (afterSteer.vehicle.speed >= afterForward.vehicle.speed - 0.1) {
    throw new Error(`A burst did not release throttle and decelerate (${afterForward.vehicle.speed} -> ${afterSteer.vehicle.speed}).`);
  }

  await waitForFrames(page, 30);
  const afterCoast = await readGameState(page);
  results.afterCoast = afterCoast.vehicle;
  if (afterCoast.vehicle.speed > afterSteer.vehicle.speed + 0.05) {
    throw new Error(`No-input burst accelerated the vehicle (${afterSteer.vehicle.speed} -> ${afterCoast.vehicle.speed}).`);
  }

  const resetCountBefore = afterCoast.vehicle.resetCount;
  const afterResetImmediate = await resetAndReadGameState(page);
  results.afterReset = afterResetImmediate.vehicle;
  if (afterResetImmediate.vehicle.resetCount !== resetCountBefore + 1) {
    throw new Error(`Vehicle reset count did not increment (${resetCountBefore} -> ${afterResetImmediate.vehicle.resetCount}).`);
  }
  if (vectorDistance(afterResetImmediate.vehicle.position, initialState.landmarks.garage) > 0.001) {
    throw new Error(`Vehicle did not reset at the garage (${afterResetImmediate.vehicle.position.join(', ')}).`);
  }
  await waitForFrames(page, 3);
  const afterResetSettled = await readGameState(page);
  if (Math.hypot(
    afterResetSettled.vehicle.position[0] - initialState.landmarks.garage[0],
    afterResetSettled.vehicle.position[2] - initialState.landmarks.garage[2],
  ) > 0.15) {
    throw new Error(`Vehicle left the garage after reset (${afterResetSettled.vehicle.position.join(', ')}).`);
  }

  await prepareRoadScreenshot(page);
  await waitForFrames(page, 30);
  const cameraDriveState = await readGameState(page);
  if (cameraDriveState.vehicle.resetCount !== afterResetImmediate.vehicle.resetCount
    || cameraDriveState.vehicle.position[0] > -9.5) {
    throw new Error(`Camera scenario did not stop on the west road (${JSON.stringify(cameraDriveState.vehicle)}).`);
  }
  const cameraBeforeTurn = await page.locator('.voxel-game-canvas canvas').screenshot();
  await page.keyboard.down('KeyA');
  await waitForFrames(page, 18);
  await page.keyboard.up('KeyA');
  await waitForFrames(page, 30);
  const cameraAfterTurn = await page.locator('.voxel-game-canvas canvas').screenshot();
  const worldTurnDifference = await imageDifferenceRatio(page, cameraBeforeTurn, cameraAfterTurn);
  results.worldTurnDifference = worldTurnDifference;
  if (worldTurnDifference > 0.16) {
    throw new Error(`Camera rotated with vehicle yaw (${worldTurnDifference.toFixed(3)} image difference).`);
  }

  await page.screenshot({ path: `${outputDirectory}/drive-desktop.png` });
  const canvasScreenshot = await page.locator('.voxel-game-canvas canvas').screenshot();
  const sampledColorCount = await page.evaluate(async (base64Screenshot) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64Screenshot}`;
    await image.decode();
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = image.width;
    sampleCanvas.height = image.height;
    const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return 0;
    }
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
    const colors = new Set();
    for (let y = 0; y < sampleCanvas.height; y += 40) {
      for (let x = 0; x < sampleCanvas.width; x += 40) {
        const index = (y * sampleCanvas.width + x) * 4;
        colors.add(`${pixels[index]}:${pixels[index + 1]}:${pixels[index + 2]}`);
      }
    }
    return colors.size;
  }, canvasScreenshot.toString('base64'));
  if (sampledColorCount < 5) {
    throw new Error(`Voxel Game canvas is visually empty (${sampledColorCount} sampled colors).`);
  }

  const mobilePage = await browser.newPage({ viewport: { height: 390, width: 844 } });
  mobilePage.on('console', (message) => {
    if (message.type() === 'error') errors.push(`mobile: ${message.text()}`);
  });
  mobilePage.on('pageerror', (error) => errors.push(`mobile: ${String(error)}`));
  try {
    await mobilePage.goto(`${baseUrl}/voxel-game.html?verify-mobile=${Date.now()}`, {
      waitUntil: 'networkidle',
    });
    await mobilePage.waitForFunction(
      () => document.documentElement.dataset.voxelSceneReady === 'true',
      undefined,
      { timeout: 3000 },
    );
    await prepareRoadScreenshot(mobilePage);
    await waitForFrames(mobilePage, 30);
    results.mobileLandscape = (await readGameState(mobilePage)).vehicle;
    if (results.mobileLandscape.resetCount !== 0 || results.mobileLandscape.position[0] > -9.5) {
      throw new Error(`Mobile screenshot scenario did not stop on the west road (${JSON.stringify(results.mobileLandscape)}).`);
    }
    await mobilePage.screenshot({ path: `${outputDirectory}/drive-mobile-landscape.png` });
  } finally {
    await mobilePage.close();
  }
  if (errors.length > 0) {
    throw new Error(`Voxel Game browser errors: ${errors.join(' | ')}`);
  }
  fs.writeFileSync(`${outputDirectory}/task4-results.json`, `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import * as THREE from 'three';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:5173';
const additionalBlocksOnly = process.env.TASK6_ADDITIONAL_BLOCKS_ONLY === '1';
const outputDirectory = 'output/voxel-game';
const BLOCK_PLAZA_BOUNDS = { maxX: -6, maxZ: 7, minX: -13, minZ: -7 };
fs.mkdirSync(outputDirectory, { recursive: true });

/** R3FとRapierを指定frame数だけ通常clockで進める。 */
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

/** 公開text hookから車両・runtime・Rapier破片telemetryを読む。 */
async function readGameState(page) {
  const rendered = await page.evaluate(() => window.render_game_to_text?.());
  if (!rendered) throw new Error('Voxel Game text state is unavailable.');
  const state = JSON.parse(rendered);
  assert(state.runtime && state.vehicle && state.breakables, `Task6 telemetry is incomplete: ${rendered}`);
  return state;
}

/** 次のtimer macrotask後のactual telemetryを読む。 */
async function readGameStateAfterMacrotask(page) {
  const rendered = await page.evaluate(() => new Promise((resolve) => {
    setTimeout(() => resolve(window.render_game_to_text?.()), 0);
  }));
  if (!rendered) throw new Error('Voxel Game text state is unavailable after macrotask.');
  return JSON.parse(rendered);
}

/** Task 5と同じ実camera telemetryでworld-space cubeをscreen-space矩形へ投影する。 */
function projectWorldCubeToScreenRect(cameraTelemetry, cube) {
  assert(cameraTelemetry?.position && cameraTelemetry?.lookTarget && cameraTelemetry?.viewport,
    `Camera telemetry is unavailable: ${JSON.stringify(cameraTelemetry)}`);
  const { height, width } = cameraTelemetry.viewport;
  const camera = new THREE.OrthographicCamera(width / -2, width / 2, height / 2, height / -2);
  camera.position.fromArray(cameraTelemetry.position);
  camera.zoom = cameraTelemetry.zoom;
  camera.lookAt(new THREE.Vector3(...cameraTelemetry.lookTarget));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const rect = {
    bottom: Number.NEGATIVE_INFINITY,
    left: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    top: Number.POSITIVE_INFINITY,
  };
  const corner = new THREE.Vector3();
  for (const xSign of [-1, 1]) {
    for (const ySign of [-1, 1]) {
      for (const zSign of [-1, 1]) {
        corner.set(
          cube.position[0] + (cube.scale[0] / 2) * xSign,
          cube.position[1] + (cube.scale[1] / 2) * ySign,
          cube.position[2] + (cube.scale[2] / 2) * zSign,
        ).project(camera);
        const x = (corner.x + 1) * width / 2;
        const y = (1 - corner.y) * height / 2;
        rect.left = Math.min(rect.left, x);
        rect.right = Math.max(rect.right, x);
        rect.top = Math.min(rect.top, y);
        rect.bottom = Math.max(rect.bottom, y);
      }
    }
  }
  return { ...rect, height: rect.bottom - rect.top, width: rect.right - rect.left };
}

/** 2矩形が重なると0、離れていれば最短screen-space距離を返す。 */
function getScreenRectDistance(first, second) {
  const horizontalGap = Math.max(first.left - second.right, second.left - first.right, 0);
  const verticalGap = Math.max(first.top - second.bottom, second.top - first.bottom, 0);
  return Math.hypot(horizontalGap, verticalGap);
}

/** actual body位置から指定block6片の画面分離、他block距離、viewport/広場内包を測る。 */
function measureFragmentVisualSeparation(state, blockId = 'plaza-red', requireViewport = true) {
  const fragments = state.breakables.activeFragments
    ?.filter(({ id }) => id.startsWith(`${blockId}:`));
  if (!Array.isArray(fragments) || fragments.length !== 6) {
    return { ready: false, reason: `Expected six actual active fragment positions: ${JSON.stringify(fragments)}` };
  }
  const fragmentRects = fragments.map((fragment) => projectWorldCubeToScreenRect(state.camera, fragment));
  const fragmentGaps = [];
  for (let first = 0; first < fragmentRects.length; first += 1) {
    for (let second = first + 1; second < fragmentRects.length; second += 1) {
      fragmentGaps.push(getScreenRectDistance(fragmentRects[first], fragmentRects[second]));
    }
  }
  const intactRects = state.landmarks.breakableBlocks
    .filter(({ id }) => id !== blockId)
    .map(({ position }) => projectWorldCubeToScreenRect(state.camera, {
      position,
      scale: [1.5, 1.5, 1.5],
    }));
  const intactGaps = fragmentRects.flatMap((fragmentRect) => (
    intactRects.map((intactRect) => getScreenRectDistance(fragmentRect, intactRect))
  ));
  const bounds = {
    bottom: Math.max(...fragmentRects.map(({ bottom }) => bottom)),
    left: Math.min(...fragmentRects.map(({ left }) => left)),
    right: Math.max(...fragmentRects.map(({ right }) => right)),
    top: Math.min(...fragmentRects.map(({ top }) => top)),
  };
  const minFragmentGap = Math.min(...fragmentGaps);
  const minIntactGap = Math.min(...intactGaps);
  const allInsidePlaza = fragments.every(({ position, scale }) => (
    position[0] - scale[0] / 2 >= BLOCK_PLAZA_BOUNDS.minX
    && position[0] + scale[0] / 2 <= BLOCK_PLAZA_BOUNDS.maxX
    && position[2] - scale[2] / 2 >= BLOCK_PLAZA_BOUNDS.minZ
    && position[2] + scale[2] / 2 <= BLOCK_PLAZA_BOUNDS.maxZ
  ));
  const otherBlockPhases = state.runtime.blocks
    .filter(({ id }) => id !== blockId)
    .map(({ id, phase }) => ({ id, phase }));
  const otherBlockImpacts = state.breakables.blocks
    .filter(({ id }) => id !== blockId)
    .map(({ id, impactCount }) => ({ id, impactCount }));
  const otherBlocksUntouched = otherBlockPhases.every(({ phase }) => phase === 'intact')
    && otherBlockImpacts.every(({ impactCount }) => impactCount === 0);
  const viewport = state.camera.viewport;
  const allInsideViewport = bounds.left >= 0 && bounds.top >= 0
    && bounds.right <= viewport.width && bounds.bottom <= viewport.height;
  return {
    allInsideViewport,
    allInsidePlaza,
    bounds,
    camera: state.camera,
    fragmentRects,
    minFragmentGap,
    minIntactGap,
    otherBlockImpacts,
    otherBlockPhases,
    otherBlocksUntouched,
    positions: fragments.map(({ id, position }) => ({ id, position })),
    ready: (!requireViewport || allInsideViewport) && allInsidePlaza && minFragmentGap >= 2 && minIntactGap >= 2
      && otherBlocksUntouched,
  };
}

/** 1.2秒の表示窓内で、actual 6片すべてが視覚分離する最初のframeを返す。 */
async function waitForFragmentVisualSeparation(page, blockId = 'plaza-red', requireViewport = true) {
  let latestMeasurement = { ready: false, reason: 'No fragment frame observed.' };
  for (let frame = 0; frame < 65; frame += 1) {
    await waitForFrames(page, 1);
    const state = await readGameState(page);
    const activeRedFragments = state.breakables.activeFragments
      ?.filter(({ id }) => id.startsWith(`${blockId}:`));
    if (activeRedFragments?.length !== 6) continue;
    latestMeasurement = measureFragmentVisualSeparation(state, blockId, requireViewport);
    if (latestMeasurement.ready) return { measurement: latestMeasurement, state };
  }
  throw new Error(`${blockId} fragments never became visually separated: ${JSON.stringify(latestMeasurement)}`);
}

/** scene ready、公開hook、24-slot pool準備まで待つ。 */
async function openGamePage(
  browser,
  scenario,
  errors,
  viewport = { height: 720, width: 1280 },
) {
  const page = await browser.newPage({ viewport });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`${scenario}: ${message.text()}`);
      console.error(`${scenario}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    errors.push(`${scenario}: ${String(error)}`);
    console.error(`${scenario}: ${String(error)}`);
  });
  await page.goto(`${baseUrl}/voxel-game.html?task6=${scenario}-${Date.now()}`, { waitUntil: 'networkidle' });
  await page.locator('.voxel-game-canvas canvas').waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => {
      const rendered = window.render_game_to_text?.();
      if (document.documentElement.dataset.voxelSceneReady !== 'true' || !rendered) return false;
      const pool = JSON.parse(rendered).breakables;
      return pool?.poolSlotCount === 24
        && pool.mountedColliderCount === 24
        && pool.mountedMeshCount === 24;
    },
    undefined,
    { timeout: 5_000 },
  );
  const state = await readGameState(page);
  assert.equal(state.breakables.activeFragmentCount, 0, `${scenario}: fragments start active.`);
  assert.equal(state.breakables.collisionEnabledFragmentCount, 0, `${scenario}: fragment colliders start enabled.`);
  assert.equal(state.breakables.enabledBodyCount, 0, `${scenario}: fragment bodies start enabled.`);
  assert.equal(state.breakables.sleepingFragmentCount, 24, `${scenario}: inactive fragment bodies are not sleeping.`);
  assert.equal(state.breakables.uniqueBodyHandleCount, 24, `${scenario}: fragment body handles are not unique.`);
  assert.equal(state.breakables.uniqueColliderHandleCount, 24, `${scenario}: fragment collider handles are not unique.`);
  assert.equal(state.breakables.uniqueMeshUuidCount, 24, `${scenario}: fragment mesh UUIDs are not unique.`);
  assert.equal(state.visuals.intactBlockCount, 4, `${scenario}: intact block count is not four.`);
  return page;
}

/** 西側道路の中央まで実走し、積み木広場4個を同時に見渡せる視点を作る。 */
async function driveToBlockPlazaOverview(page) {
  await driveUntil(page, (state) => state.vehicle.position[2] >= 15.2, 'plaza overview garage exit');
  await brakeVehicle(page);
  await turnVehicleToward(page, -1, 0);
  await driveUntil(page, (state) => state.vehicle.position[0] <= -16.1, 'plaza overview west road');
  await brakeVehicle(page);
  await turnVehicleToward(page, 0, -1);
  await driveUntil(page, (state) => state.vehicle.position[2] <= 1.2, 'plaza overview northbound');
  await brakeVehicle(page);
  await turnVehicleToward(page, 1, 0);
  await driveUntil(page, (state) => state.vehicle.position[0] >= -12.4, 'plaza overview eastbound');
  await brakeVehicle(page);
  await waitForFrames(page, 15);
}

/** 4 blockの実camera投影がviewport内に収まることを数値で確認する。 */
function measureBlockPlazaVisibility(state, hudControlRects) {
  const rects = state.landmarks.breakableBlocks.map(({ id, position }) => ({
    id,
    rect: projectWorldCubeToScreenRect(state.camera, { position, scale: [1.5, 1.5, 1.5] }),
  }));
  const { height, width } = state.camera.viewport;
  const minimumViewportMargin = Math.min(...rects.flatMap(({ rect }) => [
    rect.left,
    rect.top,
    width - rect.right,
    height - rect.bottom,
  ]));
  const screenRectGap = (first, second) => Math.hypot(
    Math.max(first.left - second.right, second.left - first.right, 0),
    Math.max(first.top - second.bottom, second.top - first.bottom, 0),
  );
  const minimumHudControlGap = Math.min(...rects.flatMap(({ rect }) => (
    hudControlRects.map((control) => screenRectGap(rect, control))
  )));
  return {
    allInsideViewport: rects.every(({ rect }) => (
      rect.left >= 0 && rect.top >= 0 && rect.right <= width && rect.bottom <= height
    )),
    camera: state.camera,
    minimumHudControlGap,
    minimumViewportMargin,
    rects,
  };
}

/** throttleを離した自然減速で次の旋回・接近を安定させる。 */
async function brakeVehicle(page) {
  for (let frame = 0; frame < 150; frame += 1) {
    await waitForFrames(page, 1);
    if ((await readGameState(page)).vehicle.speed < 0.24) return;
  }
  throw new Error('Vehicle did not stop within 150 idle frames.');
}

/** 現在位置で左右入力だけを使い、指定世界方向へ消防車を向ける。 */
async function turnVehicleToward(page, targetX, targetZ) {
  const targetLength = Math.hypot(targetX, targetZ) || 1;
  const normalizedTargetX = targetX / targetLength;
  const normalizedTargetZ = targetZ / targetLength;
  for (let attempt = 0; attempt < 220; attempt += 1) {
    const state = await readGameState(page);
    const [forwardX, , forwardZ] = state.vehicle.forward;
    if (forwardX * normalizedTargetX + forwardZ * normalizedTargetZ >= 0.9995) return;
    const currentAngle = Math.atan2(forwardX, forwardZ);
    const targetAngle = Math.atan2(normalizedTargetX, normalizedTargetZ);
    const delta = Math.atan2(Math.sin(targetAngle - currentAngle), Math.cos(targetAngle - currentAngle));
    const key = delta >= 0 ? 'KeyD' : 'KeyA';
    await page.keyboard.down(key);
    await waitForFrames(page, 1);
    await page.keyboard.up(key);
    await waitForFrames(page, 1);
  }
  throw new Error(`Vehicle did not turn toward [${targetX}, ${targetZ}].`);
}

/** Wの公開keyboard経路だけで指定座標条件まで走る。 */
async function driveUntil(page, predicate, description, maxBursts = 180) {
  const initialResetCount = (await readGameState(page)).vehicle.resetCount;
  await page.keyboard.down('KeyW');
  try {
    for (let burst = 0; burst < maxBursts; burst += 1) {
      await waitForFrames(page, 2);
      const state = await readGameState(page);
      if (predicate(state)) return state;
      assert.equal(state.vehicle.resetCount, initialResetCount, `${description}: vehicle reset unexpectedly.`);
    }
    throw new Error(`${description}: destination was not reached.`);
  } finally {
    await page.keyboard.up('KeyW');
  }
}

/** 車庫から外周西端を実走し、他blockを避けて赤block西側へ東向きで出る。 */
async function driveToRedBlockApproach(page) {
  const initialState = await readGameState(page);
  const redPosition = initialState.landmarks.breakableBlocks
    .find(({ id }) => id === 'plaza-red')?.position;
  assert(redPosition, 'Red block landmark is unavailable.');
  await driveUntil(page, (state) => state.vehicle.position[2] >= 15.2, 'garage exit');
  await brakeVehicle(page);
  await turnVehicleToward(page, -1, 0);
  await driveUntil(page, (state) => state.vehicle.position[0] <= -16.1, 'west road outer edge');
  await brakeVehicle(page);
  await turnVehicleToward(page, 0, -1);
  await driveUntil(
    page,
    (state) => state.vehicle.position[2] <= redPosition[2] + 1.7,
    'red block west side',
  );
  await brakeVehicle(page);
  await turnVehicleToward(page, 1, 0);
  return readGameState(page);
}

/** 車庫から他blockを避け、指定blockへ東西いずれかの開けた側から接近する。 */
async function driveToBlockApproach(page, blockId) {
  if (blockId === 'plaza-red') return driveToRedBlockApproach(page);
  const initialState = await readGameState(page);
  const target = initialState.landmarks.breakableBlocks.find(({ id }) => id === blockId)?.position;
  assert(target, `${blockId} landmark is unavailable.`);
  await driveUntil(page, (state) => state.vehicle.position[2] >= 15.2, `${blockId} garage exit`);
  await brakeVehicle(page);

  if (blockId === 'plaza-green') {
    await turnVehicleToward(page, -1, 0);
    await driveUntil(page, (state) => state.vehicle.position[0] <= -16.1, `${blockId} west road`);
    await brakeVehicle(page);
    await turnVehicleToward(page, 0, -1);
    await driveUntil(page, (state) => state.vehicle.position[2] <= target[2] + 1.7, `${blockId} west side`);
    await brakeVehicle(page);
    await turnVehicleToward(page, 1, 0);
  } else {
    await turnVehicleToward(page, 0, -1);
    await driveUntil(page, (state) => state.vehicle.position[2] <= target[2], `${blockId} east side latitude`);
    await brakeVehicle(page);
    await turnVehicleToward(page, -1, 0);
  }
  return readGameState(page);
}

/** 公開keyboard経路の有効速度衝突で指定blockだけがbrokenになるまで待つ。 */
async function collideBlockAtEffectiveSpeed(page, blockId) {
  await page.keyboard.down('KeyW');
  try {
    return await page.evaluate((targetBlockId) => new Promise((resolve, reject) => {
      let frameCount = 0;
      const tick = () => {
        frameCount += 1;
        const rendered = window.render_game_to_text?.();
        if (!rendered) {
          reject(new Error('Voxel Game text state is unavailable during all-block collision.'));
          return;
        }
        const state = JSON.parse(rendered);
        const targetBroken = state.runtime.blocks.find(({ id }) => id === targetBlockId)?.phase === 'broken';
        const targetFragmentsActive = state.breakables.activeFragments
          ?.filter(({ id }) => id.startsWith(`${targetBlockId}:`)).length === 6;
        if (targetBroken && targetFragmentsActive) {
          window.reset_voxel_game_vehicle?.();
          resolve(state);
          return;
        }
        if (frameCount >= 240) {
          reject(new Error(`${targetBlockId} did not break through actual vehicle collision: ${JSON.stringify({
            block: state.breakables.blocks.find(({ id }) => id === targetBlockId),
            vehicle: state.vehicle,
          })}`));
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }), blockId);
  } finally {
    await page.keyboard.up('KeyW');
  }
}

/** 有効速度で赤blockへ衝突し、physics event経由のbrokenを待つ。 */
async function collideAtEffectiveSpeed(page) {
  let lastState = await readGameState(page);
  const startVehicle = lastState.vehicle;
  await page.keyboard.down('KeyW');
  try {
    for (let burst = 0; burst < 100; burst += 1) {
      await waitForFrames(page, 2);
      const state = await readGameState(page);
      lastState = state;
      const red = state.runtime.blocks.find(({ id }) => id === 'plaza-red');
      if (red?.phase === 'broken') return state;
    }
    throw new Error(`Effective real-vehicle collision did not break plaza-red: ${JSON.stringify({
      red: lastState.breakables.blocks.find(({ id }) => id === 'plaza-red'),
      runtime: lastState.runtime.blocks.find(({ id }) => id === 'plaza-red'),
      startVehicle,
      vehicle: lastState.vehicle,
    })}`);
  } finally {
    await page.keyboard.up('KeyW');
  }
}

/** page内rAFで実車破壊を待ち、3810→3800msのtimerとscene frameを決定的に観測する。 */
async function collideAtEffectiveSpeedThroughTimer(page) {
  await page.keyboard.down('KeyW');
  try {
    return await page.evaluate(() => new Promise((resolve, reject) => {
      let frameCount = 0;
      const read = () => {
        const rendered = window.render_game_to_text?.();
        if (!rendered) throw new Error('Voxel Game text state is unavailable during collision timer chain.');
        return JSON.parse(rendered);
      };
      const tick = () => {
        frameCount += 1;
        if (frameCount > 600) {
          reject(new Error('Effective real-vehicle collision did not break plaza-red within 600 frames.'));
          return;
        }
        const broken = read();
        const brokenBlock = broken.runtime.blocks.find(({ id }) => id === 'plaza-red');
        if (brokenBlock?.phase !== 'broken') {
          requestAnimationFrame(tick);
          return;
        }
        if (broken.breakables.activeFragmentCount !== 6) {
          requestAnimationFrame(tick);
          return;
        }
        window.advanceTime?.(Math.max(0, brokenBlock.respawnRemainingMs - 3_810));
        requestAnimationFrame(() => {
          const almostExpired = read();
          window.advanceTime?.(10);
          requestAnimationFrame(() => {
            setTimeout(() => resolve({
              almostExpired,
              broken,
              expired: read(),
            }), 0);
          });
        });
      };
      requestAnimationFrame(tick);
    }));
  } finally {
    await page.keyboard.up('KeyW');
  }
}

/** 赤block中心と車両のXZ距離を返す。 */
function distanceFromRedBlock(state) {
  const redPosition = state.landmarks.breakableBlocks
    .find(({ id }) => id === 'plaza-red')?.position;
  assert(redPosition, 'Red block landmark is unavailable.');
  return Math.hypot(
    state.vehicle.position[0] - redPosition[0],
    state.vehicle.position[2] - redPosition[2],
  );
}

/** clear側で期限直前まで進めてから実keyboardで半径3内へ入り、0msでbroken維持後に離れる。 */
async function verifySafeRestoreBoundary(page) {
  await page.keyboard.down('KeyS');
  try {
    for (let frame = 0; frame < 180; frame += 1) {
      await waitForFrames(page, 1);
      if (distanceFromRedBlock(await readGameState(page)) > 4.2) break;
      if (frame === 179) throw new Error('Vehicle did not leave red respawn radius before deadline setup.');
    }
  } finally {
    await page.keyboard.up('KeyS');
  }
  await brakeVehicle(page);
  const outside = await readGameState(page);
  assert(distanceFromRedBlock(outside) > 4.2, 'Vehicle is not safely outside red respawn radius.');
  const beforeDeadlineBlock = outside.runtime.blocks.find(({ id }) => id === 'plaza-red');
  await windowAdvance(page, Math.max(0, (beforeDeadlineBlock?.respawnRemainingMs ?? 0) - 3_000));
  const justBeforeDeadline = await readGameState(page);
  assert.equal(justBeforeDeadline.runtime.blocks.find(({ id }) => id === 'plaza-red')?.phase, 'broken');
  assert(distanceFromRedBlock(justBeforeDeadline) > 3, 'Vehicle is not clear immediately before keyboard entry.');

  await page.keyboard.down('KeyW');
  let inside;
  try {
    for (let frame = 0; frame < 90; frame += 1) {
      await waitForFrames(page, 1);
      inside = await readGameState(page);
      if (distanceFromRedBlock(inside) <= 3) break;
    }
  } finally {
    await page.keyboard.up('KeyW');
  }
  assert(inside && distanceFromRedBlock(inside) <= 3, 'Keyboard drive did not enter red respawn radius.');
  const insideBlock = inside.runtime.blocks.find(({ id }) => id === 'plaza-red');
  await page.evaluate((milliseconds) => window.advanceTime?.(milliseconds), insideBlock?.respawnRemainingMs ?? 0);
  await waitForFrames(page, 1);
  const atDeadline = await readGameState(page);
  assert.equal(atDeadline.runtime.blocks.find(({ id }) => id === 'plaza-red')?.respawnRemainingMs, 0);
  assert.equal(atDeadline.runtime.blocks.find(({ id }) => id === 'plaza-red')?.phase, 'broken',
    'Red block restored at deadline while vehicle was inside three units.');

  await page.keyboard.down('KeyS');
  try {
    await page.waitForFunction(() => {
      const rendered = window.render_game_to_text?.();
      if (!rendered) return false;
      const state = JSON.parse(rendered);
      return state.runtime.blocks.find(({ id }) => id === 'plaza-red')?.phase === 'intact'
        && state.visuals.intactBlockCount === 4;
    }, undefined, { timeout: 5_000 });
  } finally {
    await page.keyboard.up('KeyS');
  }
  return { atDeadline, inside, justBeforeDeadline };
}

/** manual clockをpage上で同期加算する。 */
async function windowAdvance(page, milliseconds) {
  await page.evaluate((value) => window.advanceTime?.(value), milliseconds);
}

/** 3frameの短い加速と完全減速を繰り返し、4未満の実衝突を起こす。 */
async function collideBelowThreshold(page) {
  for (let pulse = 0; pulse < 12; pulse += 1) {
    await page.keyboard.down('KeyW');
    await waitForFrames(page, 3);
    await page.keyboard.up('KeyW');
    await brakeVehicle(page);
    const state = await readGameState(page);
    const redTelemetry = state.breakables.blocks.find(({ id }) => id === 'plaza-red');
    if ((redTelemetry?.impactCount ?? 0) > 0) return state;
  }
  throw new Error('Low-speed real-vehicle collision did not reach plaza-red.');
}

const browser = await chromium.launch({ headless: true });
const errors = [];
const results = {};

try {
  if (!additionalBlocksOnly) {
  const chainPage = await openGamePage(browser, 'break-restore-chain', errors);
  try {
    await driveToRedBlockApproach(chainPage);
    const timerChain = await collideAtEffectiveSpeedThroughTimer(chainPage);
    const brokenState = timerChain.broken;
    const brokenRendered = timerChain.broken;
    const brokenRed = brokenRendered.breakables.blocks.find(({ id }) => id === 'plaza-red');
    assert.equal(brokenRendered.runtime.blocks.find(({ id }) => id === 'plaza-red')?.phase, 'broken');
    assert((brokenRed?.maxImpactSpeed ?? 0) >= 4,
      `Effective impact speed is below four: ${JSON.stringify(brokenRed)}`);
    assert.equal(brokenRed?.fragmentVisibleCount, 6, 'Broken red block does not show six fragments.');
    assert.equal(brokenRed?.collisionEnabledFragmentCount, 6, 'Broken red fragment colliders are not all enabled.');
    assert.equal(brokenRendered.breakables.activeFragmentCount, 6, 'Pool active count is not six after break.');
    assert.equal(brokenRendered.breakables.enabledBodyCount, 6, 'Six fragment bodies are not actually enabled.');
    assert.equal(brokenRendered.breakables.poolSlotCount, 24, 'Pool grew beyond or below 24 slots.');
    assert.equal(brokenRendered.breakables.uniqueBodyHandleCount, 24, 'Actual body handle count changed on break.');
    assert.equal(brokenRendered.breakables.uniqueColliderHandleCount, 24, 'Actual collider handle count changed on break.');
    assert.equal(brokenRendered.breakables.uniqueMeshUuidCount, 24, 'Actual mesh UUID count changed on break.');
    assert.equal(brokenRed?.impactCount, 1, 'Fast collision emitted duplicate red block impacts.');
    assert.equal(brokenRed?.vehicleImpactCount, 1, 'Fast collision was not counted exactly once as vehicle impact.');
    assert.equal(brokenRed?.intactEnabledCountAtFragmentActivation, 0,
      'Fragments activated before the old intact body/collider were disabled.');
    assert.equal(brokenRed?.intactBodyEnabledCount, 0, 'Old intact body remains enabled after break.');
    assert.equal(brokenRed?.intactColliderEnabledCount, 0, 'Old intact collider remains enabled after break.');
    for (const block of brokenRendered.breakables.blocks.filter(({ id }) => id !== 'plaza-red')) {
      assert.equal(block.impactCount, 0, `${block.id} received an impact during red break.`);
    }
    const originalSlotIds = brokenRed.slotIds;
    const originalBodyHandles = brokenRendered.breakables.bodyHandles;
    const originalColliderHandles = brokenRendered.breakables.colliderHandles;
    const originalMeshUuids = brokenRendered.breakables.meshUuids;
    const almostExpired = timerChain.almostExpired;
    assert(Math.abs(
      almostExpired.runtime.blocks.find(({ id }) => id === 'plaza-red')?.respawnRemainingMs - 3_810,
    ) <= 1e-6, 'Runtime did not expose exactly 3810ms before fragment expiry.');
    assert.equal(almostExpired.breakables.activeFragmentCount, 6,
      `Fragments expired before 1.19 seconds: ${JSON.stringify({
        block: almostExpired.runtime.blocks.find(({ id }) => id === 'plaza-red'),
        breakables: almostExpired.breakables,
        brokenBlock: brokenRendered.runtime.blocks.find(({ id }) => id === 'plaza-red'),
      })}`);
    const expiredTimer = timerChain.expired;
    assert(Math.abs(
      expiredTimer.runtime.blocks.find(({ id }) => id === 'plaza-red')?.respawnRemainingMs - 3_800,
    ) <= 1e-6, 'Runtime did not expose exactly 3800ms at fragment expiry.');
    const expiredAfterOneMacrotask = await readGameStateAfterMacrotask(chainPage);
    const expiredAfterTwoMacrotasks = await readGameStateAfterMacrotask(chainPage);
    await waitForFrames(chainPage, 5);
    const expired = await readGameState(chainPage);
    assert.equal(expired.breakables.activeFragmentCount, 0,
      `Fragments remain visible at 1.2 seconds: ${JSON.stringify(expired.breakables)}`);
    assert.equal(expired.breakables.collisionEnabledFragmentCount, 0, 'Fragment collisions remain enabled at 1.2 seconds.');
    assert.equal(expired.breakables.enabledBodyCount, 0, 'Fragment bodies remain enabled at expiry.');
    assert.equal(expired.breakables.sleepingFragmentCount, 24, 'Expired fragment bodies are not all sleeping.');
    assert.deepEqual(expired.breakables.bodyHandles, originalBodyHandles, 'Expiry replaced body handles.');
    assert.deepEqual(expired.breakables.colliderHandles, originalColliderHandles, 'Expiry replaced collider handles.');
    assert.deepEqual(expired.breakables.meshUuids, originalMeshUuids, 'Expiry replaced mesh UUIDs.');

    const safeBoundary = await verifySafeRestoreBoundary(chainPage);
    await brakeVehicle(chainPage);
    const restored = await readGameState(chainPage);
    assert.equal(restored.visuals.intactBlockCount, 4, 'Restored scene does not contain exactly four intact blocks.');
    assert.equal(restored.breakables.activeFragmentCount, 0, 'Restored scene retains visible fragments.');
    assert.equal(restored.breakables.collisionEnabledFragmentCount, 0, 'Restored scene retains fragment collisions.');
    assert.equal(restored.breakables.enabledBodyCount, 0, 'Restored scene retains enabled fragment bodies.');
    assert.equal(restored.breakables.sleepingFragmentCount, 24, 'Restored scene fragment bodies are not sleeping.');
    assert.deepEqual(restored.breakables.bodyHandles, originalBodyHandles, 'Restore replaced body handles.');
    assert.deepEqual(restored.breakables.colliderHandles, originalColliderHandles, 'Restore replaced collider handles.');
    assert.deepEqual(restored.breakables.meshUuids, originalMeshUuids, 'Restore replaced mesh UUIDs.');
    await chainPage.screenshot({ path: `${outputDirectory}/block-restored.png` });

    await chainPage.evaluate(() => window.reset_voxel_game_vehicle?.());
    await waitForFrames(chainPage, 2);
    await driveToRedBlockApproach(chainPage);
    const rebroken = await collideAtEffectiveSpeed(chainPage);
    const visualSeparation = await waitForFragmentVisualSeparation(chainPage);
    const rebrokenRendered = visualSeparation.state;
    const rebrokenRed = rebrokenRendered.breakables.blocks.find(({ id }) => id === 'plaza-red');
    assert.equal(rebrokenRed?.fragmentVisibleCount, 6, 'Re-break did not reactivate six slots.');
    assert.deepEqual(rebrokenRed?.slotIds, originalSlotIds, 'Re-break replaced fragment slot identities.');
    assert.equal(rebrokenRendered.breakables.poolSlotCount, 24, 'Re-break changed pool size.');
    assert.deepEqual(rebrokenRendered.breakables.bodyHandles, originalBodyHandles, 'Re-break replaced body handles.');
    assert.deepEqual(rebrokenRendered.breakables.colliderHandles, originalColliderHandles, 'Re-break replaced collider handles.');
    assert.deepEqual(rebrokenRendered.breakables.meshUuids, originalMeshUuids, 'Re-break replaced mesh UUIDs.');
    await chainPage.screenshot({ path: `${outputDirectory}/block-broken.png` });
    results.chain = {
      broken: brokenState.runtime.blocks.find(({ id }) => id === 'plaza-red'),
      effectiveImpactSpeed: brokenRed.maxImpactSpeed,
      expired: expired.breakables,
      sleepCheckpoints: {
        exactBoundaryRead: expiredTimer.breakables.rapierSleepingFragmentCount,
        afterOneMacrotask: expiredAfterOneMacrotask.breakables.rapierSleepingFragmentCount,
        afterTwoMacrotasks: expiredAfterTwoMacrotasks.breakables.rapierSleepingFragmentCount,
        afterExpirationFrames: expired.breakables.rapierSleepingFragmentCount,
        afterRestore: restored.breakables.rapierSleepingFragmentCount,
      },
      safeBoundary: {
        atDeadline: safeBoundary.atDeadline.runtime.blocks.find(({ id }) => id === 'plaza-red'),
        insideDistance: distanceFromRedBlock(safeBoundary.inside),
        justBeforeDeadline: safeBoundary.justBeforeDeadline.runtime.blocks.find(({ id }) => id === 'plaza-red'),
        justOutsideDistance: distanceFromRedBlock(safeBoundary.justBeforeDeadline),
      },
      restored: restored.runtime.blocks.find(({ id }) => id === 'plaza-red'),
      reusedSlotIds: rebrokenRed.slotIds,
      rebroken: rebroken.runtime.blocks.find(({ id }) => id === 'plaza-red'),
      visualProjection: visualSeparation.measurement,
    };
  } finally {
    await chainPage.keyboard.up('KeyW').catch(() => undefined);
    await chainPage.keyboard.up('KeyS').catch(() => undefined);
    await chainPage.close();
  }
  }

  results.allBlockBreaks = additionalBlocksOnly ? {} : {
    'plaza-red': {
      block: results.chain.rebroken,
      impactSpeed: results.chain.effectiveImpactSpeed,
      visualProjection: results.chain.visualProjection,
    },
  };
  for (const blockId of ['plaza-yellow', 'plaza-blue', 'plaza-green']) {
    const blockPage = await openGamePage(browser, `${blockId}-actual-break`, errors);
    try {
      const approach = await driveToBlockApproach(blockPage, blockId);
      const broken = await collideBlockAtEffectiveSpeed(blockPage, blockId);
      const blockTelemetry = broken.breakables.blocks.find(({ id }) => id === blockId);
      assert((blockTelemetry?.maxImpactSpeed ?? 0) >= 4,
        `${blockId} effective impact speed is below four: ${JSON.stringify(blockTelemetry)}`);
      assert.equal(blockTelemetry?.fragmentVisibleCount, 6, `${blockId} does not show six fragments.`);
      assert.equal(broken.breakables.activeFragmentCount, 6, `${blockId} did not activate exactly six pool slots.`);
      for (const other of broken.runtime.blocks.filter(({ id }) => id !== blockId)) {
        assert.equal(other.phase, 'intact', `${blockId} collision also broke ${other.id}.`);
      }
      // brokenを読んだframeで退避済みのため、車体の二次接触なしで破片配置を観測する。
      await waitForFrames(blockPage, 1);
      const visual = await waitForFragmentVisualSeparation(blockPage, blockId, false);
      results.allBlockBreaks[blockId] = {
        approach: approach.vehicle,
        block: visual.state.runtime.blocks.find(({ id }) => id === blockId),
        impactSpeed: blockTelemetry.maxImpactSpeed,
        visualProjection: visual.measurement,
      };
    } finally {
      await blockPage.keyboard.up('KeyW').catch(() => undefined);
      await blockPage.close();
    }
  }

  if (!additionalBlocksOnly) {
  const belowThresholdPage = await openGamePage(browser, 'below-threshold', errors);
  try {
    const approach = await driveToRedBlockApproach(belowThresholdPage);
    assert(approach.vehicle.position[0] < -15,
      `Low-speed approach lacks west-side runway: ${approach.vehicle.position[0]}`);
    const afterImpact = await collideBelowThreshold(belowThresholdPage);
    const red = afterImpact.breakables.blocks.find(({ id }) => id === 'plaza-red');
    assert((red?.impactCount ?? 0) > 0, 'Low-speed scenario has no actual collision event.');
    assert((red?.maxImpactSpeed ?? Number.POSITIVE_INFINITY) < 4,
      `Low-speed scenario crossed threshold: ${JSON.stringify(red)}`);
    assert.equal(afterImpact.runtime.blocks.find(({ id }) => id === 'plaza-red')?.phase, 'intact',
      'Below-threshold real collision broke plaza-red.');
    assert.equal(afterImpact.breakables.activeFragmentCount, 0, 'Below-threshold collision activated fragments.');
    results.belowThreshold = { approach: approach.vehicle, red };
  } finally {
    await belowThresholdPage.keyboard.up('KeyW').catch(() => undefined);
    await belowThresholdPage.close();
  }

  results.plazaViewports = {};
  for (const viewport of [
    { height: 720, name: 'desktop', width: 1280 },
    { height: 768, name: 'tablet-landscape', width: 1024 },
    { height: 390, name: 'mobile-landscape', width: 844 },
  ]) {
    const overviewPage = await openGamePage(browser, `plaza-${viewport.name}`, errors, viewport);
    try {
      await driveToBlockPlazaOverview(overviewPage);
      const state = await readGameState(overviewPage);
      const hudControlRects = await overviewPage.evaluate(() => [
        '.fullscreen-button',
        '.mission-pill',
        '.spray-button',
        '.touch-joystick',
      ].map((selector) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing HUD control: ${selector}`);
        const rect = element.getBoundingClientRect();
        return {
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          top: rect.top,
        };
      }));
      const visibility = measureBlockPlazaVisibility(state, hudControlRects);
      assert(
        visibility.allInsideViewport,
        `${viewport.name}: not all four plaza blocks fit the viewport: ${JSON.stringify(visibility)}`,
      );
      assert(
        visibility.minimumViewportMargin >= 4,
        `${viewport.name}: plaza blocks have less than 4px viewport margin: ${JSON.stringify(visibility)}`,
      );
      assert(
        visibility.minimumHudControlGap >= 4,
        `${viewport.name}: plaza blocks have less than 4px HUD gap: ${JSON.stringify(visibility)}`,
      );
      await overviewPage.screenshot({
        path: `${outputDirectory}/block-plaza-${viewport.name}.png`,
      });
      results.plazaViewports[viewport.name] = visibility;
    } finally {
      await overviewPage.close();
    }
  }

  assert.equal(errors.length, 0, `Voxel Game Task6 browser errors: ${errors.join(' | ')}`);
  for (const screenshot of [
    'block-broken.png',
    'block-restored.png',
    'block-plaza-desktop.png',
    'block-plaza-tablet-landscape.png',
    'block-plaza-mobile-landscape.png',
  ]) {
    assert(fs.existsSync(`${outputDirectory}/${screenshot}`), `Missing screenshot: ${screenshot}`);
  }
  }
  fs.writeFileSync(`${outputDirectory}/task6-results.json`, `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}

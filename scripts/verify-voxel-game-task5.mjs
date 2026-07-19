import fs from 'node:fs';
import { chromium } from 'playwright';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:5173';
const outputDirectory = 'output/voxel-game';
const screenshots = [
  'fire-full.png',
  'fire-medium-water.png',
  'mission-complete.png',
  'fire-medium-water-mobile.png',
  'mission-complete-mobile.png',
];
fs.mkdirSync(outputDirectory, { recursive: true });
for (const screenshot of screenshots) fs.rmSync(`${outputDirectory}/${screenshot}`, { force: true });

/** 条件を満たさない場合はscenario名を含むErrorで停止する。 */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

/** 公開text hookからTask5のruntime・照準・visual telemetryを読む。 */
async function readGameState(page) {
  const rendered = await page.evaluate(() => window.render_game_to_text?.());
  if (!rendered) throw new Error('Voxel Game text state is unavailable.');
  const state = JSON.parse(rendered);
  assert(state.runtime && state.mission && state.visuals, `Task5 telemetry is incomplete: ${rendered}`);
  return state;
}

/** 手動clockとsnapshot読取を同一browser taskで行い、通常frameの混入を防ぐ。 */
async function advanceAndReadGameState(page, milliseconds) {
  const rendered = await page.evaluate((duration) => {
    window.advanceTime?.(duration);
    return window.render_game_to_text?.();
  }, milliseconds);
  if (!rendered) throw new Error('Voxel Game text state is unavailable after manual advance.');
  return JSON.parse(rendered);
}

/** 0msで次frameをmanual化し、Space signal反映直後のsnapshotを同一browser taskで読む。 */
async function armTargetedSprayAndReadGameState(page) {
  const rendered = await page.evaluate(() => new Promise((resolve) => {
    window.advanceTime?.(0);
    window.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Space',
      key: ' ',
    }));
    requestAnimationFrame(() => resolve(window.render_game_to_text?.()));
  }));
  if (!rendered) throw new Error('Voxel Game text state is unavailable after spray signal frame.');
  return JSON.parse(rendered);
}

/** scene ready、公開hook、初期routeまで待つ。 */
async function openGamePage(browser, scenario, errors, viewport = { height: 720, width: 1280 }) {
  const page = await browser.newPage({ viewport });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${scenario}: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`${scenario}: ${String(error)}`));
  await page.goto(`${baseUrl}/voxel-game.html?task5=${scenario}-${Date.now()}`, { waitUntil: 'networkidle' });
  await page.locator('.voxel-game-canvas canvas').waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => document.documentElement.dataset.voxelSceneReady === 'true'
      && typeof window.render_game_to_text === 'function'
      && typeof window.advanceTime === 'function',
    undefined,
    { timeout: 5_000 },
  );
  const state = await readGameState(page);
  assert(state.runtime.routeVisible, `${scenario}: initial route is hidden.`);
  assert(state.visuals.routeCubeCount === 12, `${scenario}: route cube count is not 12.`);
  return page;
}

/** throttleを離した自然減速で、旋回前・撮影前の位置driftを抑える。 */
async function brakeVehicle(page) {
  for (let frame = 0; frame < 120; frame += 1) {
    await waitForFrames(page, 1);
    if ((await readGameState(page)).vehicle.speed < 0.24) return;
  }
  throw new Error('Vehicle did not stop within 120 idle frames.');
}

/** 現在位置で左右入力だけを使い、指定世界方向へ消防車を向ける。 */
async function turnVehicleToward(page, targetX, targetZ) {
  const targetLength = Math.hypot(targetX, targetZ) || 1;
  const normalizedTargetX = targetX / targetLength;
  const normalizedTargetZ = targetZ / targetLength;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const state = await readGameState(page);
    const [forwardX, , forwardZ] = state.vehicle.forward;
    const dot = forwardX * normalizedTargetX + forwardZ * normalizedTargetZ;
    if (dot >= 0.9995) return;
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

/** Wの公開keyboard経路だけで指定座標条件まで走り、停止する。 */
async function driveUntil(page, predicate, description, maxBursts = 180) {
  await page.keyboard.down('KeyW');
  try {
    for (let burst = 0; burst < maxBursts; burst += 1) {
      await waitForFrames(page, 2);
      const state = await readGameState(page);
      if (predicate(state)) return;
      assert(state.vehicle.resetCount === 0, `${description}: vehicle reset unexpectedly.`);
    }
    throw new Error(`${description}: destination was not reached.`);
  } finally {
    await page.keyboard.up('KeyW');
    await brakeVehicle(page);
  }
}

/** 車庫から右回り道路を実際に走り、火災現場の南側へ到達する。 */
async function driveRightRouteToFireApproach(page, stopZ) {
  await driveUntil(page, (state) => state.vehicle.position[2] >= 15.2, 'garage exit');
  await turnVehicleToward(page, 1, 0);
  await driveUntil(page, (state) => state.vehicle.position[0] >= 12, 'east road');
  await turnVehicleToward(page, 0, -1);
  await driveUntil(page, (state) => state.vehicle.position[2] <= stopZ, 'north road');
}

/** current headingのまま短いW burstを入れ、照準距離を微調整する。 */
async function pulseForward(page, frames = 3) {
  await page.keyboard.down('KeyW');
  await waitForFrames(page, frames);
  await page.keyboard.up('KeyW');
  await brakeVehicle(page);
}

/** 実車を前進させ、指定distance以下で初めて停止する。 */
async function approachSprayDistance(page, maximumDistance) {
  await driveUntil(
    page,
    (state) => state.mission.distance <= maximumDistance + 1.8,
    `spray approach ${maximumDistance}`,
    120,
  );
  for (let pulse = 0; pulse < 40; pulse += 1) {
    const state = await readGameState(page);
    if (state.mission.distance <= maximumDistance) return state;
    assert(state.vehicle.resetCount === 0, `Spray approach reset unexpectedly: ${JSON.stringify(state.vehicle)}`);
    await pulseForward(page);
  }
  const finalState = await readGameState(page);
  throw new Error(`Spray distance did not reach ${maximumDistance}: ${JSON.stringify({
    mission: finalState.mission,
    vehicle: finalState.vehicle,
  })}`);
}

/** Space入力後に手動clockを進め、R3F表示へ反映する。 */
async function sprayAndAdvance(page, milliseconds) {
  await page.keyboard.down('Space');
  await waitForFrames(page, 2);
  await page.evaluate((duration) => window.advanceTime?.(duration), milliseconds);
  await waitForFrames(page, 2);
  return readGameState(page);
}

const browser = await chromium.launch({ headless: true });
const errors = [];
const results = {};

try {
  const durationPage = await openGamePage(browser, 'duration-contract', errors);
  try {
    await driveRightRouteToFireApproach(durationPage, -2);
    const targetedState = await approachSprayDistance(durationPage, 5.7);
    assert(targetedState.mission.targeted,
      `Duration approach is not targeted: ${JSON.stringify(targetedState.mission)}`);
    assert(targetedState.runtime.fireIntensity === 1,
      `Duration scenario did not start at full fire: ${targetedState.runtime.fireIntensity}`);

    const armedState = await armTargetedSprayAndReadGameState(durationPage);
    assert(armedState.mission.sprayOnFire, 'Space did not arm targeted spray signal.');
    assert(armedState.runtime.fireIntensity === 1,
      `Signal reflection consumed normal-clock fire time: ${armedState.runtime.fireIntensity}`);

    const beforeCompletion = await advanceAndReadGameState(durationPage, 2_499);
    assert(beforeCompletion.runtime.missionPhase === 'active',
      `2499ms spray completed too early: ${beforeCompletion.runtime.missionPhase}`);
    assert(beforeCompletion.runtime.fireIntensity > 0,
      `2499ms spray reduced fire to zero: ${beforeCompletion.runtime.fireIntensity}`);

    const exactCompletion = await advanceAndReadGameState(durationPage, 1);
    assert(exactCompletion.runtime.missionPhase === 'celebrating',
      `2500ms spray did not enter celebrating: ${exactCompletion.runtime.missionPhase}`);
    assert(exactCompletion.runtime.fireIntensity === 0,
      `2500ms spray did not extinguish fire: ${exactCompletion.runtime.fireIntensity}`);
    assert(Math.abs(exactCompletion.runtime.celebrationRemainingMs - 1_800) <= 1e-6,
      `Celebration duration was consumed at completion: ${exactCompletion.runtime.celebrationRemainingMs}`);
    results.durationContract = {
      armed: armedState.runtime,
      beforeCompletion: beforeCompletion.runtime,
      exactCompletion: exactCompletion.runtime,
      targetedDistance: targetedState.mission.distance,
    };
  } finally {
    await durationPage.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', {
        bubbles: true,
        cancelable: true,
        code: 'Space',
        key: ' ',
      }));
    }).catch(() => undefined);
    await durationPage.close();
  }

  const missionPage = await openGamePage(browser, 'mission-chain', errors);
  try {
    await driveRightRouteToFireApproach(missionPage, -2);
    const targetedState = await approachSprayDistance(missionPage, 5.7);
    assert(targetedState.mission.targeted, `Mission approach is not targeted: ${JSON.stringify(targetedState.mission)}`);
    assert(targetedState.runtime.fireIntensity === 1, 'Fire changed before spraying.');
    assert(targetedState.visuals.fireLayerCount === 3, 'Full fire does not have three layers.');
    await missionPage.screenshot({ path: `${outputDirectory}/fire-full.png` });

    const mediumState = await sprayAndAdvance(missionPage, 1_000);
    assert(mediumState.runtime.fireIntensity > 0.33 && mediumState.runtime.fireIntensity <= 0.66,
      `Fire is not medium after 1000ms: ${mediumState.runtime.fireIntensity}`);
    assert(mediumState.visuals.fireLayerCount === 2, 'Medium fire does not have two layers.');
    assert(mediumState.visuals.waterCubeCount === 18, 'Spray does not expose 18 water cubes.');
    await missionPage.screenshot({ path: `${outputDirectory}/fire-medium-water.png` });

    await missionPage.evaluate(() => window.advanceTime?.(1_500));
    await missionPage.keyboard.up('Space');
    await waitForFrames(missionPage, 2);
    const celebrationState = await readGameState(missionPage);
    assert(celebrationState.runtime.fireIntensity === 0, '2500ms targeted spray did not extinguish fire.');
    assert(celebrationState.runtime.missionPhase === 'celebrating',
      `Mission did not enter celebration: ${celebrationState.runtime.missionPhase}`);
    assert(celebrationState.visuals.fireLayerCount === 0, 'Fire cubes remain during celebration.');
    assert(celebrationState.visuals.routeCubeCount === 0, 'Route remains during celebration.');
    assert(celebrationState.visuals.starCubeCount === 30, 'Six five-cube stars are not visible.');
    await missionPage.getByText('できた！', { exact: true }).waitFor({ state: 'visible' });
    await missionPage.screenshot({ path: `${outputDirectory}/mission-complete.png` });

    await missionPage.evaluate(() => window.advanceTime?.(1_800));
    await waitForFrames(missionPage, 2);
    const freeRoamState = await readGameState(missionPage);
    assert(freeRoamState.runtime.missionPhase === 'freeRoam',
      `Celebration did not end in freeRoam: ${freeRoamState.runtime.missionPhase}`);
    assert(freeRoamState.visuals.routeCubeCount === 0 && freeRoamState.visuals.starCubeCount === 0,
      `Mission visuals remain in freeRoam: ${JSON.stringify(freeRoamState.visuals)}`);
    assert(await missionPage.getByText('できた！', { exact: true }).count() === 0, 'Success text remains in freeRoam.');
    results.missionChain = {
      celebration: celebrationState.runtime,
      freeRoam: freeRoamState.runtime,
      medium: mediumState.runtime,
      targetedDistance: targetedState.mission.distance,
    };
  } finally {
    await missionPage.keyboard.up('Space').catch(() => undefined);
    await missionPage.close();
  }

  const mobilePage = await openGamePage(
    browser,
    'mobile-visuals',
    errors,
    { height: 390, width: 844 },
  );
  try {
    await driveRightRouteToFireApproach(mobilePage, -2);
    const targetedState = await approachSprayDistance(mobilePage, 5.7);
    assert(targetedState.mission.targeted,
      `Mobile approach is not targeted: ${JSON.stringify(targetedState.mission)}`);

    const mediumState = await sprayAndAdvance(mobilePage, 1_000);
    assert(mediumState.visuals.fireLayerCount === 2,
      `Mobile medium fire layer count is not 2: ${mediumState.visuals.fireLayerCount}`);
    assert(mediumState.visuals.waterCubeCount === 18,
      `Mobile spray cube count is not 18: ${mediumState.visuals.waterCubeCount}`);
    await mobilePage.screenshot({ path: `${outputDirectory}/fire-medium-water-mobile.png` });

    await mobilePage.evaluate(() => window.advanceTime?.(1_500));
    await mobilePage.keyboard.up('Space');
    await waitForFrames(mobilePage, 2);
    const celebrationState = await readGameState(mobilePage);
    assert(celebrationState.runtime.missionPhase === 'celebrating',
      `Mobile mission did not enter celebrating: ${celebrationState.runtime.missionPhase}`);
    assert(celebrationState.visuals.starCubeCount === 30,
      `Mobile star cube count is not 30: ${celebrationState.visuals.starCubeCount}`);
    const success = mobilePage.getByText('できた！', { exact: true });
    await success.waitFor({ state: 'visible' });
    const successBox = await success.boundingBox();
    assert(successBox
      && successBox.x >= 0
      && successBox.y >= 0
      && successBox.x + successBox.width <= 844
      && successBox.y + successBox.height <= 390,
    `Mobile success text exceeds viewport: ${JSON.stringify(successBox)}`);
    await mobilePage.screenshot({ path: `${outputDirectory}/mission-complete-mobile.png` });
    results.mobileVisuals = {
      celebration: celebrationState.runtime,
      medium: mediumState.runtime,
      successBox,
      targetedDistance: targetedState.mission.distance,
    };
  } finally {
    await mobilePage.keyboard.up('Space').catch(() => undefined);
    await mobilePage.close();
  }

  const outOfRangePage = await openGamePage(browser, 'out-of-range', errors);
  try {
    await driveRightRouteToFireApproach(outOfRangePage, -1);
    const nearRangeState = await approachSprayDistance(outOfRangePage, 6.9);
    assert(nearRangeState.mission.distance > 6.01,
      `Out-of-range vehicle crossed 6.01 units: ${nearRangeState.mission.distance}`);
    assert(!nearRangeState.mission.targeted, 'Out-of-range fire was targeted.');
    const afterSpray = await sprayAndAdvance(outOfRangePage, 2_500);
    assert(afterSpray.runtime.fireIntensity === 1,
      `Out-of-range spray changed fire: ${afterSpray.runtime.fireIntensity}`);
    results.outOfRange = { after: afterSpray.runtime.fireIntensity, mission: nearRangeState.mission };
  } finally {
    await outOfRangePage.keyboard.up('Space').catch(() => undefined);
    await outOfRangePage.close();
  }

  const behindPage = await openGamePage(browser, 'behind-fire', errors);
  try {
    await driveRightRouteToFireApproach(behindPage, -12.5);
    const behindState = await readGameState(behindPage);
    assert(behindState.mission.distance <= 6,
      `Behind-fire scenario is not within range: ${behindState.mission.distance}`);
    assert(!behindState.mission.targeted, `Fire behind vehicle was targeted: ${JSON.stringify(behindState.mission)}`);
    const afterSpray = await sprayAndAdvance(behindPage, 2_500);
    assert(afterSpray.runtime.fireIntensity === 1,
      `Behind-fire spray changed fire: ${afterSpray.runtime.fireIntensity}`);
    results.behindFire = { after: afterSpray.runtime.fireIntensity, mission: behindState.mission };
  } finally {
    await behindPage.keyboard.up('Space').catch(() => undefined);
    await behindPage.close();
  }

  assert(errors.length === 0, `Voxel Game Task5 browser errors: ${errors.join(' | ')}`);
  for (const screenshot of screenshots) {
    assert(fs.existsSync(`${outputDirectory}/${screenshot}`), `Missing screenshot: ${screenshot}`);
  }
  fs.writeFileSync(`${outputDirectory}/task5-results.json`, `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}

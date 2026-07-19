import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:5173';
const outputDirectory = 'output/voxel-game';
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

/** scene ready、公開hook、24-slot pool準備まで待つ。 */
async function openGamePage(browser, scenario, errors) {
  const page = await browser.newPage({ viewport: { height: 720, width: 1280 } });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${scenario}: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`${scenario}: ${String(error)}`));
  await page.goto(`${baseUrl}/voxel-game.html?task6=${scenario}-${Date.now()}`, { waitUntil: 'networkidle' });
  await page.locator('.voxel-game-canvas canvas').waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => {
      const rendered = window.render_game_to_text?.();
      if (document.documentElement.dataset.voxelSceneReady !== 'true' || !rendered) return false;
      return JSON.parse(rendered).breakables?.poolSlotCount === 24;
    },
    undefined,
    { timeout: 5_000 },
  );
  const state = await readGameState(page);
  assert.equal(state.breakables.activeFragmentCount, 0, `${scenario}: fragments start active.`);
  assert.equal(state.breakables.collisionEnabledFragmentCount, 0, `${scenario}: fragment colliders start enabled.`);
  assert.equal(state.visuals.intactBlockCount, 4, `${scenario}: intact block count is not four.`);
  return page;
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
  await page.keyboard.down('KeyW');
  try {
    for (let burst = 0; burst < maxBursts; burst += 1) {
      await waitForFrames(page, 2);
      const state = await readGameState(page);
      if (predicate(state)) return state;
      assert.equal(state.vehicle.resetCount, 0, `${description}: vehicle reset unexpectedly.`);
    }
    throw new Error(`${description}: destination was not reached.`);
  } finally {
    await page.keyboard.up('KeyW');
  }
}

/** 車庫から外周西端を実走し、他blockを避けて赤block西側へ東向きで出る。 */
async function driveToRedBlockApproach(page) {
  await driveUntil(page, (state) => state.vehicle.position[2] >= 15.2, 'garage exit');
  await brakeVehicle(page);
  await turnVehicleToward(page, -1, 0);
  await driveUntil(page, (state) => state.vehicle.position[0] <= -16.1, 'west road outer edge');
  await brakeVehicle(page);
  await turnVehicleToward(page, 0, -1);
  await driveUntil(page, (state) => state.vehicle.position[2] <= 1.7, 'red block west side');
  await brakeVehicle(page);
  await turnVehicleToward(page, 1, 0);
  return readGameState(page);
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

/** page内rAFだけで実車破壊を待ち、3810→3800→0msのtimer chainを決定的に観測する。 */
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
        window.advanceTime?.(Math.max(0, brokenBlock.respawnRemainingMs - 3_810));
        requestAnimationFrame(() => {
          const almostExpired = read();
          window.advanceTime?.(10);
          requestAnimationFrame(() => {
            const expired = read();
            const expiredBlock = expired.runtime.blocks.find(({ id }) => id === 'plaza-red');
            window.advanceTime?.(expiredBlock?.respawnRemainingMs ?? 0);
            requestAnimationFrame(() => resolve({
              almostExpired,
              broken,
              expired,
              nearAfterFiveSeconds: read(),
            }));
          });
        });
      };
      requestAnimationFrame(tick);
    }));
  } finally {
    await page.keyboard.up('KeyW');
  }
}

/** 5frame以下の短い加速と完全減速を繰り返し、4未満の実衝突を起こす。 */
async function collideBelowThreshold(page) {
  for (let pulse = 0; pulse < 12; pulse += 1) {
    await page.keyboard.down('KeyW');
    await waitForFrames(page, 5);
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
    assert.equal(brokenRendered.breakables.poolSlotCount, 24, 'Pool grew beyond or below 24 slots.');
    const originalSlotIds = brokenRed.slotIds;
    const almostExpired = timerChain.almostExpired;
    assert.equal(almostExpired.breakables.activeFragmentCount, 6,
      `Fragments expired before 1.19 seconds: ${JSON.stringify({
        block: almostExpired.runtime.blocks.find(({ id }) => id === 'plaza-red'),
        breakables: almostExpired.breakables,
        brokenBlock: brokenRendered.runtime.blocks.find(({ id }) => id === 'plaza-red'),
      })}`);
    const expired = timerChain.expired;
    assert.equal(expired.breakables.activeFragmentCount, 0, 'Fragments remain visible at 1.2 seconds.');
    assert.equal(expired.breakables.collisionEnabledFragmentCount, 0, 'Fragment collisions remain enabled at 1.2 seconds.');

    const nearAfterFiveSeconds = timerChain.nearAfterFiveSeconds;
    assert.equal(nearAfterFiveSeconds.runtime.blocks.find(({ id }) => id === 'plaza-red')?.phase, 'broken',
      'Red block restored while vehicle remained within three units.');

    await chainPage.keyboard.down('KeyS');
    try {
      await chainPage.waitForFunction(() => {
        const rendered = window.render_game_to_text?.();
        if (!rendered) return false;
        const state = JSON.parse(rendered);
        return state.runtime.blocks.find(({ id }) => id === 'plaza-red')?.phase === 'intact';
      }, undefined, { timeout: 5_000 });
    } finally {
      await chainPage.keyboard.up('KeyS');
    }
    await brakeVehicle(chainPage);
    const restored = await readGameState(chainPage);
    assert.equal(restored.visuals.intactBlockCount, 4, 'Restored scene does not contain exactly four intact blocks.');
    assert.equal(restored.breakables.activeFragmentCount, 0, 'Restored scene retains visible fragments.');
    assert.equal(restored.breakables.collisionEnabledFragmentCount, 0, 'Restored scene retains fragment collisions.');
    await chainPage.screenshot({ path: `${outputDirectory}/block-restored.png` });

    await turnVehicleToward(chainPage, 1, 0);
    const rebroken = await collideAtEffectiveSpeed(chainPage);
    await waitForFrames(chainPage, 1);
    const rebrokenRendered = await readGameState(chainPage);
    const rebrokenRed = rebrokenRendered.breakables.blocks.find(({ id }) => id === 'plaza-red');
    assert.equal(rebrokenRed?.fragmentVisibleCount, 6, 'Re-break did not reactivate six slots.');
    assert.deepEqual(rebrokenRed?.slotIds, originalSlotIds, 'Re-break replaced fragment slot identities.');
    assert.equal(rebrokenRendered.breakables.poolSlotCount, 24, 'Re-break changed pool size.');
    await chainPage.screenshot({ path: `${outputDirectory}/block-broken.png` });
    results.chain = {
      broken: brokenState.runtime.blocks.find(({ id }) => id === 'plaza-red'),
      effectiveImpactSpeed: brokenRed.maxImpactSpeed,
      expired: expired.breakables,
      nearAfterFiveSeconds: nearAfterFiveSeconds.runtime.blocks.find(({ id }) => id === 'plaza-red'),
      restored: restored.runtime.blocks.find(({ id }) => id === 'plaza-red'),
      reusedSlotIds: rebrokenRed.slotIds,
      rebroken: rebroken.runtime.blocks.find(({ id }) => id === 'plaza-red'),
    };
  } finally {
    await chainPage.keyboard.up('KeyW').catch(() => undefined);
    await chainPage.keyboard.up('KeyS').catch(() => undefined);
    await chainPage.close();
  }

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

  assert.equal(errors.length, 0, `Voxel Game Task6 browser errors: ${errors.join(' | ')}`);
  for (const screenshot of ['block-broken.png', 'block-restored.png']) {
    assert(fs.existsSync(`${outputDirectory}/${screenshot}`), `Missing screenshot: ${screenshot}`);
  }
  fs.writeFileSync(`${outputDirectory}/task6-results.json`, `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}

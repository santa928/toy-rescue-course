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

/** 次のtimer macrotask後のactual telemetryを読む。 */
async function readGameStateAfterMacrotask(page) {
  const rendered = await page.evaluate(() => new Promise((resolve) => {
    setTimeout(() => resolve(window.render_game_to_text?.()), 0);
  }));
  if (!rendered) throw new Error('Voxel Game text state is unavailable after macrotask.');
  return JSON.parse(rendered);
}

/** scene ready、公開hook、24-slot pool準備まで待つ。 */
async function openGamePage(browser, scenario, errors) {
  const page = await browser.newPage({ viewport: { height: 720, width: 1280 } });
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
  return Math.hypot(state.vehicle.position[0] + 13, state.vehicle.position[2]);
}

/** 復元期限直前に実keyboardでclear側から半径3内へ入り、0msでbroken維持後に離れる。 */
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
  assert(distanceFromRedBlock(outside) > 3, 'Vehicle is not outside red respawn radius.');

  await page.keyboard.down('KeyW');
  try {
    for (let frame = 0; frame < 180; frame += 1) {
      await waitForFrames(page, 1);
      const approaching = await readGameState(page);
      const distance = distanceFromRedBlock(approaching);
      if (distance > 3.6 && distance <= 3.9) break;
      if (frame === 179) throw new Error(`Vehicle missed outside boundary band: ${distance}.`);
    }
  } finally {
    await page.keyboard.up('KeyW');
  }

  const justOutside = await readGameState(page);
  const beforeDeadlineBlock = justOutside.runtime.blocks.find(({ id }) => id === 'plaza-red');
  assert(distanceFromRedBlock(justOutside) > 3, 'Deadline setup crossed inside too early.');
  await windowAdvance(page, Math.max(0, (beforeDeadlineBlock?.respawnRemainingMs ?? 0) - 500));
  const justBeforeDeadline = await readGameState(page);
  assert.equal(justBeforeDeadline.runtime.blocks.find(({ id }) => id === 'plaza-red')?.phase, 'broken');
  assert(distanceFromRedBlock(justBeforeDeadline) > 3, 'Vehicle is not clear immediately before keyboard entry.');

  await page.keyboard.down('KeyW');
  let inside;
  try {
    for (let frame = 0; frame < 30; frame += 1) {
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
    await waitForFrames(chainPage, 1);
    const rebrokenRendered = await readGameState(chainPage);
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

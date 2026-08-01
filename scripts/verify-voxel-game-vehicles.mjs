import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:5173';
const outputDirectory = 'output/voxel-game-vehicles';
const viewports = [
  { height: 720, name: 'desktop', touch: false, width: 1_280 },
  { height: 768, name: 'tablet', touch: true, width: 1_024 },
  { height: 390, name: 'mobile-landscape', touch: true, width: 844 },
];

const worldAxisInputs = {
  negativeX: { keys: ['KeyA', 'KeyW'], stick: [-0.803, -0.595] },
  negativeZ: { keys: ['KeyD', 'KeyW'], stick: [0.595, -0.803] },
  positiveX: { keys: ['KeyD', 'KeyS'], stick: [0.803, 0.595] },
  positiveZ: { keys: ['KeyA', 'KeyS'], stick: [-0.595, 0.803] },
};

fs.rmSync(outputDirectory, { force: true, recursive: true });
fs.mkdirSync(outputDirectory, { recursive: true });

/** R3FとRapierを通常clockで指定frame数進める。 */
async function waitForFrames(page, frameCount) {
  await page.evaluate((count) => new Promise((resolve) => {
    let remaining = count;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), frameCount);
}

/** 公開hookから二車種のactual text stateを読む。 */
async function readGameState(page) {
  const rendered = await page.evaluate(() => window.render_game_to_text?.());
  assert(rendered, 'render_game_to_text is unavailable.');
  const state = JSON.parse(rendered);
  for (const field of [
    'bulldozer',
    'controls',
    'landmarks',
    'mission',
    'vehicle',
    'vehicleSelection',
    'visuals',
    'world',
  ]) {
    assert(Object.hasOwn(state, field), `text state lacks ${field}.`);
  }
  return state;
}

/** Playwrightの矩形をedge座標へ変換する。 */
function toEdges(box) {
  return {
    bottom: box.y + box.height,
    left: box.x,
    right: box.x + box.width,
    top: box.y,
  };
}

/** 重ならない2矩形間の最短距離を返す。 */
function rectDistance(left, right) {
  const horizontal = Math.max(left.left - right.right, right.left - left.right, 0);
  const vertical = Math.max(left.top - right.bottom, right.top - left.bottom, 0);
  return Math.hypot(horizontal, vertical);
}

/** selector表示中の上段HUDと下段操作を実測し、画面内・安全余白を検証する。 */
async function measureHudLayout(page, viewport) {
  const selectors = {
    action: '.primary-action-button',
    fullscreen: '.fullscreen-button',
    joystick: '.touch-joystick',
    mission: '.mission-pill',
    selector: '.vehicle-selector',
  };
  const boxes = {};
  for (const [name, selector] of Object.entries(selectors)) {
    const box = await page.locator(selector).boundingBox();
    assert(box, `${viewport.name}: ${name} bounding box is unavailable.`);
    boxes[name] = toEdges(box);
  }

  for (const [name, box] of Object.entries(boxes)) {
    assert(box.left >= 0 && box.top >= 0 && box.right <= viewport.width && box.bottom <= viewport.height,
      `${viewport.name}: ${name} exceeds viewport: ${JSON.stringify(box)}.`);
  }
  for (const [left, right] of [
    ['selector', 'mission'],
    ['mission', 'fullscreen'],
    ['selector', 'fullscreen'],
    ['joystick', 'action'],
    ['mission', 'joystick'],
    ['mission', 'action'],
  ]) {
    assert(rectDistance(boxes[left], boxes[right]) >= 8,
      `${viewport.name}: ${left}/${right} lack 8px safety gap: ${JSON.stringify(boxes)}.`);
  }
  if (viewport.name === 'mobile-landscape') {
    assert(boxes.selector.right <= viewport.width * 0.42,
      `${viewport.name}: selector right edge exceeds 42%: ${boxes.selector.right}.`);
  }
  return boxes;
}

/** keyboard集合を同時押下または全解除する。 */
async function setKeyboardKeys(page, heldKeys, nextKeys) {
  const next = new Set(nextKeys);
  for (const key of heldKeys) if (!next.has(key)) await page.keyboard.up(key);
  for (const key of next) if (!heldKeys.has(key)) await page.keyboard.down(key);
  heldKeys.clear();
  for (const key of next) heldKeys.add(key);
}

/** 実DOM pointer eventでstickを操作するtouch driverを作る。 */
async function createTouchDriver(page) {
  const joystick = page.locator('.touch-joystick');
  const box = await joystick.boundingBox();
  assert(box, 'touch joystick bounding box is unavailable.');
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const radius = Math.min(box.width, box.height) * 0.38;
  let active = false;

  return {
    async releaseStick() {
      if (!active) return;
      await joystick.dispatchEvent('pointerup', {
        button: 0,
        clientX: center.x,
        clientY: center.y,
        pointerId: 71,
        pointerType: 'touch',
      });
      active = false;
    },
    async setStick(x, y) {
      const length = Math.hypot(x, y) || 1;
      if (!active) {
        await joystick.dispatchEvent('pointerdown', {
          button: 0,
          clientX: center.x,
          clientY: center.y,
          pointerId: 71,
          pointerType: 'touch',
        });
        active = true;
      }
      await joystick.dispatchEvent('pointermove', {
        button: 0,
        clientX: center.x + x / length * radius,
        clientY: center.y + y / length * radius,
        pointerId: 71,
        pointerType: 'touch',
      });
    },
  };
}

/** 車両が自然減速して切替・微調整可能になるまで待つ。 */
async function brakeVehicle(page) {
  for (let frame = 0; frame < 180; frame += 1) {
    await waitForFrames(page, 1);
    if ((await readGameState(page)).vehicle.speed < 0.24) return;
  }
  throw new Error('vehicle did not stop within 180 frames.');
}

/** world cardinal入力でtelemetry predicateまで走る。 */
async function driveAlongWorldAxis(page, axis, predicate, description, touchDriver, maxBursts = 420) {
  const input = worldAxisInputs[axis];
  assert(input, `${description}: unknown world axis ${axis}.`);
  const heldKeys = new Set();
  const resetCount = (await readGameState(page)).vehicle.resetCount;
  let latest = null;
  let previous = null;
  try {
    if (touchDriver) await touchDriver.setStick(...input.stick);
    else await setKeyboardKeys(page, heldKeys, input.keys);
    for (let burst = 0; burst < maxBursts; burst += 1) {
      await waitForFrames(page, 2);
      latest = await readGameState(page);
      if (predicate(latest)) {
        await touchDriver?.releaseStick();
        await setKeyboardKeys(page, heldKeys, []);
        await brakeVehicle(page);
        return readGameState(page);
      }
      assert.equal(latest.vehicle.resetCount, resetCount,
        `${description}: vehicle reset unexpectedly: ${JSON.stringify({
          current: latest.vehicle,
          previous: previous?.vehicle,
          previousBladeCenter: previous?.bulldozer?.bladeCenter,
          previousControls: previous?.controls,
        })}.`);
      previous = latest;
    }
  } finally {
    await touchDriver?.releaseStick();
    await setKeyboardKeys(page, heldKeys, []);
  }
  throw new Error(`${description}: destination was not reached: ${JSON.stringify(latest?.vehicle)}.`);
}

/** world cardinal方向へ短いpulseを入れてから停止する。 */
async function pulseWorldAxis(page, axis, frameCount, touchDriver) {
  const input = worldAxisInputs[axis];
  const heldKeys = new Set();
  try {
    if (touchDriver) await touchDriver.setStick(...input.stick);
    else await setKeyboardKeys(page, heldKeys, input.keys);
    await waitForFrames(page, frameCount);
  } finally {
    await touchDriver?.releaseStick();
    await setKeyboardKeys(page, heldKeys, []);
  }
  await brakeVehicle(page);
}

/** XまたはZを短い実入力で指定値へ揃える。 */
async function alignWorldCoordinate(page, coordinateIndex, target, description, touchDriver, tolerance = 0.4) {
  const positive = coordinateIndex === 0 ? 'positiveX' : 'positiveZ';
  const negative = coordinateIndex === 0 ? 'negativeX' : 'negativeZ';
  let latest = null;
  for (let attempt = 0; attempt < 28; attempt += 1) {
    latest = await readGameState(page);
    const delta = target - latest.vehicle.position[coordinateIndex];
    if (Math.abs(delta) <= tolerance) return latest;
    await pulseWorldAxis(
      page,
      delta > 0 ? positive : negative,
      Math.max(1, Math.min(7, Math.ceil(Math.abs(delta) * 1.4))),
      touchDriver,
    );
  }
  throw new Error(`${description}: alignment failed: ${JSON.stringify({ actual: latest?.vehicle.position, target })}.`);
}

/** 粗いcardinal走行後に座標をpulseで正確に揃える。 */
async function driveToCoordinate(page, coordinateIndex, target, description, touchDriver, tolerance = 0.4) {
  const state = await readGameState(page);
  const delta = target - state.vehicle.position[coordinateIndex];
  if (Math.abs(delta) > tolerance) {
    const positive = coordinateIndex === 0 ? 'positiveX' : 'positiveZ';
    const negative = coordinateIndex === 0 ? 'negativeX' : 'negativeZ';
    await driveAlongWorldAxis(
      page,
      delta > 0 ? positive : negative,
      (current) => delta > 0
        ? current.vehicle.position[coordinateIndex] >= target
        : current.vehicle.position[coordinateIndex] <= target,
      description,
      touchDriver,
    );
  }
  return alignWorldCoordinate(page, coordinateIndex, target, `${description} precise`, touchDriver, tolerance);
}

/** Spaceまたはtouch pointerで車種別主操作を押下・解除する。 */
async function setPrimaryAction(page, touch, pressed) {
  if (!touch) {
    if (pressed) await page.keyboard.down('Space');
    else await page.keyboard.up('Space');
    return;
  }
  const action = page.locator('.primary-action-button');
  const box = await action.boundingBox();
  assert(box, 'primary action bounding box is unavailable.');
  await action.dispatchEvent(pressed ? 'pointerdown' : 'pointerup', {
    button: 0,
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
    pointerId: 72,
    pointerType: 'touch',
  });
}

/** 1 viewportで選択、切替拒否、走行、3がれき、成功、帰庫を完遂する。 */
async function verifyViewport(browser, viewport, errors) {
  const context = await browser.newContext({
    hasTouch: viewport.touch,
    viewport: { height: viewport.height, width: viewport.width },
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${viewport.name}: console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`${viewport.name}: pageerror: ${String(error)}`));
  page.on('requestfailed', (request) => errors.push(
    `${viewport.name}: requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`,
  ));
  let activeTouchDriver = null;
  try {
    await page.goto(`${baseUrl}/voxel-game.html?vehicles=${viewport.name}-${Date.now()}`, {
      waitUntil: 'networkidle',
    });
    await page.waitForFunction(() => document.documentElement.dataset.voxelSceneReady === 'true'
      && typeof window.render_game_to_text === 'function'
      && typeof window.select_voxel_game_vehicle === 'function', undefined, { timeout: 10_000 });
    activeTouchDriver = viewport.touch ? await createTouchDriver(page) : null;

    const initial = await readGameState(page);
    assert.equal(initial.vehicle.id, 'fire-truck', `${viewport.name}: initial vehicle is not fire-truck.`);
    assert.equal(initial.vehicleSelection.selected, 'fire-truck');
    assert.equal(initial.vehicleSelection.canSwitch, true, `${viewport.name}: selector is unavailable at garage.`);
    assert.deepEqual(initial.vehicleSelection.available, ['fire-truck', 'bulldozer']);
    assert.equal(initial.controls.primaryAction, false);
    assert.equal(await page.getByTestId('physical-gpu-probe').count(), 0,
      `${viewport.name}: opt-in physical GPU probe leaked into normal play.`);

    const bulldozerButton = page.getByRole('button', { name: /ブルドーザー/ });
    if (viewport.touch) await bulldozerButton.tap();
    else await bulldozerButton.click();
    await waitForFrames(page, 3);
    const selected = await readGameState(page);
    assert.equal(selected.vehicle.id, 'bulldozer', `${viewport.name}: bulldozer switch failed.`);
    assert.equal(selected.mission.id, 'debris-clearance');
    assert.equal(selected.mission.objectiveLabel, 'こうじげんばへ いこう');
    assert.equal(await page.locator('.primary-action-button').getAttribute('aria-label'), 'ブレードを動かす');
    assert.equal(await bulldozerButton.getAttribute('aria-pressed'), 'true');
    const layout = await measureHudLayout(page, viewport);
    await page.screenshot({ path: `${outputDirectory}/${viewport.name}-bulldozer.png` });

    const hubGate = selected.visualLayout.worldSolids.find(({ id }) => id === 'hub-gate-post');
    assert(hubGate, `${viewport.name}: hub gate telemetry is unavailable.`);
    const gateBypassZ = hubGate.position[2] - hubGate.scale[2] / 2 - 4;
    await driveToCoordinate(
      page,
      2,
      gateBypassZ,
      `${viewport.name} garage exit and gate bypass`,
      activeTouchDriver,
      0.5,
    );
    const crate = selected.landmarks.bulldozerDebris.find(({ id }) => id === 'debris-crate');
    assert(crate, `${viewport.name}: crate debris telemetry is unavailable.`);
    const crateApproachX = crate.position[0] + 1.45;
    await driveToCoordinate(page, 0, crateApproachX, `${viewport.name} west road`, activeTouchDriver, 0.18);
    await driveToCoordinate(page, 2, 8, `${viewport.name} worksite approach`, activeTouchDriver, 0.45);
    await driveToCoordinate(page, 0, -23.5, `${viewport.name} worksite overview`, activeTouchDriver, 0.5);
    await page.screenshot({ path: `${outputDirectory}/${viewport.name}-worksite.png` });
    await driveToCoordinate(page, 0, crateApproachX, `${viewport.name} crate lane`, activeTouchDriver, 0.18);

    const outside = await readGameState(page);
    assert.equal(outside.vehicleSelection.canSwitch, false, `${viewport.name}: outside garage remained switchable.`);
    assert.equal(await page.locator('.vehicle-selector').count(), 0, `${viewport.name}: selector remained visible outside garage.`);
    assert.equal(await page.evaluate(() => window.select_voxel_game_vehicle?.('fire-truck')), false,
      `${viewport.name}: outside switch bypassed the gate.`);

    await setPrimaryAction(page, viewport.touch, true);
    await waitForFrames(page, 2);
    const actionStarted = await readGameState(page);
    assert.equal(actionStarted.controls.primaryAction, true,
      `${viewport.name}: primary action did not activate.`);
    await driveAlongWorldAxis(
      page,
      'positiveZ',
      (state) => state.bulldozer.clearedCount >= 1,
      `${viewport.name} clear crate`,
      activeTouchDriver,
    );
    await setPrimaryAction(page, viewport.touch, false);
    await alignWorldCoordinate(page, 2, 13, `${viewport.name} debris row`, activeTouchDriver, 0.5);
    await setPrimaryAction(page, viewport.touch, true);
    const completed = await driveAlongWorldAxis(
      page,
      'negativeX',
      (state) => state.bulldozer.clearedCount === state.bulldozer.targetCount,
      `${viewport.name} clear stone and timber`,
      activeTouchDriver,
    );
    await setPrimaryAction(page, viewport.touch, false);
    assert(['celebrating', 'freeRoam'].includes(completed.mission.phase),
      `${viewport.name}: completion phase is wrong: ${completed.mission.phase}.`);
    assert.equal(completed.fire.intensity, 1, `${viewport.name}: bulldozer action extinguished fire.`);
    assert.equal(completed.visuals.waterCubeCount, 0, `${viewport.name}: bulldozer action emitted water.`);

    await page.evaluate(() => window.advanceTime?.(1_800));
    await waitForFrames(page, 2);
    assert.equal((await readGameState(page)).mission.phase, 'freeRoam',
      `${viewport.name}: celebration did not reach freeRoam.`);

    await driveToCoordinate(page, 0, crateApproachX, `${viewport.name} return east`, activeTouchDriver, 0.5);
    await driveToCoordinate(page, 2, gateBypassZ, `${viewport.name} return gate bypass`, activeTouchDriver, 0.5);
    await driveToCoordinate(page, 0, 0, `${viewport.name} return hub`, activeTouchDriver, 0.6);
    await driveToCoordinate(page, 2, 6, `${viewport.name} return garage`, activeTouchDriver, 0.6);
    await waitForFrames(page, 4);
    const restarted = await readGameState(page);
    assert.equal(restarted.mission.phase, 'assigned', `${viewport.name}: garage did not restart mission.`);
    assert.equal(restarted.bulldozer.clearedCount, 0, `${viewport.name}: debris did not reset at garage.`);
    assert.equal(restarted.vehicleSelection.canSwitch, true, `${viewport.name}: switch did not reopen at garage.`);

    const fireTruckButton = page.getByRole('button', { name: /しょうぼうしゃ/ });
    if (viewport.touch) await fireTruckButton.tap();
    else await fireTruckButton.click();
    await waitForFrames(page, 3);
    const returnedToFireTruck = await readGameState(page);
    assert.equal(returnedToFireTruck.vehicle.id, 'fire-truck',
      `${viewport.name}: return switch to fire truck failed.`);
    assert.equal(returnedToFireTruck.mission.id, 'fire-rescue');
    assert.equal(await fireTruckButton.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.primary-action-button').getAttribute('aria-label'), '水を出す');
    await setPrimaryAction(page, viewport.touch, true);
    await waitForFrames(page, 3);
    const returnedWater = await readGameState(page);
    assert.equal(returnedWater.controls.primaryAction, true,
      `${viewport.name}: returned fire-truck action did not activate.`);
    assert(returnedWater.visuals.waterCubeCount > 0,
      `${viewport.name}: returned fire truck emitted no water.`);
    assert.equal(returnedWater.bulldozer.clearedCount, 0,
      `${viewport.name}: fire-truck action changed reset debris progress.`);
    await setPrimaryAction(page, viewport.touch, false);

    const renderer = await page.evaluate(() => {
      const canvas = document.querySelector('.voxel-game-canvas canvas');
      const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
      const extension = gl?.getExtension('WEBGL_debug_renderer_info');
      return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
    await activeTouchDriver?.releaseStick();
    return {
      completedPhase: completed.mission.phase,
      layout,
      renderer,
      returnedVehicle: returnedToFireTruck.vehicle.id,
      returnedWaterCubeCount: returnedWater.visuals.waterCubeCount,
      restartedMission: restarted.mission,
      selectedVehicle: selected.vehicle.id,
    };
  } finally {
    await activeTouchDriver?.releaseStick();
    await page.keyboard.up('Space').catch(() => undefined);
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
const errors = [];
const results = {};
try {
  for (const viewport of viewports) {
    results[viewport.name] = await verifyViewport(browser, viewport, errors);
  }
  assert.deepEqual(errors, [], `browser errors: ${JSON.stringify(errors, null, 2)}`);
  const manifest = {
    generatedAt: new Date().toISOString(),
    note: 'Docker renderer measurements are diagnostic only and are not physical GPU certification.',
    results,
    screenshots: viewports.flatMap(({ name }) => [
      `${name}-bulldozer.png`,
      `${name}-worksite.png`,
    ]),
    viewports,
  };
  fs.writeFileSync(`${outputDirectory}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  await browser.close();
}

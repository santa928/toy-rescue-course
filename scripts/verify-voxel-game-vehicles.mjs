import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import {
  createDomTouchStickDriver,
  createDriveHarness,
} from './voxel-game-e2e/drive-harness.mjs';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:5173';
const outputDirectory = 'output/voxel-game-vehicles';
const viewports = [
  { height: 720, name: 'desktop', touch: false, width: 1_280 },
  { height: 768, name: 'tablet', touch: true, width: 1_024 },
  { height: 390, name: 'mobile-landscape', touch: true, width: 844 },
];

const driveHarness = createDriveHarness({
  alignAttemptLimit: 28,
  brakeFrameLimit: 180,
  defaultMaxBursts: 420,
  pulseDistanceMultiplier: 1.4,
  requiredFields: [
    'bulldozer',
    'controls',
    'landmarks',
    'mission',
    'vehicle',
    'vehicleSelection',
    'visuals',
    'world',
  ],
  resetContext: (latest, previous) => ({
    current: latest.vehicle,
    previous: previous?.vehicle,
    previousBladeCenter: previous?.bulldozer?.bladeCenter,
    previousControls: previous?.controls,
  }),
  sampleBeforeBurst: false,
});
const {
  brakeVehicle,
  readGameState,
  waitForFrames,
} = driveHarness;

fs.rmSync(outputDirectory, { force: true, recursive: true });
fs.mkdirSync(outputDirectory, { recursive: true });

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

/** 二車種E2E用pointer identityで共有DOM touch driverを作る。 */
async function createTouchDriver(page) {
  return createDomTouchStickDriver(page, { pointerId: 71 });
}

/** 二車種固有reset診断を足して共有world cardinal走行を呼ぶ。 */
async function driveAlongWorldAxis(page, axis, predicate, description, touchDriver, maxBursts = 420) {
  return driveHarness.driveAlongWorldAxis(page, {
    axis,
    description,
    maxBursts,
    predicate,
    touchDriver,
  });
}

/** 既存の引数順を保って共有X/Z alignを呼ぶ。 */
async function alignWorldCoordinate(page, coordinateIndex, target, description, touchDriver, tolerance = 0.4) {
  return driveHarness.alignWorldCoordinate(page, {
    coordinateIndex,
    description,
    target,
    tolerance,
    touchDriver,
  });
}

/** 既存の引数順を保って共有coarse+precise走行を呼ぶ。 */
async function driveToCoordinate(page, coordinateIndex, target, description, touchDriver, tolerance = 0.4) {
  return driveHarness.driveToCoordinate(page, {
    coordinateIndex,
    description,
    target,
    tolerance,
    touchDriver,
  });
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
    assert.equal(selected.mission.jobId, 'debris-north');
    assert.equal(selected.mission.jobLabel, 'きたのがれきをかたづけよう');
    assert.equal(selected.mission.jobCycle, 1);
    assert.equal(selected.mission.objectiveLabel, selected.mission.jobLabel);
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
    assert.equal(restarted.mission.jobId, 'debris-north',
      `${viewport.name}: hidden job rotation changed the fixed scene.`);
    assert.equal(restarted.mission.jobCycle, 1,
      `${viewport.name}: hidden job rotation advanced before scene integration.`);
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

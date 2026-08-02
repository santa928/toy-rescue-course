import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import * as THREE from 'three';
import {
  createDomTouchStickDriver,
  createDriveHarness,
} from './voxel-game-e2e/drive-harness.mjs';

const baseUrl = (process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const outputDirectory = process.env.VOXEL_GAME_STREETSCAPE_OUTPUT
  ?? 'output/voxel-game-streetscape';
const allViewports = [
  { height: 720, name: 'desktop', touch: false, width: 1_280 },
  { height: 768, name: 'tablet', touch: true, width: 1_024 },
  { height: 390, name: 'mobile-landscape', touch: true, width: 844 },
];
const viewportFilter = process.env.VOXEL_GAME_STREETSCAPE_VIEWPORT || null;
const viewports = viewportFilter === null
  ? allViewports
  : allViewports.filter(({ name }) => name === viewportFilter);
assert(viewports.length > 0, `Unknown VOXEL_GAME_STREETSCAPE_VIEWPORT: ${viewportFilter}.`);

const districtScenarios = [
  { districtId: 'hub', representativeSolidId: 'hub-tool-rack-post' },
  { districtId: 'park', representativeSolidId: 'park-picnic-table' },
  { districtId: 'fire', representativeSolidId: 'fire-hydrant-body' },
  { districtId: 'blocks', representativeSolidId: 'blocks-fence-post' },
  { districtId: 'south', representativeSolidId: 'south-viewing-bench' },
  { districtId: 'construction', representativeSolidId: 'construction-work-lamp-post' },
  { districtId: 'town', representativeSolidId: 'town-west-lamp-post' },
];
const harness = createDriveHarness({
  alignAttemptLimit: 48,
  brakeFrameLimit: 240,
  defaultMaxBursts: 520,
  pulseDistanceMultiplier: 1.5,
  requiredFields: [
    'camera',
    'controls',
    'renderer',
    'vehicle',
    'visualLayout',
    'world',
  ],
});
const {
  driveAlongWorldAxis,
  driveToCoordinate,
  pulseWorldAxis,
  readGameState,
  waitForFrames,
} = harness;

fs.mkdirSync(outputDirectory, { recursive: true });
const manifestPath = `${outputDirectory}/manifest.json`;

/** JSON manifestを途中失敗でも解析できる改行付き形式で保存する。 */
function writeManifest(manifest) {
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Playwright矩形へ右端・下端を加え、安全余白の比較単位へ変換する。 */
function toEdges(box) {
  return {
    bottom: box.y + box.height,
    height: box.height,
    left: box.x,
    right: box.x + box.width,
    top: box.y,
    width: box.width,
  };
}

/** 交差しない2矩形間の最短距離を返す。 */
function rectDistance(left, right) {
  const horizontal = Math.max(left.left - right.right, right.left - left.right, 0);
  const vertical = Math.max(left.top - right.bottom, right.top - left.bottom, 0);
  return Math.hypot(horizontal, vertical);
}

/** 主要HUDを実寸測定し、viewport内包と8px安全余白を検証する。 */
async function measureHud(page, viewport) {
  const selectors = {
    action: '.primary-action-button',
    audio: '.audio-toggle-button',
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
    assert(box.left >= 0 && box.top >= 0
      && box.right <= viewport.width && box.bottom <= viewport.height,
    `${viewport.name}: ${name} exceeds viewport: ${JSON.stringify(box)}.`);
  }
  for (const [leftName, rightName] of [
    ['fullscreen', 'audio'],
    ['selector', 'mission'],
    ['mission', 'fullscreen'],
    ['mission', 'audio'],
    ['joystick', 'action'],
  ]) {
    assert(rectDistance(boxes[leftName], boxes[rightName]) >= 8,
      `${viewport.name}: ${leftName}/${rightName} lack 8px gap: ${JSON.stringify(boxes)}.`);
  }
  return boxes;
}

/** camera telemetryでworld座標を現在viewportへ投影する。 */
function projectWorldPoint(cameraTelemetry, position) {
  const { height, width } = cameraTelemetry.viewport;
  const camera = new THREE.OrthographicCamera(width / -2, width / 2, height / 2, height / -2);
  camera.position.fromArray(cameraTelemetry.position);
  camera.zoom = cameraTelemetry.zoom;
  camera.lookAt(new THREE.Vector3(...cameraTelemetry.lookTarget));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const projected = new THREE.Vector3(...position).project(camera);
  return [(projected.x + 1) * width / 2, (1 - projected.y) * height / 2];
}

/** 代表solidがCanvas安全域にあり主要HUDの下へ隠れないことを検証する。 */
function assertRepresentativeVisible(state, solidId, hud, viewport) {
  const solid = state.visualLayout.worldSolids.find(({ id }) => id === solidId);
  assert(solid, `${viewport.name}: world solid telemetry lacks ${solidId}.`);
  const visibleTopCenter = [
    solid.position[0],
    solid.position[1] + solid.scale[1] / 2,
    solid.position[2],
  ];
  const [x, y] = projectWorldPoint(state.camera, visibleTopCenter);
  const margin = 16;
  assert(x >= margin && x <= viewport.width - margin
    && y >= margin && y <= viewport.height - margin,
  `${viewport.name}: ${solidId} is outside canvas safety: ${JSON.stringify({ x, y })}.`);
  const hiddenBy = Object.entries(hud).find(([, box]) => (
    x >= box.left - margin && x <= box.right + margin
    && y >= box.top - margin && y <= box.bottom + margin
  ));
  assert.equal(hiddenBy, undefined,
    `${viewport.name}: ${solidId} is hidden by HUD: ${JSON.stringify({ hiddenBy, x, y })}.`);
  return { solidId, x, y };
}

/** previewまたは公開URLが応答するまで30秒だけpollする。 */
async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // preview起動待ちは次のpollで再試行する。
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Voxel Game streetscape server did not become ready: ${baseUrl}`);
}

/** 車両を初期車庫へ戻し、物理とcameraが同期した状態を返す。 */
async function resetToHub(page) {
  await page.evaluate(() => window.reset_voxel_game_vehicle?.());
  await waitForFrames(page, 8);
  const state = await readGameState(page);
  assert.equal(state.world.currentDistrict, 'hub');
  return state;
}

/** 車庫から公園の中央道路へ実入力で移動する。 */
async function driveToPark(page, viewport, touchDriver) {
  return driveAlongWorldAxis(page, {
    axis: 'negativeZ',
    description: `${viewport.name}: streetscape park center`,
    predicate: (state) => state.vehicle.position[2] <= (
      viewport.name === 'mobile-landscape' ? -19 : -14.5
    ),
    touchDriver,
  });
}

/** 車庫から火災地区の西側歩道へ実入力で移動する。 */
async function driveToFire(page, viewport, touchDriver) {
  await driveAlongWorldAxis(page, {
    axis: 'negativeZ',
    brakeAfterArrival: false,
    description: `${viewport.name}: streetscape fire garage exit`,
    predicate: (state) => state.vehicle.position[2] <= 0,
    touchDriver,
  });
  await driveToCoordinate(page, {
    coordinateIndex: 0,
    description: `${viewport.name}: streetscape fire east-west road`,
    target: 20,
    tolerance: 0.4,
    touchDriver,
  });
  return driveToCoordinate(page, {
    coordinateIndex: 2,
    description: `${viewport.name}: streetscape fire west sidewalk`,
    target: viewport.name === 'mobile-landscape' ? -12 : -8,
    tolerance: 0.4,
    touchDriver,
  });
}

/** 車庫から積み木広場南側の入口セットへ実入力で移動する。 */
async function driveToBlocks(page, viewport, touchDriver) {
  await driveAlongWorldAxis(page, {
    axis: 'negativeZ',
    brakeAfterArrival: false,
    description: `${viewport.name}: streetscape blocks garage exit`,
    predicate: (state) => state.vehicle.position[2] <= 0,
    touchDriver,
  });
  await driveToCoordinate(page, {
    coordinateIndex: 2,
    description: `${viewport.name}: streetscape blocks gate clearance`,
    target: -3,
    tolerance: 0.4,
    touchDriver,
  });
  await driveToCoordinate(page, {
    coordinateIndex: 0,
    description: `${viewport.name}: streetscape blocks east-west road`,
    target: -20,
    tolerance: 0.4,
    touchDriver,
  });
  return driveToCoordinate(page, {
    coordinateIndex: 2,
    description: `${viewport.name}: streetscape blocks entrance`,
    target: -6,
    tolerance: 0.4,
    touchDriver,
  });
}

/** 車庫から南地区中央へ実入力で移動する。 */
async function driveToSouth(page, viewport, touchDriver) {
  await driveAlongWorldAxis(page, {
    axis: 'negativeZ',
    brakeAfterArrival: false,
    description: `${viewport.name}: streetscape south garage exit`,
    predicate: (state) => state.vehicle.position[2] <= 0,
    touchDriver,
  });
  await driveToCoordinate(page, {
    coordinateIndex: 2,
    description: `${viewport.name}: streetscape south gate clearance`,
    target: -3,
    tolerance: 0.4,
    touchDriver,
  });
  await driveToCoordinate(page, {
    coordinateIndex: 0,
    description: `${viewport.name}: streetscape south garage bypass`,
    target: -8,
    tolerance: 0.4,
    touchDriver,
  });
  await driveToCoordinate(page, {
    coordinateIndex: 2,
    description: `${viewport.name}: streetscape south bypass latitude`,
    target: 12,
    tolerance: 0.4,
    touchDriver,
  });
  await driveToCoordinate(page, {
    coordinateIndex: 0,
    description: `${viewport.name}: streetscape south center lane`,
    target: 0,
    tolerance: 0.4,
    touchDriver,
  });
  return driveToCoordinate(page, {
    coordinateIndex: 2,
    description: `${viewport.name}: streetscape south center`,
    target: 24,
    tolerance: 0.4,
    touchDriver,
  });
}

/** 車庫から公園接続を通り、こうじヤード東入口の作業灯前へ移動する。 */
async function driveToConstruction(page, viewport, touchDriver) {
  await driveAlongWorldAxis(page, {
    axis: 'negativeZ',
    brakeAfterArrival: false,
    description: `${viewport.name}: streetscape construction garage exit`,
    predicate: (state) => state.vehicle.position[2] <= -3,
    touchDriver,
  });
  await driveToCoordinate(page, {
    coordinateIndex: 0,
    description: `${viewport.name}: streetscape construction park west road`,
    target: -12,
    tolerance: 0.4,
    touchDriver,
  });
  await driveAlongWorldAxis(page, {
    axis: 'negativeZ',
    brakeAfterArrival: false,
    description: `${viewport.name}: streetscape construction connector`,
    predicate: (state) => state.vehicle.position[2] <= -31,
    touchDriver,
  });
  await driveToCoordinate(page, {
    coordinateIndex: 0,
    description: `${viewport.name}: streetscape construction work light`,
    target: -19.3,
    tolerance: 0.4,
    touchDriver,
  });
  return driveToCoordinate(page, {
    coordinateIndex: 2,
    description: `${viewport.name}: streetscape construction work light clearance`,
    target: -32,
    tolerance: 0.4,
    touchDriver,
  });
}

/** 車庫から火災地区接続を通り、おもちゃのまち西入口の街灯前へ移動する。 */
async function driveToTown(page, viewport, touchDriver) {
  await driveAlongWorldAxis(page, {
    axis: 'negativeZ',
    brakeAfterArrival: false,
    description: `${viewport.name}: streetscape town garage exit`,
    predicate: (state) => state.vehicle.position[2] <= 0,
    touchDriver,
  });
  await driveToCoordinate(page, {
    coordinateIndex: 0,
    description: `${viewport.name}: streetscape town west connector`,
    target: 17,
    tolerance: 0.4,
    touchDriver,
  });
  await driveToCoordinate(page, {
    coordinateIndex: 2,
    description: `${viewport.name}: streetscape town west road`,
    target: 31,
    tolerance: 0.4,
    touchDriver,
  });
  return driveToCoordinate(page, {
    coordinateIndex: 0,
    description: `${viewport.name}: streetscape town west entry alignment`,
    target: 17,
    tolerance: 0.4,
    touchDriver,
  });
}

/** 地区ごとの実入力routeを実行し、capture可能な停止状態を返す。 */
async function driveToDistrict(page, viewport, touchDriver, districtId) {
  if (districtId === 'hub') return readGameState(page);
  if (districtId === 'park') return driveToPark(page, viewport, touchDriver);
  if (districtId === 'fire') return driveToFire(page, viewport, touchDriver);
  if (districtId === 'blocks') return driveToBlocks(page, viewport, touchDriver);
  if (districtId === 'south') return driveToSouth(page, viewport, touchDriver);
  if (districtId === 'construction') return driveToConstruction(page, viewport, touchDriver);
  return driveToTown(page, viewport, touchDriver);
}

/** surface／装飾／collider countとdraw call budgetを実描画snapshotで検証する。 */
function assertWorldBudgets(state, viewport, districtId) {
  assert.equal(state.world.currentDistrict, districtId,
    `${viewport.name}: expected ${districtId}, received ${state.world.currentDistrict}: ${JSON.stringify(state.vehicle)}.`);
  assert.equal(state.world.surfaceTileCount, 19);
  assert.equal(state.world.decorationClusterCount, 21);
  assert.equal(state.world.decorationBoxCount, 54);
  assert.equal(state.world.staticColliderCount, 40);
  assert.equal(state.visualLayout.worldSolids.length, 40);
  assert(state.renderer.rendererCalls > 0 && state.renderer.rendererCalls <= 34,
    `${viewport.name}/${districtId}: renderer calls outside 1..34: ${state.renderer.rendererCalls}.`);
}

/** 中央入口の非solidガイドを車体中心が越えられることをdesktop実入力で確認する。 */
async function verifyNonSolidPassThrough(page, viewport, touchDriver) {
  await driveToCoordinate(page, {
    coordinateIndex: 2,
    description: `${viewport.name}: non-solid guide latitude`,
    target: -5.6,
    tolerance: 0.3,
    touchDriver,
  });
  const crossed = await driveToCoordinate(page, {
    coordinateIndex: 0,
    description: `${viewport.name}: non-solid guide pass-through`,
    target: -8,
    tolerance: 0.35,
    touchDriver,
  });
  assert(crossed.vehicle.position[0] <= -7.65,
    `Non-solid entry guide blocked the vehicle: ${JSON.stringify(crossed.vehicle)}.`);
  return crossed.vehicle.position;
}

/** 公園ピクニック卓へ横から押し当て、代表の新solidを車両が貫通しないことを確認する。 */
async function verifyNewSolidCollision(page, viewport, touchDriver, initialResetCount) {
  await pulseWorldAxis(page, {
    axis: 'negativeX',
    description: `${viewport.name}: park picnic table collision`,
    frameCount: 100,
    touchDriver,
  });
  const collided = await readGameState(page);
  assert.equal(collided.vehicle.resetCount, initialResetCount);
  assert(collided.vehicle.position[0] >= -3.35 && collided.vehicle.position[0] < -1,
    `Park picnic table solid collision failed: ${JSON.stringify(collided.vehicle)}.`);
  return collided.vehicle.position;
}

/** 1 viewportで7地区の床、街角、HUDとdesktop物理を検証する。 */
async function verifyViewport(browser, viewport) {
  const browserErrors = [];
  const context = await browser.newContext({
    hasTouch: viewport.touch,
    viewport: { height: viewport.height, width: viewport.width },
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${String(error)}`));
  page.on('requestfailed', (request) => browserErrors.push(
    `requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`,
  ));
  let touchDriver = null;
  try {
    await page.goto(`${baseUrl}/?streetscape=${viewport.name}-${Date.now()}&job-seed=1`, {
      waitUntil: 'networkidle',
    });
    await page.waitForFunction(() => document.documentElement.dataset.voxelSceneReady === 'true'
      && typeof window.render_game_to_text === 'function', undefined, { timeout: 10_000 });
    touchDriver = viewport.touch
      ? await createDomTouchStickDriver(page, { pointerId: 101 })
      : null;
    const hud = await measureHud(page, viewport);
    const initial = await readGameState(page);
    assert.deepEqual(initial.world.districts.map(({ id }) => id), [
      'hub', 'park', 'fire', 'blocks', 'south', 'construction', 'town',
    ]);
    const captures = [];
    let nonSolidPassThroughPosition = null;
    let solidCollisionPosition = null;

    for (const scenario of districtScenarios) {
      if (scenario.districtId !== 'hub') await resetToHub(page);
      await driveToDistrict(page, viewport, touchDriver, scenario.districtId);
      await waitForFrames(page, 8);
      const state = await readGameState(page);
      assertWorldBudgets(state, viewport, scenario.districtId);
      const projection = assertRepresentativeVisible(
        state,
        scenario.representativeSolidId,
        hud,
        viewport,
      );
      const screenshotPath = `${outputDirectory}/${viewport.name}-${scenario.districtId}.png`;
      await page.screenshot({ path: screenshotPath });
      captures.push({
        districtId: scenario.districtId,
        projection,
        rendererCalls: state.renderer.rendererCalls,
        screenshotPath,
        vehiclePosition: state.vehicle.position,
        world: state.world,
      });

      if (viewport.name === 'desktop' && scenario.districtId === 'hub') {
        nonSolidPassThroughPosition = await verifyNonSolidPassThrough(
          page,
          viewport,
          touchDriver,
        );
      }
      if (viewport.name === 'desktop' && scenario.districtId === 'park') {
        solidCollisionPosition = await verifyNewSolidCollision(
          page,
          viewport,
          touchDriver,
          state.vehicle.resetCount,
        );
      }
    }

    assert.deepEqual(browserErrors, [], `${viewport.name}: browser errors: ${browserErrors.join(' | ')}`);
    return {
      browserErrors,
      captures,
      hud,
      nonSolidPassThroughPosition,
      solidCollisionPosition,
      viewport,
    };
  } finally {
    if (touchDriver) await touchDriver.releaseStick().catch(() => {});
    await context.close();
  }
}

const priorManifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : { results: {} };
const manifest = {
  baseUrl,
  generatedAt: new Date().toISOString(),
  results: priorManifest.results ?? {},
  status: 'running',
};
writeManifest(manifest);

await waitForServer();
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of viewports) {
    manifest.results[viewport.name] = await verifyViewport(browser, viewport);
    manifest.generatedAt = new Date().toISOString();
    writeManifest(manifest);
  }
  manifest.status = 'completed';
  writeManifest(manifest);
  console.log(JSON.stringify(manifest, null, 2));
} catch (error) {
  manifest.error = String(error instanceof Error ? error.stack ?? error.message : error);
  manifest.status = 'failed';
  writeManifest(manifest);
  throw error;
} finally {
  await browser.close();
}

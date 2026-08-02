import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import * as THREE from 'three';
import {
  createDomTouchStickDriver,
  createDriveHarness,
} from './voxel-game-e2e/drive-harness.mjs';

const baseUrl = (process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const outputDirectory = process.env.VOXEL_GAME_MAP_OUTPUT ?? 'output/voxel-game-map';
const allViewports = [
  { height: 720, name: 'desktop', touch: false, width: 1_280 },
  { height: 768, name: 'tablet', touch: true, width: 1_024 },
  { height: 390, name: 'mobile-landscape', touch: true, width: 844 },
];
const viewportFilter = process.env.VOXEL_GAME_MAP_VIEWPORT || null;
const viewports = viewportFilter === null
  ? allViewports
  : allViewports.filter(({ name }) => name === viewportFilter);
assert(viewports.length > 0, `Unknown VOXEL_GAME_MAP_VIEWPORT: ${viewportFilter}.`);
const CONSTRUCTION_ROUTE_DISTANCE_UNITS = 55;
const TOWN_ROUTE_DISTANCE_UNITS = 55;
assert(CONSTRUCTION_ROUTE_DISTANCE_UNITS <= 72 && TOWN_ROUTE_DISTANCE_UNITS <= 72,
  'Expansion route geometry exceeds the 72unit density budget.');

const harness = createDriveHarness({
  alignAttemptLimit: 44,
  brakeFrameLimit: 220,
  defaultMaxBursts: 500,
  pulseDistanceMultiplier: 1.5,
  requiredFields: [
    'camera',
    'controls',
    'landmarks',
    'renderer',
    'vehicle',
    'visualLayout',
    'world',
  ],
});
const {
  alignWorldCoordinate,
  driveAlongWorldAxis,
  driveToCoordinate,
  pulseWorldAxis,
  readGameState,
  waitForFrames,
} = harness;

fs.mkdirSync(outputDirectory, { recursive: true });

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

/** world solidをIDで解決し、欠落時は対象地区の検証を停止する。 */
function requireWorldSolid(state, id) {
  const solid = state.visualLayout.worldSolids.find((candidate) => candidate.id === id);
  assert(solid, `World solid telemetry lacks ${id}.`);
  return solid;
}

/** 代表ランドマークがCanvas安全域にあり、主要HUDの下へ隠れないことを検証する。 */
function assertLandmarkVisible(state, solid, hud, viewport) {
  const [x, y] = projectWorldPoint(state.camera, solid.position);
  const margin = 18;
  assert(x >= margin && x <= viewport.width - margin
    && y >= margin && y <= viewport.height - margin,
  `${viewport.name}: ${solid.id} is outside canvas safety: ${JSON.stringify({
    camera: state.camera,
    vehicle: state.vehicle,
    x,
    y,
  })}.`);
  const hiddenBy = Object.entries(hud).find(([, box]) => (
    x >= box.left - margin && x <= box.right + margin
    && y >= box.top - margin && y <= box.bottom + margin
  ));
  assert.equal(hiddenBy, undefined,
    `${viewport.name}: ${solid.id} is hidden by HUD: ${JSON.stringify({ hiddenBy, x, y })}.`);
  return [x, y];
}

/** base URLが応答するまで短いpollを行う。 */
async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // preview起動中または公開URLの一時接続待ちは次のpollで再試行する。
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Voxel Game map server did not become ready: ${baseUrl}`);
}

/** 車庫から北の公園側接続を通り、こうじヤード中心へ実入力で到達する。 */
async function driveToConstruction(page, viewport, touchDriver) {
  const startedAtMs = Date.now();
  await driveAlongWorldAxis(page, {
    axis: 'negativeZ',
    brakeAfterArrival: false,
    description: `${viewport.name}: construction garage exit`,
    predicate: (state) => state.vehicle.position[2] <= -3,
    touchDriver,
  });
  await driveToCoordinate(page, {
    coordinateIndex: 0,
    description: `${viewport.name}: construction park lane`,
    target: -12,
    tolerance: 0.35,
    touchDriver,
  });
  await driveAlongWorldAxis(page, {
    axis: 'negativeZ',
    brakeAfterArrival: false,
    description: `${viewport.name}: construction park connector latitude`,
    predicate: (state) => state.vehicle.position[2] <= -31,
    touchDriver,
  });
  const arrived = await driveAlongWorldAxis(page, {
    axis: 'negativeX',
    description: `${viewport.name}: construction east entry`,
    predicate: (state) => state.vehicle.position[0] <= -19,
    touchDriver,
  });
  const durationSeconds = (Date.now() - startedAtMs) / 1_000;
  assert.equal(arrived.world.currentDistrict, 'construction');
  return {
    arrived,
    durationSeconds,
    routeDistanceUnits: CONSTRUCTION_ROUTE_DISTANCE_UNITS,
  };
}

/** こうじヤードの詰所へ押し当て、共有solidを貫通しないことを検証する。 */
async function collideWithConstructionOffice(page, viewport, touchDriver, initialResetCount) {
  await driveToCoordinate(page, {
    coordinateIndex: 0,
    description: `${viewport.name}: construction capture clearance`,
    target: -45,
    tolerance: 0.35,
    touchDriver,
  });
  await driveToCoordinate(page, {
    coordinateIndex: 2,
    description: `${viewport.name}: construction north recovery`,
    target: -44,
    tolerance: 0.35,
    touchDriver,
  });
  await driveToCoordinate(page, {
    coordinateIndex: 0,
    description: `${viewport.name}: construction office staging`,
    target: -31,
    tolerance: 0.35,
    touchDriver,
  });
  await alignWorldCoordinate(page, {
    coordinateIndex: 2,
    description: `${viewport.name}: construction office lane`,
    target: -37,
    tolerance: 0.35,
    touchDriver,
  });
  await pulseWorldAxis(page, {
    axis: 'negativeX',
    description: `${viewport.name}: construction office collision`,
    frameCount: 90,
    touchDriver,
  });
  const collided = await readGameState(page);
  assert.equal(collided.vehicle.resetCount, initialResetCount);
  assert(collided.vehicle.position[0] < -32 && collided.vehicle.position[0] >= -33.75,
    `${viewport.name}: construction office collision failed: ${JSON.stringify(collided.vehicle)}.`);
  return collided;
}

/** 公園側から入ったこうじヤードを南側から積み木地区へ抜ける。 */
async function exitConstructionToBlocks(page, viewport, touchDriver) {
  await driveToCoordinate(page, {
    coordinateIndex: 0,
    description: `${viewport.name}: construction office recovery`,
    target: -31,
    tolerance: 0.4,
    touchDriver,
  });
  await driveToCoordinate(page, {
    coordinateIndex: 2,
    description: `${viewport.name}: construction north recovery road`,
    target: -44,
    tolerance: 0.4,
    touchDriver,
  });
  await driveToCoordinate(page, {
    coordinateIndex: 0,
    description: `${viewport.name}: construction west exit`,
    target: -44,
    tolerance: 0.4,
    touchDriver,
  });
  await driveAlongWorldAxis(page, {
    axis: 'positiveZ',
    brakeAfterArrival: false,
    description: `${viewport.name}: construction south exit latitude`,
    predicate: (state) => state.vehicle.position[2] >= -18,
    touchDriver,
  });
  await driveAlongWorldAxis(page, {
    axis: 'positiveX',
    brakeAfterArrival: false,
    description: `${viewport.name}: construction blocks connector longitude`,
    predicate: (state) => state.vehicle.position[0] >= -32,
    touchDriver,
  });
  return driveAlongWorldAxis(page, {
    axis: 'positiveZ',
    description: `${viewport.name}: construction exit to blocks`,
    predicate: (state) => state.world.currentDistrict === 'blocks',
    touchDriver,
  });
}

/** 車庫から火災地区を通り、おもちゃのまち西入口へ到達する。 */
async function driveToTown(page, viewport, touchDriver) {
  const startedAtMs = Date.now();
  await driveAlongWorldAxis(page, {
    axis: 'negativeZ',
    brakeAfterArrival: false,
    description: `${viewport.name}: town garage exit`,
    predicate: (state) => state.vehicle.position[2] <= 0,
    touchDriver,
  });
  await driveAlongWorldAxis(page, {
    axis: 'positiveX',
    brakeAfterArrival: false,
    description: `${viewport.name}: town west connector longitude`,
    predicate: (state) => state.vehicle.position[0] >= 18,
    touchDriver,
  });
  await driveAlongWorldAxis(page, {
    axis: 'positiveZ',
    brakeAfterArrival: false,
    description: `${viewport.name}: town west road`,
    predicate: (state) => state.vehicle.position[2] >= 31,
    touchDriver,
  });
  const arrived = await driveToCoordinate(page, {
    coordinateIndex: 0,
    description: `${viewport.name}: town west entry alignment`,
    target: 18,
    tolerance: 0.35,
    touchDriver,
  });
  const durationSeconds = (Date.now() - startedAtMs) / 1_000;
  assert.equal(arrived.world.currentDistrict, 'town');
  return { arrived, durationSeconds, routeDistanceUnits: TOWN_ROUTE_DISTANCE_UNITS };
}

/** 赤い家へ押し当て、おもちゃのまちの共有solidを貫通しないことを確認する。 */
async function collideWithTownHouse(page, viewport, touchDriver, initialResetCount) {
  await driveToCoordinate(page, {
    coordinateIndex: 2,
    description: `${viewport.name}: town red house staging`,
    target: 25,
    tolerance: 0.35,
    touchDriver,
  });
  await pulseWorldAxis(page, {
    axis: 'positiveX',
    description: `${viewport.name}: town red house collision`,
    frameCount: 90,
    touchDriver,
  });
  const collided = await readGameState(page);
  assert.equal(collided.vehicle.resetCount, initialResetCount);
  assert(collided.vehicle.position[0] > 19.5 && collided.vehicle.position[0] <= 20.8,
    `${viewport.name}: town house collision failed: ${JSON.stringify(collided.vehicle)}.`);
  return collided;
}

/** おもちゃのまち西側から南地区へ抜け、2方向接続を確認する。 */
async function exitTownToSouth(page, viewport, touchDriver) {
  await driveToCoordinate(page, {
    coordinateIndex: 0,
    description: `${viewport.name}: town collision recovery`,
    target: 18,
    tolerance: 0.5,
    touchDriver,
  });
  await driveToCoordinate(page, {
    coordinateIndex: 2,
    description: `${viewport.name}: town south connector latitude`,
    target: 24,
    tolerance: 0.5,
    touchDriver,
  });
  return driveAlongWorldAxis(page, {
    axis: 'negativeX',
    description: `${viewport.name}: town exit to south`,
    predicate: (state) => state.world.currentDistrict === 'south',
    touchDriver,
  });
}

/** 1 viewportで追加2地区の入口・中心・別出口・solid・HUDを実操作検証する。 */
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
  let touchDriver = null;
  try {
    await page.goto(`${baseUrl}/?map-expansion=${viewport.name}-${Date.now()}&job-seed=1`, {
      waitUntil: 'networkidle',
    });
    await page.waitForFunction(() => document.documentElement.dataset.voxelSceneReady === 'true'
      && typeof window.render_game_to_text === 'function', undefined, { timeout: 10_000 });
    touchDriver = viewport.touch
      ? await createDomTouchStickDriver(page, { pointerId: 91 })
      : null;

    const initial = await readGameState(page);
    assert.deepEqual(initial.world.bounds, {
      maxX: 48, maxZ: 48, minX: -48, minZ: -48,
    });
    assert.deepEqual(initial.world.districts.map(({ id }) => id), [
      'hub', 'park', 'fire', 'blocks', 'south', 'construction', 'town',
    ]);
    assert.deepEqual(initial.landmarks.construction, [-31, 0, -31]);
    assert.deepEqual(initial.landmarks.town, [31, 0, 31]);
    assert.equal(initial.visualLayout.worldSolids.length, 40);
    const initialResetCount = initial.vehicle.resetCount;
    const hud = await measureHud(page, viewport);

    const construction = await driveToConstruction(page, viewport, touchDriver);
    await driveToCoordinate(page, {
      coordinateIndex: 0,
      description: `${viewport.name}: construction east bypass`,
      target: -14,
      tolerance: 0.35,
      touchDriver,
    });
    await driveToCoordinate(page, {
      coordinateIndex: 2,
      description: `${viewport.name}: construction north bypass`,
      target: -44,
      tolerance: 0.35,
      touchDriver,
    });
    await driveToCoordinate(page, {
      coordinateIndex: 0,
      description: `${viewport.name}: construction capture longitude`,
      target: -43,
      tolerance: 0.35,
      touchDriver,
    });
    await driveToCoordinate(page, {
      coordinateIndex: 2,
      description: `${viewport.name}: construction capture heading`,
      target: -32,
      tolerance: 0.35,
      touchDriver,
    });
    await waitForFrames(page, 6);
    const constructionState = await readGameState(page);
    const constructionLandmark = requireWorldSolid(constructionState, 'construction-office-body');
    const constructionProjection = assertLandmarkVisible(
      constructionState,
      constructionLandmark,
      hud,
      viewport,
    );
    await page.screenshot({
      path: `${outputDirectory}/${viewport.name}-construction.png`,
    });
    const constructionCollision = await collideWithConstructionOffice(
      page,
      viewport,
      touchDriver,
      initialResetCount,
    );
    const blocksExit = await exitConstructionToBlocks(page, viewport, touchDriver);
    assert.equal(blocksExit.world.currentDistrict, 'blocks');

    await page.evaluate(() => window.reset_voxel_game_vehicle?.());
    await waitForFrames(page, 6);
    const reset = await readGameState(page);
    assert.equal(reset.world.currentDistrict, 'hub');
    const town = await driveToTown(page, viewport, touchDriver);
    await waitForFrames(page, 6);
    const townState = await readGameState(page);
    const townLandmark = requireWorldSolid(townState, 'town-west-lamp-post');
    const townProjection = assertLandmarkVisible(townState, townLandmark, hud, viewport);
    await page.screenshot({ path: `${outputDirectory}/${viewport.name}-town.png` });
    const townCollision = await collideWithTownHouse(
      page,
      viewport,
      touchDriver,
      reset.vehicle.resetCount,
    );
    const southExit = await exitTownToSouth(page, viewport, touchDriver);
    assert.equal(southExit.world.currentDistrict, 'south');
    assert.deepEqual(errors, [], `${viewport.name}: browser errors: ${errors.join(' | ')}`);

    return {
      construction: {
        collisionPosition: constructionCollision.vehicle.position,
        durationSeconds: construction.durationSeconds,
        projection: constructionProjection,
        routeDistanceUnits: construction.routeDistanceUnits,
      },
      exits: { construction: blocksExit.world.currentDistrict, town: southExit.world.currentDistrict },
      hud,
      rendererCalls: Math.max(constructionState.renderer.rendererCalls, townState.renderer.rendererCalls),
      town: {
        collisionPosition: townCollision.vehicle.position,
        durationSeconds: town.durationSeconds,
        projection: townProjection,
        routeDistanceUnits: town.routeDistanceUnits,
      },
      timingMode: 'docker-software-wall-clock-reference',
      viewport,
      worldSolidCount: initial.visualLayout.worldSolids.length,
    };
  } finally {
    if (touchDriver) await touchDriver.releaseStick().catch(() => {});
    await context.close();
  }
}

await waitForServer();
const browser = await chromium.launch({ headless: true });
const errors = [];
const results = [];
try {
  for (const viewport of viewports) {
    results.push(await verifyViewport(browser, viewport, errors));
  }
} finally {
  await browser.close();
}
assert.deepEqual(errors, [], `Map expansion browser errors: ${errors.join(' | ')}`);
const manifest = {
  baseUrl,
  generatedAt: new Date().toISOString(),
  results,
  status: 'completed',
};
fs.writeFileSync(
  `${outputDirectory}/manifest.json`,
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(JSON.stringify(manifest, null, 2));

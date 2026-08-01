import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import * as THREE from 'three';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:5173';
const additionalBlocksOnly = process.env.TASK6_ADDITIONAL_BLOCKS_ONLY === '1';
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

const WORLD_AXIS_KEYS = {
  negativeX: ['KeyA', 'KeyW'],
  negativeZ: ['KeyD', 'KeyW'],
  positiveX: ['KeyD', 'KeyS'],
  positiveZ: ['KeyA', 'KeyS'],
};

const BLOCK_IMPACT_PROFILES = {
  'plaza-red': { keys: ['KeyW'], runwayDistance: 14, screenDirection: [0, 1] },
  'plaza-yellow': { keys: ['KeyA'], runwayDistance: 14, screenDirection: [-1, 0] },
  'plaza-blue': { keys: ['KeyW'], runwayDistance: 14, screenDirection: [0, 1] },
  'plaza-green': { keys: ['KeyA', 'KeyS'], runwayDistance: 8, screenDirection: [-1, -1] },
};

/** block別の旧斜めimpact入力とtelemetry相対runwayを取得する。 */
function readBlockImpactProfile(blockId) {
  const profile = BLOCK_IMPACT_PROFILES[blockId];
  assert(profile, `Missing Task6 impact profile: ${blockId}.`);
  return profile;
}

/** camera telemetryとscreen入力から正規化済みworld XZ移動方向を求める。 */
function resolveImpactWorldDirection(state, profile) {
  const cameraX = state.camera.lookTarget[0] - state.camera.position[0];
  const cameraZ = state.camera.lookTarget[2] - state.camera.position[2];
  const cameraLength = Math.hypot(cameraX, cameraZ);
  assert(cameraLength > 0, 'Task6 camera forward direction is unavailable.');
  const forwardX = cameraX / cameraLength;
  const forwardZ = cameraZ / cameraLength;
  const rightX = -forwardZ;
  const rightZ = forwardX;
  const [screenX, screenY] = profile.screenDirection;
  const worldX = rightX * screenX + forwardX * screenY;
  const worldZ = rightZ * screenX + forwardZ * screenY;
  const worldLength = Math.hypot(worldX, worldZ);
  assert(worldLength > 0, 'Task6 impact world direction is unavailable.');
  return [worldX / worldLength, worldZ / worldLength];
}

/** 指定キー集合を同時押下する。 */
async function pressKeys(page, keys) {
  for (const key of keys) await page.keyboard.down(key);
}

/** 指定キー集合を全解除する。 */
async function releaseKeys(page, keys) {
  for (const key of keys) await page.keyboard.up(key);
}

/** world cardinal入力の2キーを同時に押す。 */
async function pressWorldAxis(page, axis) {
  const keys = WORLD_AXIS_KEYS[axis];
  assert(keys, `Unknown Task6 world axis: ${axis}.`);
  await pressKeys(page, keys);
  return keys;
}

/** world cardinal入力に使った全キーを解除する。 */
async function releaseWorldAxis(page, keys) {
  await releaseKeys(page, keys);
}

/** canonical E2Eと同じworld cardinal実入力で座標条件まで走る。 */
async function driveAlongWorldAxis(page, axis, predicate, description, maxBursts = 360) {
  const initialResetCount = (await readGameState(page)).vehicle.resetCount;
  const keys = await pressWorldAxis(page, axis);
  try {
    for (let burst = 0; burst < maxBursts; burst += 1) {
      await waitForFrames(page, 2);
      const state = await readGameState(page);
      if (predicate(state)) {
        await releaseWorldAxis(page, keys);
        await brakeVehicle(page);
        return readGameState(page);
      }
      assert.equal(state.vehicle.resetCount, initialResetCount,
        `${description}: vehicle reset unexpectedly.`);
    }
    throw new Error(`${description}: world-axis destination was not reached.`);
  } finally {
    await releaseWorldAxis(page, keys);
  }
}

/** 短いworld cardinal入力で衝突前のheadingを揃える。 */
async function pulseWorldAxis(page, axis, frameCount = 3) {
  const keys = await pressWorldAxis(page, axis);
  try {
    await waitForFrames(page, frameCount);
  } finally {
    await releaseWorldAxis(page, keys);
  }
  await brakeVehicle(page);
}

/** 短いcardinal pulseを反復し、world X/Zをtelemetry由来のrunway座標へ揃える。 */
async function alignWorldCoordinate(
  page,
  coordinateIndex,
  targetValue,
  description,
  tolerance = 0.32,
) {
  assert(coordinateIndex === 0 || coordinateIndex === 2, `${description}: only X/Z can be aligned.`);
  const positiveAxis = coordinateIndex === 0 ? 'positiveX' : 'positiveZ';
  const negativeAxis = coordinateIndex === 0 ? 'negativeX' : 'negativeZ';
  const initialResetCount = (await readGameState(page)).vehicle.resetCount;
  let latest = null;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    latest = await readGameState(page);
    const delta = targetValue - latest.vehicle.position[coordinateIndex];
    if (Math.abs(delta) <= tolerance) return latest;
    assert.equal(latest.vehicle.resetCount, initialResetCount, `${description}: vehicle reset unexpectedly.`);
    const frameCount = Math.max(1, Math.min(7, Math.ceil(Math.abs(delta) * 1.5)));
    await pulseWorldAxis(page, delta > 0 ? positiveAxis : negativeAxis, frameCount);
  }
  throw new Error(`${description}: coordinate did not align: ${JSON.stringify({
    actual: latest?.vehicle.position[coordinateIndex],
    targetValue,
  })}`);
}

/** 安全な直線上で粗移動してから、指定world X/Z座標へ短いpulseで揃える。 */
async function driveToWorldCoordinate(page, coordinateIndex, targetValue, description) {
  const current = await readGameState(page);
  const delta = targetValue - current.vehicle.position[coordinateIndex];
  if (Math.abs(delta) <= 0.32) return current;
  const positiveAxis = coordinateIndex === 0 ? 'positiveX' : 'positiveZ';
  const negativeAxis = coordinateIndex === 0 ? 'negativeX' : 'negativeZ';
  await driveAlongWorldAxis(
    page,
    delta > 0 ? positiveAxis : negativeAxis,
    (state) => delta > 0
      ? state.vehicle.position[coordinateIndex] >= targetValue
      : state.vehicle.position[coordinateIndex] <= targetValue,
    description,
  );
  return alignWorldCoordinate(page, coordinateIndex, targetValue, `${description} precise`);
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

/** blockPlaza telemetryの中心とfull scaleからXZ境界を導出する。 */
function readBlockPlazaBounds(state) {
  const { position, scale } = state.landmarks.blockPlaza;
  return {
    maxX: position[0] + scale[0] / 2,
    maxZ: position[2] + scale[2] / 2,
    minX: position[0] - scale[0] / 2,
    minZ: position[2] - scale[2] / 2,
  };
}

/** block別のvehicle impact累積数を比較用recordへ変換する。 */
function readVehicleImpactCounts(state) {
  return Object.fromEntries(state.breakables.blocks.map(
    ({ id, vehicleImpactCount }) => [id, vehicleImpactCount],
  ));
}

/** actual body位置から指定block6片の投影spread、他block距離、viewport/広場内包を測る。 */
function measureFragmentVisualSeparation(
  state,
  blockId,
  requireViewport,
  beforeVehicleImpactCounts,
) {
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
  const projectedBounds = {
    bottom: Math.max(...fragmentRects.map(({ bottom }) => bottom)),
    left: Math.min(...fragmentRects.map(({ left }) => left)),
    right: Math.max(...fragmentRects.map(({ right }) => right)),
    top: Math.min(...fragmentRects.map(({ top }) => top)),
  };
  const bounds = {
    ...projectedBounds,
    height: projectedBounds.bottom - projectedBounds.top,
    width: projectedBounds.right - projectedBounds.left,
  };
  const minFragmentGap = Math.min(...fragmentGaps);
  const minIntactGap = Math.min(...intactGaps);
  const maximumFragmentHeight = Math.max(...fragmentRects.map(({ height }) => height));
  const maximumFragmentWidth = Math.max(...fragmentRects.map(({ width }) => width));
  const projectedSpread = {
    heightRatio: bounds.height / maximumFragmentHeight,
    sufficient: bounds.width >= maximumFragmentWidth * 2.5
      && bounds.height >= maximumFragmentHeight * 2,
    widthRatio: bounds.width / maximumFragmentWidth,
  };
  const blockPlazaBounds = readBlockPlazaBounds(state);
  const allInsidePlaza = fragments.every(({ position, scale }) => (
    position[0] - scale[0] / 2 >= blockPlazaBounds.minX
    && position[0] + scale[0] / 2 <= blockPlazaBounds.maxX
    && position[2] - scale[2] / 2 >= blockPlazaBounds.minZ
    && position[2] + scale[2] / 2 <= blockPlazaBounds.maxZ
  ));
  const otherBlockPhases = state.runtime.blocks
    .filter(({ id }) => id !== blockId)
    .map(({ id, phase }) => ({ id, phase }));
  const otherBlockImpacts = state.breakables.blocks
    .filter(({ id }) => id !== blockId)
    .map(({ id, impactCount, vehicleImpactCount }) => ({
      beforeVehicleImpactCount: beforeVehicleImpactCounts[id],
      id,
      impactCount,
      vehicleImpactCount,
    }));
  const otherBlocksUntouched = otherBlockPhases.every(({ phase }) => phase === 'intact')
    && otherBlockImpacts.every(({ beforeVehicleImpactCount, vehicleImpactCount }) => (
      vehicleImpactCount === beforeVehicleImpactCount
    ));
  const viewport = state.camera.viewport;
  const allInsideViewport = bounds.left >= 0 && bounds.top >= 0
    && bounds.right <= viewport.width && bounds.bottom <= viewport.height;
  return {
    allInsideViewport,
    allInsidePlaza,
    blockPlazaBounds,
    bounds,
    camera: state.camera,
    fragmentRects,
    minFragmentGap,
    minIntactGap,
    otherBlockImpacts,
    otherBlockPhases,
    otherBlocksUntouched,
    positions: fragments.map(({ id, position }) => ({ id, position })),
    projectedSpread,
    ready: (!requireViewport || allInsideViewport) && allInsidePlaza && projectedSpread.sufficient
      && minIntactGap >= 2 && otherBlocksUntouched,
  };
}

/** 1.2秒の表示窓内で、actual 6片の投影spreadが成立する最初のframeを返す。 */
async function waitForFragmentVisualSeparation(
  page,
  blockId,
  requireViewport,
  beforeVehicleImpactCounts,
) {
  let latestMeasurement = { ready: false, reason: 'No fragment frame observed.' };
  for (let frame = 0; frame < 65; frame += 1) {
    await waitForFrames(page, 1);
    const state = await readGameState(page);
    const activeRedFragments = state.breakables.activeFragments
      ?.filter(({ id }) => id.startsWith(`${blockId}:`));
    if (activeRedFragments?.length !== 6) continue;
    latestMeasurement = measureFragmentVisualSeparation(
      state,
      blockId,
      requireViewport,
      beforeVehicleImpactCounts,
    );
    if (latestMeasurement.ready) return { measurement: latestMeasurement, state };
  }
  throw new Error(`${blockId} fragments never reached the required projected spread: ${JSON.stringify(latestMeasurement)}`);
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
  await page.goto(`${baseUrl}/voxel-game.html?task6=${scenario}-${Date.now()}&job-seed=1`, { waitUntil: 'networkidle' });
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

/** garage・blockPlaza・hub gate telemetryから西地区への安全waypointを読む。 */
function readBlockRouteAnchors(state) {
  const hubGate = state.visualLayout.worldSolids.find(({ id }) => id === 'hub-gate-post');
  assert(hubGate, 'Hub gate solid telemetry is unavailable.');
  const plaza = state.landmarks.blockPlaza;
  return {
    gateBypassZ: hubGate.position[2] - hubGate.scale[2] / 2 - 4,
    garage: state.landmarks.garage,
    plaza,
  };
}

/** 車庫正面からhub gate北側を抜け、積み木地区へ西進できる位置まで実走する。 */
async function driveToHubGateBypass(page, description) {
  const initial = await readGameState(page);
  const anchors = readBlockRouteAnchors(initial);
  await driveAlongWorldAxis(
    page,
    'negativeZ',
    (state) => state.vehicle.position[2] <= anchors.gateBypassZ,
    `${description} garage exit and gate bypass`,
  );
  return anchors;
}

/** block telemetryのXZ外接矩形中心を、viewport共通のoverview captureアンカーとして返す。 */
function readBlockPlazaCaptureAnchor(state) {
  const xCoordinates = state.landmarks.breakableBlocks.map(({ position }) => position[0]);
  const zCoordinates = state.landmarks.breakableBlocks.map(({ position }) => position[2]);
  const lookOffsetX = state.camera.lookTarget[0] - state.vehicle.position[0];
  const lookOffsetZ = state.camera.lookTarget[2] - state.vehicle.position[2];
  const lookX = (Math.min(...xCoordinates) + Math.max(...xCoordinates)) / 2;
  const lookZ = (Math.min(...zCoordinates) + Math.max(...zCoordinates)) / 2;
  return {
    lookOffsetX,
    lookOffsetZ,
    lookX,
    lookZ,
    vehicleX: lookX - lookOffsetX,
    vehicleZ: lookZ - lookOffsetZ,
  };
}

/** 固定cameraのlook targetがtelemetry由来captureアンカーへ収束するまで有界待機する。 */
async function waitForOverviewCameraAnchor(page, anchor) {
  let latest = null;
  for (let frame = 0; frame < 120; frame += 1) {
    await waitForFrames(page, 1);
    latest = await readGameState(page);
    const expectedLookX = latest.vehicle.position[0] + anchor.lookOffsetX;
    const expectedLookZ = latest.vehicle.position[2] + anchor.lookOffsetZ;
    if (Math.abs(latest.camera.lookTarget[0] - expectedLookX) <= 0.2
      && Math.abs(latest.camera.lookTarget[2] - expectedLookZ) <= 0.2) {
      return latest;
    }
  }
  throw new Error(`Plaza overview camera did not reach capture anchor: ${JSON.stringify({
    anchor,
    lookTarget: latest?.camera.lookTarget,
  })}`);
}

/** 西側道路の中央まで実走し、積み木広場4個を同時に見渡せる視点を作る。 */
async function driveToBlockPlazaOverview(page, hudControlRects) {
  const initial = await readGameState(page);
  const captureAnchor = readBlockPlazaCaptureAnchor(initial);
  const { plaza } = await driveToHubGateBypass(page, 'plaza overview');
  const westTransitX = plaza.position[0] - plaza.scale[0] / 2 - 2;
  const [positiveX, positiveXDriftZ] = resolveImpactWorldDirection(initial, {
    screenDirection: [1, -1],
  });
  const corridorEntryZ = plaza.position[2]
    - (captureAnchor.vehicleX - westTransitX) * positiveXDriftZ / positiveX;
  await driveToWorldCoordinate(page, 0, westTransitX, 'plaza overview west transit X');
  await driveToWorldCoordinate(page, 2, corridorEntryZ, 'plaza overview corridor entry Z');
  await alignWorldCoordinate(page, 0, captureAnchor.vehicleX, 'plaza overview capture X', 0.16);
  await alignWorldCoordinate(page, 2, captureAnchor.vehicleZ, 'plaza overview capture Z', 0.16);
  const centeredState = await waitForOverviewCameraAnchor(page, captureAnchor);
  const correction = findBlockPlazaCaptureCorrection(centeredState, hudControlRects);
  if (Math.hypot(correction.deltaX, correction.deltaZ) > 0.05) {
    await alignWorldCoordinate(
      page,
      0,
      centeredState.vehicle.position[0] + correction.deltaX,
      'plaza overview HUD-safe X',
      0.12,
    );
    await alignWorldCoordinate(
      page,
      2,
      centeredState.vehicle.position[2] + correction.deltaZ,
      'plaza overview HUD-safe Z',
      0.12,
    );
    await waitForOverviewCameraAnchor(page, captureAnchor);
  }
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

/** 実camera/HUD投影から4px条件を満たし、最小clearanceが最大のcapture補正を選ぶ。 */
function findBlockPlazaCaptureCorrection(state, hudControlRects) {
  const current = measureBlockPlazaVisibility(state, hudControlRects);
  if (current.allInsideViewport
    && current.minimumViewportMargin >= 4
    && current.minimumHudControlGap >= 4) {
    return { clearance: Math.min(current.minimumViewportMargin, current.minimumHudControlGap), deltaX: 0, deltaZ: 0 };
  }

  const xCoordinates = state.landmarks.breakableBlocks.map(({ position }) => position[0]);
  const zCoordinates = state.landmarks.breakableBlocks.map(({ position }) => position[2]);
  const searchRadius = Math.max(
    Math.max(...xCoordinates) - Math.min(...xCoordinates),
    Math.max(...zCoordinates) - Math.min(...zCoordinates),
  ) / 2;
  const step = Math.max(0.1, 4 / state.camera.zoom);
  let best = null;
  for (let deltaX = -searchRadius; deltaX <= searchRadius; deltaX += step) {
    for (let deltaZ = -searchRadius; deltaZ <= searchRadius; deltaZ += step) {
      const camera = {
        ...state.camera,
        lookTarget: [
          state.camera.lookTarget[0] + deltaX,
          state.camera.lookTarget[1],
          state.camera.lookTarget[2] + deltaZ,
        ],
        position: [
          state.camera.position[0] + deltaX,
          state.camera.position[1],
          state.camera.position[2] + deltaZ,
        ],
      };
      const measurement = measureBlockPlazaVisibility({ ...state, camera }, hudControlRects);
      const clearance = Math.min(
        measurement.minimumViewportMargin,
        measurement.minimumHudControlGap,
      );
      if (!measurement.allInsideViewport || clearance < 4) continue;
      const travel = Math.hypot(deltaX, deltaZ);
      if (!best || clearance > best.clearance
        || (Math.abs(clearance - best.clearance) < 0.001 && travel < best.travel)) {
        best = { clearance, deltaX, deltaZ, travel };
      }
    }
  }
  assert(best, `No HUD-safe plaza capture anchor was found: ${JSON.stringify(current)}`);
  return best;
}

/** 現在viewportの4つのHUD control矩形をcapture判定用に読む。 */
async function readHudControlRects(page) {
  return page.evaluate(() => [
    '.fullscreen-button',
    '.mission-pill',
    '.primary-action-button',
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

/** 車庫からhub gateを避け、赤blockのtelemetry相対runwayへ出る。 */
async function driveToRedBlockApproach(page, runwayDistance) {
  return driveToBlockApproach(page, 'plaza-red', runwayDistance);
}

/** 車庫からhub gateと他blockを避け、指定blockへ東西の開けた側から接近する。 */
async function driveToBlockApproach(page, blockId, runwayDistanceOverride) {
  const initialState = await readGameState(page);
  const target = initialState.landmarks.breakableBlocks.find(({ id }) => id === blockId)?.position;
  assert(target, `${blockId} landmark is unavailable.`);
  const beforeVehicleImpactCounts = Object.fromEntries(initialState.breakables.blocks.map(
    ({ id, vehicleImpactCount }) => [id, vehicleImpactCount],
  ));
  const { plaza } = await driveToHubGateBypass(page, blockId);
  const profile = readBlockImpactProfile(blockId);
  const [impactX, impactZ] = resolveImpactWorldDirection(initialState, profile);
  const runwayDistance = runwayDistanceOverride ?? profile.runwayDistance;
  const stageX = target[0] - impactX * runwayDistance;
  const stageZ = target[2] - impactZ * runwayDistance;
  if (blockId === 'plaza-green') {
    const westTransitX = plaza.position[0] - plaza.scale[0] / 2 - 2;
    await driveToWorldCoordinate(page, 0, westTransitX, `${blockId} west transit X`);
    await alignWorldCoordinate(page, 0, stageX, `${blockId} west runway X`);
    await driveToWorldCoordinate(page, 2, stageZ, `${blockId} west runway Z`);
  } else {
    const eastTransitX = Math.max(
      stageX,
      plaza.position[0] + plaza.scale[0] / 2 + 2,
    );
    await driveToWorldCoordinate(page, 0, eastTransitX, `${blockId} east transit X`);
    await driveToWorldCoordinate(page, 2, stageZ, `${blockId} outside-block-row Z`);
    if (runwayDistanceOverride === undefined) {
      await driveToWorldCoordinate(page, 0, stageX, `${blockId} diagonal runway X`);
    } else {
      await alignWorldCoordinate(page, 0, stageX, `${blockId} short runway X`);
    }
  }
  const approached = await readGameState(page);
  for (const block of approached.breakables.blocks) {
    assert.equal(
      block.vehicleImpactCount,
      beforeVehicleImpactCounts[block.id],
      `${blockId} approach touched ${block.id}: ${JSON.stringify({
      approach: approached.vehicle,
      camera: initialState.camera,
      impactDirection: [impactX, impactZ],
      stage: [stageX, stageZ],
      target,
      })}`,
    );
  }
  return approached;
}

/** 公開keyboard経路の有効速度衝突で指定blockだけがbrokenになるまで待つ。 */
async function collideBlockAtEffectiveSpeed(page, blockId) {
  const { keys } = readBlockImpactProfile(blockId);
  await pressKeys(page, keys);
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
    await releaseKeys(page, keys);
  }
}

/** 有効速度で赤blockへ衝突し、physics event経由のbrokenを待つ。 */
async function collideAtEffectiveSpeed(page) {
  let lastState = await readGameState(page);
  const startVehicle = lastState.vehicle;
  const { keys } = readBlockImpactProfile('plaza-red');
  await pressKeys(page, keys);
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
    await releaseKeys(page, keys);
  }
}

/** page内rAFで実車破壊を待ち、3810→3800msのtimerとscene frameを決定的に観測する。 */
async function collideAtEffectiveSpeedThroughTimer(page) {
  const { keys } = readBlockImpactProfile('plaza-red');
  await pressKeys(page, keys);
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
          const latest = read();
          reject(new Error(`Effective real-vehicle collision did not break plaza-red within 600 frames: ${JSON.stringify({
            red: latest.breakables.blocks.find(({ id }) => id === 'plaza-red'),
            vehicle: latest.vehicle,
          })}`));
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
    await releaseKeys(page, keys);
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
  let keys = ['KeyS'];
  await pressKeys(page, keys);
  try {
    for (let frame = 0; frame < 180; frame += 1) {
      await waitForFrames(page, 1);
      if (distanceFromRedBlock(await readGameState(page)) > 4.2) break;
      if (frame === 179) throw new Error('Vehicle did not leave red respawn radius before deadline setup.');
    }
  } finally {
    await releaseKeys(page, keys);
  }
  await brakeVehicle(page);
  const outside = await readGameState(page);
  assert(distanceFromRedBlock(outside) > 4.2, 'Vehicle is not safely outside red respawn radius.');
  const beforeDeadlineBlock = outside.runtime.blocks.find(({ id }) => id === 'plaza-red');
  await windowAdvance(page, Math.max(0, (beforeDeadlineBlock?.respawnRemainingMs ?? 0) - 3_000));
  const justBeforeDeadline = await readGameState(page);
  assert.equal(justBeforeDeadline.runtime.blocks.find(({ id }) => id === 'plaza-red')?.phase, 'broken');
  assert(distanceFromRedBlock(justBeforeDeadline) > 3, 'Vehicle is not clear immediately before keyboard entry.');

  keys = ['KeyW'];
  await pressKeys(page, keys);
  let inside;
  try {
    for (let frame = 0; frame < 90; frame += 1) {
      await waitForFrames(page, 1);
      inside = await readGameState(page);
      if (distanceFromRedBlock(inside) <= 3) break;
    }
  } finally {
    await releaseKeys(page, keys);
  }
  assert(inside && distanceFromRedBlock(inside) <= 3, 'Keyboard drive did not enter red respawn radius.');
  const insideBlock = inside.runtime.blocks.find(({ id }) => id === 'plaza-red');
  await page.evaluate((milliseconds) => window.advanceTime?.(milliseconds), insideBlock?.respawnRemainingMs ?? 0);
  await waitForFrames(page, 1);
  const atDeadline = await readGameState(page);
  assert.equal(atDeadline.runtime.blocks.find(({ id }) => id === 'plaza-red')?.respawnRemainingMs, 0);
  assert.equal(atDeadline.runtime.blocks.find(({ id }) => id === 'plaza-red')?.phase, 'broken',
    'Red block restored at deadline while vehicle was inside three units.');

  keys = ['KeyS'];
  await pressKeys(page, keys);
  try {
    await page.waitForFunction(() => {
      const rendered = window.render_game_to_text?.();
      if (!rendered) return false;
      const state = JSON.parse(rendered);
      return state.runtime.blocks.find(({ id }) => id === 'plaza-red')?.phase === 'intact'
        && state.visuals.intactBlockCount === 4;
    }, undefined, { timeout: 5_000 });
  } finally {
    await releaseKeys(page, keys);
  }
  return { atDeadline, inside, justBeforeDeadline };
}

/** manual clockをpage上で同期加算する。 */
async function windowAdvance(page, milliseconds) {
  await page.evaluate((value) => window.advanceTime?.(value), milliseconds);
}

/** 3frameの短い加速と完全減速を繰り返し、4未満の実衝突を起こす。 */
async function collideBelowThreshold(page) {
  for (let pulse = 0; pulse < 24; pulse += 1) {
    const { keys } = readBlockImpactProfile('plaza-red');
    await pressKeys(page, keys);
    try {
      await waitForFrames(page, 3);
    } finally {
      await releaseKeys(page, keys);
    }
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
      assert.equal(block.vehicleImpactCount, 0, `${block.id} received a vehicle impact during red break.`);
      assert.equal(
        brokenRendered.runtime.blocks.find(({ id }) => id === block.id)?.phase,
        'intact',
        `${block.id} broke from red-block debris.`,
      );
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
    const rebreakApproach = await driveToRedBlockApproach(chainPage);
    const rebroken = await collideAtEffectiveSpeed(chainPage);
    const visualSeparation = await waitForFragmentVisualSeparation(
      chainPage,
      'plaza-red',
      true,
      readVehicleImpactCounts(rebreakApproach),
    );
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
      const visual = await waitForFragmentVisualSeparation(
        blockPage,
        blockId,
        false,
        readVehicleImpactCounts(approach),
      );
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
    const approach = await driveToRedBlockApproach(belowThresholdPage, 5.5);
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
      const hudControlRects = await readHudControlRects(overviewPage);
      await driveToBlockPlazaOverview(overviewPage, hudControlRects);
      const state = await readGameState(overviewPage);
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

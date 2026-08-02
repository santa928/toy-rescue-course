import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import {
  createDomTouchStickDriver,
  createDriveHarness,
} from './voxel-game-e2e/drive-harness.mjs';
import {
  assertHudPixelProof,
  readHudPixelProof,
  waitForHudCaptureReadiness,
} from './voxel-game-screenshot-proof.mjs';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:5173';
const outputDirectory = 'output/voxel-game-colors';
const allViewports = [
  { height: 720, name: 'desktop', touch: false, width: 1_280 },
  { height: 768, name: 'tablet', touch: true, width: 1_024 },
  { height: 390, name: 'mobile-landscape', touch: true, width: 844 },
];
const viewportFilter = process.env.VOXEL_GAME_COLOR_VIEWPORT ?? null;
const viewports = viewportFilter === null
  ? allViewports
  : allViewports.filter(({ name }) => name === viewportFilter);
assert(viewports.length > 0, `Unknown VOXEL_GAME_COLOR_VIEWPORT: ${viewportFilter}.`);
const driveHarness = createDriveHarness({
  alignAttemptLimit: 30,
  brakeFrameLimit: 180,
  defaultMaxBursts: 440,
  pulseDistanceMultiplier: 1.4,
  requiredFields: [
    'colorEffect',
    'controls',
    'landmarks',
    'mission',
    'renderer',
    'vehicle',
    'vehicleSelection',
    'visualLayout',
    'visuals',
    'world',
  ],
  sampleBeforeBurst: false,
});
const {
  brakeVehicle,
  readGameState,
  waitForFrames,
} = driveHarness;
const screenshotProofs = {};

/** 保存PNGのHUD文字・背景・四辺を実画素検証し、compositor遅延だけ再取得する。 */
async function captureVerifiedScreenshot(page, path) {
  let latestError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const readiness = await waitForHudCaptureReadiness(page);
    const buffer = await page.screenshot();
    const pixels = await readHudPixelProof(page, buffer, readiness);
    try {
      assertHudPixelProof(pixels);
      fs.writeFileSync(path, buffer);
      screenshotProofs[path.split('/').at(-1)] = {
        controls: readiness.controls,
        pixels: pixels.controls,
        stableSamples: readiness.stableSamples,
      };
      return;
    } catch (error) {
      latestError = error;
      if (attempt < 2) await waitForFrames(page, 3);
    }
  }
  throw latestError;
}

/** 専用artifactを毎run初期化し、古い成功画像との取り違えを防ぐ。 */
function resetArtifacts() {
  fs.rmSync(outputDirectory, { force: true, recursive: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
}

/** run状態を失敗時も残る小さなmanifestへ保存する。 */
function writeRunManifest(status, error = null, metadata = {}) {
  fs.writeFileSync(
    `${outputDirectory}/run-manifest.json`,
    `${JSON.stringify({ error, ...metadata, recordedAt: new Date().toISOString(), status }, null, 2)}\n`,
  );
}

/** Playwright矩形をedge座標へ変換する。 */
function toEdges(box) {
  return {
    bottom: box.y + box.height,
    left: box.x,
    right: box.x + box.width,
    top: box.y,
  };
}

/** 重ならない2矩形の最短距離を返す。 */
function rectDistance(left, right) {
  const horizontal = Math.max(left.left - right.right, right.left - left.right, 0);
  const vertical = Math.max(left.top - right.bottom, right.top - left.bottom, 0);
  return Math.hypot(horizontal, vertical);
}

/** 色札表示中のHUDを実測し、mission anchorと操作安全余白を検証する。 */
async function measureActiveHud(page, viewport, selectorExpected) {
  const selectors = {
    action: '.primary-action-button',
    colorEffect: '.color-effect-pill',
    fullscreen: '.fullscreen-button',
    joystick: '.touch-joystick',
    mission: '.mission-pill',
  };
  if (selectorExpected) selectors.selector = '.vehicle-selector';
  const boxes = {};
  for (const [name, selector] of Object.entries(selectors)) {
    const box = await page.locator(selector).boundingBox();
    assert(box, `${viewport.name}: ${name} bounding box is unavailable.`);
    boxes[name] = toEdges(box);
  }
  for (const [name, box] of Object.entries(boxes)) {
    assert(
      box.left >= 8
      && box.top >= 8
      && box.right <= viewport.width - 8
      && box.bottom <= viewport.height - 8,
      `${viewport.name}: ${name} lacks 8px viewport inset: ${JSON.stringify(box)}.`,
    );
  }
  assert(rectDistance(boxes.mission, boxes.colorEffect) >= 10,
    `${viewport.name}: mission/color gap is below 10px: ${JSON.stringify(boxes)}.`);
  for (const [left, right] of [
    ['mission', 'fullscreen'],
    ['colorEffect', 'fullscreen'],
    ['mission', 'joystick'],
    ['colorEffect', 'joystick'],
    ['mission', 'action'],
    ['colorEffect', 'action'],
    ...(selectorExpected
      ? [['selector', 'mission'], ['selector', 'colorEffect'], ['selector', 'fullscreen']]
      : []),
  ]) {
    assert(rectDistance(boxes[left], boxes[right]) >= 8,
      `${viewport.name}: ${left}/${right} lack 8px gap: ${JSON.stringify(boxes)}.`);
  }
  return boxes;
}

/** 色遊びE2E用pointer identityで共有DOM touch driverを作る。 */
async function createTouchDriver(page) {
  return createDomTouchStickDriver(page, { pointerId: 81 });
}

/** 既存の引数順を保って共有world cardinal走行を呼ぶ。 */
async function driveAlongWorldAxis(page, axis, predicate, description, touchDriver, maxBursts = 440) {
  return driveHarness.driveAlongWorldAxis(page, {
    axis,
    description,
    maxBursts,
    predicate,
    touchDriver,
  });
}

/** 既存の引数順を保って共有X/Z alignを呼ぶ。 */
async function alignWorldCoordinate(
  page,
  coordinateIndex,
  target,
  description,
  touchDriver,
  tolerance = 0.35,
) {
  return driveHarness.alignWorldCoordinate(page, {
    coordinateIndex,
    description,
    target,
    tolerance,
    touchDriver,
  });
}

/** 既存の引数順を保って共有coarse+precise走行を呼ぶ。 */
async function driveToCoordinate(
  page,
  coordinateIndex,
  target,
  description,
  touchDriver,
  tolerance = 0.35,
) {
  return driveHarness.driveToCoordinate(page, {
    coordinateIndex,
    description,
    target,
    tolerance,
    touchDriver,
  });
}

/** 既存の引数順を保って共有point alignを呼ぶ。 */
async function alignWorldPoint(page, target, description, touchDriver, tolerance = 0.35) {
  return driveHarness.alignWorldPoint(page, {
    description,
    target,
    tolerance,
    touchDriver,
  });
}

/** 色状態がpredicateを満たすまでactual frameを待つ。 */
async function waitForColorEffect(page, predicate, description) {
  let latest = null;
  for (let frame = 0; frame < 120; frame += 1) {
    await waitForFrames(page, 1);
    latest = await readGameState(page);
    if (predicate(latest.colorEffect)) return latest;
  }
  throw new Error(`${description}: color effect did not converge: ${JSON.stringify({
    colorEffect: latest?.colorEffect,
    vehicle: latest?.vehicle,
    world: latest?.world,
  })}.`);
}

/** hub gateを避けて中央車庫から指定南stationへ実入力で走る。 */
async function driveFromGarageToSource(page, source, touchDriver, description) {
  await driveToCoordinate(page, 2, -4.4, `${description} garage exit`, touchDriver, 0.45);
  await driveToCoordinate(page, 0, source.position[0], `${description} source lane`, touchDriver, 0.4);
  await driveToCoordinate(page, 2, source.position[2], `${description} source row`, touchDriver, 0.35);
  await alignWorldPoint(page, source.position, `${description} source center`, touchDriver, 0.4);
  return waitForColorEffect(
    page,
    (effect) => effect.active && effect.sourceId === source.id,
    `${description} activation`,
  );
}

/** 1 viewportで色遊びのentry、上書き、期限、車種切替を実操作完遂する。 */
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
    await page.goto(`${baseUrl}/voxel-game.html?colors=${viewport.name}-${Date.now()}&job-seed=1`, {
      waitUntil: 'networkidle',
    });
    await page.waitForFunction(() => document.documentElement.dataset.voxelSceneReady === 'true'
      && typeof window.render_game_to_text === 'function'
      && typeof window.select_voxel_game_vehicle === 'function', undefined, { timeout: 10_000 });
    touchDriver = viewport.touch ? await createTouchDriver(page) : null;
    const initial = await readGameState(page);
    assert.equal(initial.colorEffect.active, false, `${viewport.name}: initial color is active.`);
    assert.equal(initial.landmarks.colorPlaySources.length, 6,
      `${viewport.name}: six color sources are not exposed.`);
    assert.equal(initial.visuals.colorPoolCubeCount, 24);
    assert.equal(initial.visuals.colorShowerCubeCount, 54);
    assert.equal(initial.visuals.colorStationCubeCount, 78);
    assert.equal(initial.visuals.colorStationDrawCalls, 5);
    const sourceById = new Map(initial.landmarks.colorPlaySources.map((source) => [source.id, source]));
    const redPool = sourceById.get('pool-red');
    const bluePool = sourceById.get('pool-blue');
    const yellowShower = sourceById.get('shower-yellow');
    assert(redPool && bluePool && yellowShower, `${viewport.name}: required sources are missing.`);
    const eastSignPost = initial.visualLayout.worldSolids.find(
      ({ id }) => id === 'south-sign-post-east',
    );
    const southBench = initial.visualLayout.worldSolids.find(
      ({ id }) => id === 'south-viewing-bench',
    );
    assert(eastSignPost, `${viewport.name}: east sign post telemetry is missing.`);
    assert(southBench, `${viewport.name}: south bench telemetry is missing.`);
    const vehiclePlanarHalfExtent = Math.max(
      initial.visualLayout.vehicleBounds.scale[0],
      initial.visualLayout.vehicleBounds.scale[2],
    ) / 2;
    const signPlanarHalfExtent = Math.max(eastSignPost.scale[0], eastSignPost.scale[2]) / 2;
    const yellowShowerSignBypassZ = Math.min(
      eastSignPost.position[2] - vehiclePlanarHalfExtent - signPlanarHalfExtent - 1.5,
      southBench.position[2] - vehiclePlanarHalfExtent - southBench.scale[2] / 2 - 1.5,
    );

    const firstRed = await driveFromGarageToSource(
      page,
      redPool,
      touchDriver,
      `${viewport.name} red pool`,
    );
    assert.equal(firstRed.colorEffect.colorId, 'red');
    assert.equal(firstRed.colorEffect.sourceKind, 'pool');
    assert.equal(firstRed.colorEffect.vehicleId, 'fire-truck');
    assert.equal(firstRed.colorEffect.remainingSeconds, 12);
    assert.match(await page.locator('.color-effect-pill').innerText(), /あか 12びょう/);
    const activeLayout = await measureActiveHud(page, viewport, false);

    await driveToCoordinate(
      page,
      0,
      -6,
      `${viewport.name} leave red pool`,
      touchDriver,
      0.25,
    );
    const outsideRed = await waitForColorEffect(
      page,
      (effect) => effect.active && effect.contactSourceId === null,
      `${viewport.name} red pool exit`,
    );
    await page.evaluate(() => window.advanceTime?.(1_000));
    await waitForFrames(page, 3);
    const countingDown = await readGameState(page);
    assert(countingDown.colorEffect.remainingSeconds > 0
      && countingDown.colorEffect.remainingSeconds < outsideRed.colorEffect.remainingSeconds,
    `${viewport.name}: displayed countdown did not advance.`);
    assert(countingDown.colorEffect.remainingMilliseconds < outsideRed.colorEffect.remainingMilliseconds,
      `${viewport.name}: color countdown did not decrease.`);

    await driveToCoordinate(
      page,
      0,
      redPool.position[0],
      `${viewport.name} reenter red pool`,
      touchDriver,
      0.3,
    );
    const secondRed = await waitForColorEffect(
      page,
      (effect) => effect.sourceId === redPool.id
        && effect.contactSourceId === redPool.id
        && effect.activationCount > firstRed.colorEffect.activationCount,
      `${viewport.name} red pool reentry`,
    );
    assert.equal(secondRed.colorEffect.remainingSeconds, 12);

    await driveToCoordinate(
      page,
      2,
      bluePool.position[2],
      `${viewport.name} blue overwrite`,
      touchDriver,
      0.3,
    );
    await alignWorldPoint(page, bluePool.position, `${viewport.name} blue pool center`, touchDriver, 0.4);
    const blue = await waitForColorEffect(
      page,
      (effect) => effect.colorId === 'blue' && effect.sourceId === bluePool.id,
      `${viewport.name} blue overwrite`,
    );
    assert(blue.colorEffect.activationCount > secondRed.colorEffect.activationCount);
    assert.match(await page.locator('.color-effect-pill').innerText(), /あお 12びょう/);
    await captureVerifiedScreenshot(page, `${outputDirectory}/${viewport.name}-blue-pool.png`);

    await driveToCoordinate(
      page,
      0,
      -6,
      `${viewport.name} leave blue pool`,
      touchDriver,
      0.25,
    );
    await waitForColorEffect(
      page,
      (effect) => effect.active && effect.contactSourceId === null,
      `${viewport.name} blue pool exit`,
    );
    await page.evaluate(() => window.advanceTime?.(12_000));
    const expired = await waitForColorEffect(
      page,
      (effect) => !effect.active,
      `${viewport.name} color expiry`,
    );
    assert.equal(expired.colorEffect.colorId, null);
    assert.equal(await page.locator('.color-effect-pill').count(), 0,
      `${viewport.name}: color pill remained after expiry.`);

    await driveToCoordinate(
      page,
      2,
      yellowShowerSignBypassZ,
      `${viewport.name} yellow shower sign bypass`,
      touchDriver,
      0.2,
    );
    await driveToCoordinate(
      page,
      0,
      yellowShower.position[0],
      `${viewport.name} yellow shower lane`,
      touchDriver,
      0.35,
    );
    await driveToCoordinate(
      page,
      2,
      yellowShower.position[2],
      `${viewport.name} yellow shower row`,
      touchDriver,
      0.35,
    );
    await alignWorldPoint(
      page,
      yellowShower.position,
      `${viewport.name} yellow shower center`,
      touchDriver,
      0.4,
    );
    const yellow = await waitForColorEffect(
      page,
      (effect) => effect.colorId === 'yellow'
        && effect.sourceKind === 'shower'
        && effect.sourceId === yellowShower.id,
      `${viewport.name} yellow shower activation`,
    );
    assert.match(await page.locator('.color-effect-pill').innerText(), /きいろ 12びょう/);
    await waitForFrames(page, 3);
    const yellowLayout = await measureActiveHud(page, viewport, false);
    await captureVerifiedScreenshot(page, `${outputDirectory}/${viewport.name}-yellow-shower.png`);

    const rejectedSnapshot = { ...yellow.colorEffect };
    assert.equal(await page.evaluate(() => window.select_voxel_game_vehicle?.('bulldozer')), false,
      `${viewport.name}: outside vehicle switch was accepted.`);
    await waitForFrames(page, 2);
    const afterRejected = await readGameState(page);
    assert.deepEqual({
      activationCount: afterRejected.colorEffect.activationCount,
      active: afterRejected.colorEffect.active,
      colorId: afterRejected.colorEffect.colorId,
      sourceId: afterRejected.colorEffect.sourceId,
      vehicleId: afterRejected.colorEffect.vehicleId,
    }, {
      activationCount: rejectedSnapshot.activationCount,
      active: rejectedSnapshot.active,
      colorId: rejectedSnapshot.colorId,
      sourceId: rejectedSnapshot.sourceId,
      vehicleId: rejectedSnapshot.vehicleId,
    }, `${viewport.name}: rejected switch changed color ownership.`);

    await page.evaluate(() => window.reset_voxel_game_vehicle?.());
    await waitForFrames(page, 5);
    const returned = await readGameState(page);
    assert.equal(returned.world.currentDistrict, 'hub');
    assert.equal(returned.vehicleSelection.canSwitch, true);
    assert.equal(returned.colorEffect.active, true,
      `${viewport.name}: reset unexpectedly cleared color.`);
    const garageLayout = await measureActiveHud(page, viewport, true);
    const bulldozerButton = page.getByRole('button', { name: 'ブルドーザーをえらぶ' });
    if (viewport.touch) await bulldozerButton.tap();
    else await bulldozerButton.click();
    const switched = await waitForColorEffect(
      page,
      (effect) => !effect.active,
      `${viewport.name} successful switch clear`,
    );
    assert.equal(switched.vehicle.id, 'bulldozer');
    assert.equal(switched.vehicleSelection.selected, 'bulldozer');
    assert.equal(await page.locator('.color-effect-pill').count(), 0);

    let bulldozerColor = null;
    if (viewport.name === 'desktop') {
      bulldozerColor = await driveFromGarageToSource(
        page,
        redPool,
        touchDriver,
        `${viewport.name} bulldozer red pool`,
      );
      assert.equal(bulldozerColor.colorEffect.vehicleId, 'bulldozer');
      assert.equal(bulldozerColor.colorEffect.colorId, 'red');
    }

    return {
      activeLayout,
      blueActivationCount: blue.colorEffect.activationCount,
      bulldozerColor: bulldozerColor?.colorEffect ?? null,
      garageLayout,
      rendererCalls: initial.renderer.rendererCalls,
      sourceCount: initial.landmarks.colorPlaySources.length,
      yellowActivationCount: yellow.colorEffect.activationCount,
      yellowLayout,
    };
  } finally {
    await touchDriver?.releaseStick();
    await context.close();
  }
}

resetArtifacts();
writeRunManifest('running', null, { full: true, mode: 'colors' });
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
    note: 'Docker renderer values are diagnostic; physical GPU certification is separate.',
    results,
    screenshotProofs,
    screenshots: viewports.flatMap(({ name }) => [
      `${name}-blue-pool.png`,
      `${name}-yellow-shower.png`,
    ]),
    viewports,
  };
  fs.writeFileSync(`${outputDirectory}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  writeRunManifest('completed', null, { full: true, mode: 'colors' });
  process.stdout.write(`${JSON.stringify({
    ...manifest,
    screenshotProofCount: Object.keys(screenshotProofs).length,
    screenshotProofs: undefined,
  }, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  writeRunManifest('failed', message, { full: true, mode: 'colors' });
  throw error;
} finally {
  await browser.close();
}

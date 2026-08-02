import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import * as THREE from 'three';
import {
  assertHudPixelProof,
  readHudPixelProof,
  waitForHudCaptureReadiness,
} from './voxel-game-screenshot-proof.mjs';
import {
  evaluateConservativeFirstObservedAxisOverflow,
} from './voxel-game-break-physics-contract.mjs';
import {
  WORLD_AXIS_INPUTS,
  createDriveHarness,
  releaseKeyboardKeys,
  syncKeyboardKeys,
} from './voxel-game-e2e/drive-harness.mjs';
import { createFireRoutePlan } from './voxel-game-e2e/fire-route-plan.mjs';
import { createScenarioProgress } from './voxel-game-e2e/scenario-progress.mjs';

const execFileAsync = promisify(execFile);
const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:5173';
const canonicalOutputDirectory = 'output/voxel-game';
const supportedFocusModes = [
  'nonbreak',
  'collision',
  'break-red',
  'break-yellow',
  'break-blue',
  'break-green',
  'production-map',
  'water',
];
const focusMode = process.env.VOXEL_GAME_FOCUS ?? null;
if (focusMode !== null) {
  assert(supportedFocusModes.includes(focusMode), `Unsupported VOXEL_GAME_FOCUS: ${focusMode}`);
}
const outputDirectory = focusMode === null
  ? canonicalOutputDirectory
  : `${canonicalOutputDirectory}/focus/${focusMode}`;
const driveHarness = createDriveHarness({
  alignAttemptLimit: 24,
  brakeFrameLimit: 150,
  defaultMaxBursts: 360,
  pulseDistanceMultiplier: 1.5,
  requiredFields: ['breakables', 'renderer', 'runtime', 'vehicle', 'world'],
  sampleBeforeBurst: true,
});
const {
  brakeVehicle,
  readGameState,
  waitForFrames,
} = driveHarness;
const screenshotProofs = {};
const targets = [
  { hasTouch: false, height: 720, minimumFps: 60, name: 'desktop', width: 1_280 },
  { hasTouch: true, height: 768, minimumFps: 30, name: 'tablet-landscape', width: 1_024 },
  { hasTouch: true, height: 390, minimumFps: 30, name: 'mobile-landscape', width: 844 },
];
const expectedScreenshots = [
  'desktop-driving.png',
  'desktop-water-fire.png',
  'desktop-block-broken.png',
  'desktop-complete.png',
  'tablet-landscape-driving.png',
  'tablet-landscape-water-fire.png',
  'mobile-landscape-driving.png',
  'mobile-landscape-water-fire.png',
];
const timelineScreenshots = [
  'desktop-forgiving-spray.png',
  'desktop-water-start.png',
  'desktop-water-flow.png',
  'desktop-water-splash.png',
  ...['red', 'yellow', 'blue', 'green'].flatMap((color) => [
    `desktop-break-${color}-first-observed.png`,
    `desktop-break-${color}-arc-250ms.png`,
  ]),
];
const collisionScreenshots = [
  'desktop-collision-tree-trunk-3.png',
  'desktop-collision-fire-building-body.png',
  'desktop-collision-garage-back-wall.png',
  'desktop-collision-garage-right-wall.png',
  'desktop-collision-playground-plank.png',
  'desktop-fire-hazard-before.png',
  'desktop-fire-hazard-after.png',
  'desktop-route-marker-pass-through.png',
];
const productionMapScreenshots = [
  'desktop-production-hub.png',
  'desktop-production-park.png',
  'desktop-production-fire.png',
  'desktop-production-blocks.png',
  'desktop-production-south.png',
];
const VEHICLE_COLLIDER_HALF_EXTENTS = [1.45, 0.95, 1.7];
// 60Hzでは50ms級を要求し、低fps software rendererでは同一/次rAFの最速activationを要求する。
const ACTIVATION_TRANSITION_DELAY_LIMIT_MS = 51;
// Docker screenshot中もruntime clockは1 frame最大50msで進むため、壁時計timeoutは仕様寿命と分離する。
const BREAK_OBSERVER_WALL_TIMEOUT_MS = 3_500;
const BREAK_FRAGMENT_RUNTIME_LIFETIME_MIN_MS = 1_100;
const BREAK_FRAGMENT_RUNTIME_LIFETIME_MAX_MS = 1_250;
// first rAFが既に頂点付近でも、元block中心から6片平均が明確に上がることを要求する。
const BREAK_FRAGMENT_MINIMUM_PEAK_ABOVE_BLOCK_CENTER = 0.12;
// Rapierが接触面へ静止するまでのsubstep差を許しつつ、貫通はclearance契約で別途検出する。
const MAX_COLLISION_SETTLING_TRAVEL = 0.22;
const COLLISION_SETTLING_FRAME_COUNT = 15;
const COLLISION_HELD_FRAME_COUNT = 45;
// 狭いpost接触で生じる数度のyaw揺れは許し、横向き・斜め抜けは除外する。
const MIN_COLLISION_APPROACH_ALIGNMENT = 0.995;
// visual AABBとの接触誤差は約1/8 voxel未満だけ許し、中心越境と通過は別契約で拒否する。
const MIN_COLLISION_SURFACE_CLEARANCE = -0.12;

/** WebGL renderer名を既知software、明示physical、unknownへ保守的に分類する。 */
function classifyRenderer(rendererName) {
  const normalized = typeof rendererName === 'string' ? rendererName.trim() : '';
  if (/swiftshader|llvmpipe|softpipe|lavapipe|swrast|software (?:renderer|rasterizer|adapter)|basic render (?:driver|adapter)/i.test(normalized)) {
    return 'software';
  }
  if (
    /\bNVIDIA\b|\bAMD\b|\bRadeon\b/i.test(normalized)
    || /\bIntel(?:\(R\))?\b.*(?:Arc|Iris|UHD|HD Graphics|Graphics|GPU)/i.test(normalized)
    || /(?:\bApple\b.*(?:Metal|M[1-9]\d*|GPU|Silicon)|Metal.*\bApple\b)/i.test(normalized)
    || /\bAdreno\b|\bMali\b|\bPowerVR\b/i.test(normalized)
  ) {
    return 'physical';
  }
  return 'unknown';
}

/** fps下限とrenderer分類を、物理GPUだけ認証可能な判定へ変換する。 */
function evaluatePerformance(measuredFps, minimumFps, rendererName) {
  const rendererClass = classifyRenderer(rendererName);
  const thresholdMet = measuredFps >= minimumFps;
  return {
    certified: rendererClass === 'physical' && thresholdMet,
    physicalGpu: rendererClass === 'physical',
    rendererClass,
    thresholdMet,
  };
}

/** software/unknownを認証しない性能policyの代表境界を自己検証する。 */
function verifyPerformancePolicySelfCheck() {
  const cases = [
    ['ANGLE (SwiftShader Device)', 120, 60, 'software', false],
    ['llvmpipe (LLVM 15)', 20, 30, 'software', false],
    ['WebKit WebGL', 120, 60, 'unknown', false],
    ['', 120, 60, 'unknown', false],
    ['ANGLE (NVIDIA GeForce RTX 4080)', 60, 60, 'physical', true],
    ['Apple M3 Pro Metal GPU', 29.99, 30, 'physical', false],
  ];
  for (const [renderer, fps, minimum, expectedClass, expectedCertified] of cases) {
    const actual = evaluatePerformance(fps, minimum, renderer);
    assert.equal(actual.rendererClass, expectedClass);
    assert.equal(actual.certified, expectedCertified);
  }
}

/** 指定runのartifactを完全削除して空directoryを作る。 */
function resetOutputArtifacts(artifactDirectory) {
  fs.rmSync(artifactDirectory, { force: true, recursive: true });
  fs.mkdirSync(artifactDirectory, { recursive: true });
}

/** 現在runの状態をmode/fullメタデータとともにmanifestへ同期保存する。 */
function writeRunManifest(artifactDirectory, status, error = null, metadata = {}) {
  fs.writeFileSync(
    `${artifactDirectory}/run-manifest.json`,
    `${JSON.stringify({ error, ...metadata, recordedAt: new Date().toISOString(), status }, null, 2)}\n`,
  );
}

/** artifact初期化からscenario進捗と成功/失敗manifestまでを一続きで管理する。 */
async function runWithManifest(artifactDirectory, verification, metadata = {}) {
  resetOutputArtifacts(artifactDirectory);
  const scenarioProgress = createScenarioProgress({
    onUpdate: (snapshot) => {
      writeRunManifest(artifactDirectory, 'running', null, { ...metadata, ...snapshot });
    },
  });
  const readManifestMetadata = () => ({ ...metadata, ...scenarioProgress.snapshot() });
  writeRunManifest(artifactDirectory, 'running', null, readManifestMetadata());
  try {
    await verification(scenarioProgress);
    writeRunManifest(artifactDirectory, 'completed', null, readManifestMetadata());
  } catch (error) {
    const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    writeRunManifest(artifactDirectory, 'failed', errorMessage, readManifestMetadata());
    throw error;
  }
}

/** ViteがVoxel Gameへ応答するまで最大30秒pollする。 */
async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/voxel-game.html`);
      if (response.ok) return;
    } catch {
      // 次の短いpollで再試行する。
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Voxel Game server did not become ready within 30 seconds: ${baseUrl}`);
}

/** 既存の独立E2Eを同じVite serverへ接続し、失敗をstdout/stderr付きで伝播する。 */
async function runRegressionScript(scriptPath) {
  try {
    const { stderr, stdout } = await execFileAsync(process.execPath, [scriptPath], {
      env: { ...process.env, VOXEL_GAME_BASE_URL: baseUrl },
      maxBuffer: 20 * 1024 * 1024,
    });
    return {
      scriptPath,
      stderrTail: stderr.trim().split('\n').slice(-3),
      stdoutBytes: Buffer.byteLength(stdout),
    };
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    throw new Error(`${scriptPath} failed:\n${stderr}\n${stdout.slice(-8_000)}`);
  }
}

/** worldSolids telemetryから一意なsolidを取得し、欠落時はscenarioを停止する。 */
function requireWorldSolid(state, id) {
  const solid = state.visualLayout.worldSolids.find((candidate) => candidate.id === id);
  assert(solid, `World solid telemetry lacks ${id}.`);
  return solid;
}

/** 初期sceneがfire hazard、18個の火炎slot、非障害物route markerの公開契約を満たすことを確認する。 */
function assertInitialWorldPhysicsContract(initial) {
  const fireHazard = initial.visualLayout.fireHazard;
  const fireSprayTarget = initial.landmarks.fireSprayTarget;
  assert.equal(initial.visuals.fireHazardEnabled, true, 'Initial fire hazard is disabled.');
  assert.equal(initial.visuals.fireVoxelCount, 18, 'Initial voxel fire pool is incomplete.');
  assert.equal(initial.visuals.fireLayerCount, 3, 'Initial fire layer compatibility changed.');
  assert.deepEqual(
    [fireHazard.position[0], fireHazard.position[2]],
    [fireSprayTarget[0], fireSprayTarget[2]],
    'Fire hazard does not share the visible spray target XZ position.',
  );
  assert.deepEqual(fireHazard.scale, [1.2, 1.8, 1.2],
    'Fire hazard telemetry differs from the gameplay clearance contract.');
  assert.equal(initial.visualLayout.routeMarkers.length, 12, 'Route marker layout is incomplete.');
  assert(initial.visualLayout.routeMarkers.every(({ scale }) => scale[1] <= 0.14),
    'Route marker is still obstacle-height.');
  assert.equal(initial.visualLayout.worldSolids.length, 40, 'Production world solids are incomplete.');
}

/** 実camera telemetryを使ってworld座標を現在viewportのscreen座標へ投影する。 */
function projectWorldPoint(cameraTelemetry, position) {
  const { height, width } = cameraTelemetry.viewport;
  const camera = new THREE.OrthographicCamera(width / -2, width / 2, height / 2, height / -2);
  camera.position.fromArray(cameraTelemetry.position);
  camera.zoom = cameraTelemetry.zoom;
  camera.lookAt(new THREE.Vector3(...cameraTelemetry.lookTarget));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const point = new THREE.Vector3(...position).project(camera);
  return [(point.x + 1) * width / 2, (1 - point.y) * height / 2];
}

/** JSON artifactを改行付きで保存する。 */
function writeJsonArtifact(name, payload) {
  fs.writeFileSync(`${outputDirectory}/${name}`, `${JSON.stringify(payload, null, 2)}\n`);
}

/** HUDの安定DOM状態と保存bufferの実画素を検証し、compositor遅延だけ再取得してPNGへ書く。 */
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
      if (attempt < 2) await waitForFrames(page, 2);
    }
  }
  throw latestError;
}

/** mission pillを数frame安定させ、非空labelを確認してから検証済みPNGを保存する。 */
async function captureStableMissionScreenshot(page, path, description) {
  await waitForFrames(page, 3);
  const missionLabel = (await page.locator('.mission-pill__job').textContent())?.trim() ?? '';
  assert(missionLabel.length > 0, `${description}: mission pill label is empty.`);
  await captureVerifiedScreenshot(page, path);
  return missionLabel;
}

/** 検証済みPNGを代表名へ複製し、元画像の画素証跡も同時に引き継ぐ。 */
function copyVerifiedScreenshot(sourcePath, targetPath) {
  const sourceName = sourcePath.split('/').at(-1);
  const targetName = targetPath.split('/').at(-1);
  assert(sourceName && targetName && screenshotProofs[sourceName],
    `Screenshot proof is unavailable for copy: ${sourcePath}`);
  fs.copyFileSync(sourcePath, targetPath);
  screenshotProofs[targetName] = { ...screenshotProofs[sourceName], copiedFrom: sourceName };
}

/** 6主破片の平均world Yを返す。 */
function averageFragmentY(fragments) {
  assert.equal(fragments.length, 6, 'Average Y requires six fragments.');
  return fragments.reduce((sum, fragment) => sum + fragment.position[1], 0) / fragments.length;
}

/** 観測sampleの6主破片が元block AABB内にあるか判定する。 */
function fragmentsAreInsideBlock(fragments, blockPosition, tolerance = 0.03) {
  return fragments.length === 6 && fragments.every((fragment) => (
    Math.abs(fragment.position[0] - blockPosition[0]) + fragment.scale[0] / 2 <= 0.75 + tolerance
    && Math.abs(fragment.position[1] - blockPosition[1]) + fragment.scale[1] / 2 <= 0.75 + tolerance
    && Math.abs(fragment.position[2] - blockPosition[2]) + fragment.scale[2] / 2 <= 0.75 + tolerance
  ));
}

/** 元block AABBから最も外へ出た破片面の距離を返す。内包時は0以下になり得る。 */
function maximumFragmentAabbOverflow(fragments, blockPosition) {
  assert.equal(fragments.length, 6, 'AABB overflow requires six fragments.');
  return Math.max(...fragments.flatMap((fragment) => fragment.position.map((value, axis) => (
    Math.abs(value - blockPosition[axis]) + fragment.scale[axis] / 2 - 0.75
  ))));
}

/** first-activeから正常な6→0終了まで、全rAFで6片と同一ID集合が続くことを検証する。 */
function readContinuousFragmentWindow(samples, firstActiveIndex, blockId) {
  const firstActive = samples[firstActiveIndex];
  const expectedIds = firstActive.activeFragments.map(({ id }) => id).sort();
  const fragmentEndIndex = samples.findIndex((sample, index) => (
    index > firstActiveIndex
    && sample.sinceFirstActiveMs !== null
    && sample.activeFragments.length === 0
  ));
  assert(fragmentEndIndex > firstActiveIndex, `${blockId}: rAF timeline has no 6-to-0 fragment end.`);
  const activeSamples = samples.slice(firstActiveIndex, fragmentEndIndex);
  for (const sample of activeSamples) {
    assert.equal(sample.activeFragments.length, 6,
      `${blockId}: fragment count changed before the normal 6-to-0 end at ${sample.sinceFirstActiveMs}ms.`);
    assert.deepEqual(sample.activeFragments.map(({ id }) => id).sort(), expectedIds,
      `${blockId}: fragment IDs changed before the normal 6-to-0 end at ${sample.sinceFirstActiveMs}ms.`);
  }
  return { activeSamples, ended: samples[fragmentEndIndex], expectedIds };
}

/** 指定時刻に最も近いsampleを許容誤差内から選ぶ。 */
function sampleNearestElapsed(samples, elapsedMilliseconds, toleranceMilliseconds) {
  const ranked = samples
    .map((sample) => ({ delta: Math.abs(sample.sinceFirstActiveMs - elapsedMilliseconds), sample }))
    .sort((first, second) => first.delta - second.delta);
  return ranked[0]?.delta <= toleranceMilliseconds ? ranked[0].sample : null;
}

/** 衝突入力前から毎rAFの実telemetryを保存するpage内observerを開始する。 */
async function startBreakFrameObserver(page, blockId, baselineImpactCount) {
  await page.evaluate(({ baseline, targetId, wallTimeoutMs }) => {
    const previous = window.__voxelBreakFrameObserver;
    if (previous?.frameId) cancelAnimationFrame(previous.frameId);
    const observer = {
      baselineImpactCount: baseline,
      firstActiveAtMs: null,
      firstImpactAtMs: null,
      frameId: 0,
      running: true,
      samples: [],
      startedAtMs: performance.now(),
      targetId,
    };
    window.__voxelBreakFrameObserver = observer;
    const capture = (capturedAtMs) => {
      if (!observer.running) return;
      const rendered = window.render_game_to_text?.();
      if (!rendered) {
        observer.running = false;
        observer.error = 'render_game_to_text unavailable during break observation';
        return;
      }
      const state = JSON.parse(rendered);
      const targetBlock = state.breakables.blocks.find(({ id }) => id === targetId) ?? null;
      const runtimeBlock = state.runtime.blocks.find(({ id }) => id === targetId) ?? null;
      const activeFragments = state.breakables.activeFragments
        .filter(({ id }) => id.startsWith(`${targetId}:`))
        .map(({ id, position, scale }) => ({ id, position: [...position], scale: [...scale] }));
      const sample = {
        activeChips: state.breakables.chips
          .filter(({ active }) => active)
          .map(({ position, scale, slot }) => ({ position: [...position], scale, slot })),
        activeFragments,
        block: targetBlock ? {
          intactBodyEnabledCount: targetBlock.intactBodyEnabledCount,
          intactColliderEnabledCount: targetBlock.intactColliderEnabledCount,
          intactEnabledCountAtFragmentActivation: targetBlock.intactEnabledCountAtFragmentActivation,
          intactVisible: targetBlock.intactVisible,
          maxImpactSpeed: targetBlock.maxImpactSpeed,
          vehicleImpactCount: targetBlock.vehicleImpactCount,
        } : null,
        capturedAtMs,
        otherBlocks: state.breakables.blocks
          .filter(({ id }) => id !== targetId)
          .map(({ id, vehicleImpactCount }) => ({ id, vehicleImpactCount })),
        runtimeBlock,
        sinceFirstActiveMs: null,
        sinceObserverStartMs: capturedAtMs - observer.startedAtMs,
        vehicle: {
          forward: [...state.vehicle.forward],
          position: [...state.vehicle.position],
          resetCount: state.vehicle.resetCount,
          speed: state.vehicle.speed,
        },
      };
      if (observer.firstImpactAtMs === null
        && (targetBlock?.vehicleImpactCount ?? baseline) > baseline
        && (targetBlock?.maxImpactSpeed ?? 0) >= 4) {
        observer.firstImpactAtMs = capturedAtMs;
      }
      if (observer.firstActiveAtMs === null && activeFragments.length === 6) {
        observer.firstActiveAtMs = capturedAtMs;
      }
      if (observer.firstActiveAtMs !== null) {
        sample.sinceFirstActiveMs = capturedAtMs - observer.firstActiveAtMs;
      }
      observer.samples.push(sample);
      if (observer.samples.length > 720) observer.samples.shift();
      if (observer.firstActiveAtMs !== null) {
        const activeAgeMs = capturedAtMs - observer.firstActiveAtMs;
        if ((activeAgeMs >= 900 && activeFragments.length === 0)
          || activeAgeMs >= wallTimeoutMs) {
          observer.running = false;
          observer.stoppedReason = activeFragments.length === 0 ? 'fragment-window-ended' : 'observer-timeout';
          return;
        }
      }
      observer.frameId = requestAnimationFrame(capture);
    };
    observer.frameId = requestAnimationFrame(capture);
  }, {
    baseline: baselineImpactCount,
    targetId: blockId,
    wallTimeoutMs: BREAK_OBSERVER_WALL_TIMEOUT_MS,
  });
}

/** page内observerを停止し、関数を含まない時系列artifactを取得する。 */
async function stopAndReadBreakFrameObserver(page) {
  return page.evaluate(() => {
    const observer = window.__voxelBreakFrameObserver;
    if (!observer) throw new Error('Break frame observer is unavailable.');
    observer.running = false;
    if (observer.frameId) cancelAnimationFrame(observer.frameId);
    return JSON.parse(JSON.stringify(observer));
  });
}

/** cameraが車両へ追従しても変わらないworld-fixed offsetを返す。 */
function getCameraOffset(state) {
  return state.camera.position.map((value, index) => value - state.camera.lookTarget[index]);
}

/** 固定pool identityとslot数がTask 7契約を保つことを確認する。 */
function readPoolIdentity(state, scenario) {
  const breakables = state.breakables;
  assert.equal(breakables.poolSlotCount, 24, `${scenario}: main fragment pool is not 24.`);
  assert.equal(breakables.uniqueBodyHandleCount, 24, `${scenario}: main fragment body identity is not 24.`);
  assert.equal(breakables.uniqueColliderHandleCount, 24, `${scenario}: main fragment collider identity is not 24.`);
  assert.equal(breakables.uniqueMeshUuidCount, 24, `${scenario}: main fragment mesh identity is not 24.`);
  assert.equal(breakables.chipPoolSlotCount, 32, `${scenario}: chip pool is not 32.`);
  assert.equal(breakables.chips.length, 32, `${scenario}: chip telemetry is not 32 slots.`);
  assert.equal(state.visuals.waterInstances.length, 32, `${scenario}: water pool is not 32 slots.`);
  assert.equal(state.visuals.waterInstances.filter(({ kind }) => kind === 'stream').length, 24,
    `${scenario}: water stream pool is not 24.`);
  assert.equal(state.visuals.waterInstances.filter(({ kind }) => kind === 'splash').length, 8,
    `${scenario}: water splash pool is not 8.`);
  return {
    bodyHandles: [...breakables.bodyHandles],
    colliderHandles: [...breakables.colliderHandles],
    meshUuids: [...breakables.meshUuids],
    poolSlotIds: [...breakables.poolSlotIds],
  };
}

/** 固定pool identityがscenario前後で増減・置換されていないことを確認する。 */
function assertPoolIdentity(state, expected, scenario) {
  const actual = readPoolIdentity(state, scenario);
  assert.deepEqual(actual, expected, `${scenario}: fixed pool identity changed.`);
}

/** console/page/request failureを収集し、指定entryの独立contextでscene/HUD/hookを開く。 */
async function openViewportPage(browser, target, errors, pathname = '/voxel-game.html') {
  const context = await browser.newContext({
    hasTouch: target.hasTouch,
    viewport: { height: target.height, width: target.width },
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${target.name}: console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`${target.name}: pageerror: ${String(error)}`));
  page.on('requestfailed', (request) => errors.push(
    `${target.name}: requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`,
  ));
  await page.goto(`${baseUrl}${pathname}?release=${target.name}-${Date.now()}&job-seed=1`, { waitUntil: 'networkidle' });
  await page.locator('.voxel-game-canvas canvas').waitFor({ state: 'visible' });
  await page.locator('.voxel-game-hud').waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => document.documentElement.dataset.voxelSceneReady === 'true'
      && typeof window.render_game_to_text === 'function'
      && typeof window.advanceTime === 'function'
      && typeof window.reset_voxel_game_vehicle === 'function',
    undefined,
    { timeout: 5_000 },
  );
  return { context, page };
}

/** Canvas/HUD/4操作要素を実寸で測り、viewportと親境界内包・非重複を確認する。 */
async function measureLayout(page, target) {
  const layout = await page.evaluate(() => {
    const edges = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width,
      };
    };
    const hud = document.querySelector('.voxel-game-hud');
    const canvas = document.querySelector('.voxel-game-canvas canvas');
    if (!hud || !canvas) throw new Error('HUD or Canvas is missing.');
    const controls = Object.fromEntries(Object.entries({
      fullscreen: '.fullscreen-button',
      joystick: '.touch-joystick',
      mission: '.mission-pill',
      spray: '.primary-action-button',
    }).map(([name, selector]) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      return [name, edges(element)];
    }));
    return { canvas: edges(canvas), controls, hud: edges(hud) };
  });
  const viewport = { bottom: target.height, left: 0, right: target.width, top: 0 };
  const inside = (child, parent) => child.left >= parent.left && child.top >= parent.top
    && child.right <= parent.right && child.bottom <= parent.bottom;
  const overlaps = (first, second) => first.left < second.right && first.right > second.left
    && first.top < second.bottom && first.bottom > second.top;
  assert(Math.abs(layout.canvas.width - target.width) <= 1
    && Math.abs(layout.canvas.height - target.height) <= 1,
  `${target.name}: Canvas does not match viewport: ${JSON.stringify(layout.canvas)}`);
  assert(inside(layout.hud, viewport), `${target.name}: HUD exceeds viewport.`);
  for (const [name, box] of Object.entries(layout.controls)) {
    assert(inside(box, layout.hud), `${target.name}: ${name} exceeds HUD parent.`);
    assert(inside(box, viewport), `${target.name}: ${name} exceeds viewport.`);
  }
  for (const [first, second] of [
    ['joystick', 'spray'], ['joystick', 'mission'], ['spray', 'mission'], ['mission', 'fullscreen'],
  ]) {
    assert(!overlaps(layout.controls[first], layout.controls[second]),
      `${target.name}: ${first}/${second} overlap.`);
  }
  return layout;
}

/** 標準rootがDesktop/Mobileとも新Voxel Gameの初期状態とlayoutを公開するか検証する。 */
async function verifyCanonicalRoot(browser, errors) {
  const results = {};
  for (const target of [
    { hasTouch: false, height: 720, name: 'root-desktop', width: 1_280 },
    { hasTouch: true, height: 390, name: 'root-mobile-landscape', width: 844 },
  ]) {
    const { context, page } = await openViewportPage(browser, target, errors, '/');
    try {
      const state = await readGameState(page);
      const layout = await measureLayout(page, target);
      const garage = state.landmarks.garage;
      assert.equal(state.mode, 'drive-ready');
      assert.equal(state.runtime.missionPhase, 'assigned');
      assert(Math.hypot(
        state.vehicle.position[0] - garage[0],
        state.vehicle.position[2] - garage[2],
      ) <= 0.5);
      assert.equal(state.world.currentDistrict, 'hub');
      assert(state.vehicle.mass >= 1.3);
      results[target.name] = {
        layout,
        mode: state.mode,
        missionPhase: state.runtime.missionPhase,
        vehiclePosition: state.vehicle.position,
      };
    } finally {
      await context.close();
    }
  }
  return results;
}

/** XZ waypoint列の道路上移動距離を合計する。 */
function measureRoadDistance(positions) {
  return positions.slice(1).reduce((distance, position, index) => (
    distance + Math.hypot(
      position[0] - positions[index][0],
      position[2] - positions[index][2],
    )
  ), 0);
}

/** 実入力の地区移動を計時し、到着地区と35秒上限を検証する。 */
async function verifyDistrictJourney(page, destinationDistrict, description, drive) {
  const started = await readGameState(page);
  const startedAt = Date.now();
  const { state: arrived, waypoints = [] } = await drive(started);
  const durationSeconds = (Date.now() - startedAt) / 1_000;
  assert.equal(arrived.world.currentDistrict, destinationDistrict,
    `${description}: arrived in ${arrived.world.currentDistrict}.`);
  assert(durationSeconds <= 35,
    `${description}: district journey exceeded 35 seconds (${durationSeconds}).`);
  return {
    destinationDistrict,
    durationSeconds,
    from: started.vehicle.position,
    roadDistanceUnits: measureRoadDistance([
      started.vehicle.position,
      ...waypoints,
      arrived.vehicle.position,
    ]),
    to: arrived.vehicle.position,
  };
}

/** 再利用scenarioの開始から地区到着までを検証し、JSON保存用snapshotとwall-clockを返す。 */
function buildVerifiedScenarioArrival(
  started,
  arrived,
  destinationDistrict,
  startedAtMs,
  description,
  expectedArrivalDistrict = destinationDistrict,
) {
  const arrivedAtMs = Date.now();
  const durationSeconds = (arrivedAtMs - startedAtMs) / 1_000;
  assert.equal(arrived.world.currentDistrict, expectedArrivalDistrict,
    `${description}: arrived in ${arrived.world.currentDistrict}: ${JSON.stringify({
      position: arrived.vehicle.position,
      world: arrived.world,
    })}`);
  assert(durationSeconds <= 35,
    `${description}: district journey exceeded 35 seconds (${durationSeconds}).`);
  return {
    arrival: {
      mission: arrived.mission,
      vehicle: arrived.vehicle,
      world: arrived.world,
    },
    journey: {
      arrivalDistrict: expectedArrivalDistrict,
      arrivedAtMs,
      destinationDistrict,
      durationSeconds,
      from: started.vehicle.position,
      startedAtMs,
      to: arrived.vehicle.position,
    },
  };
}

/** 本番mapの初期world契約とhub→park→hub→south→hubの実入力移動を検証する。 */
async function verifyProductionMap(browser, errors) {
  const viewport = { hasTouch: false, height: 720, name: 'production-map', width: 1_280 };
  const { context, page } = await openViewportPage(
    browser,
    viewport,
    errors,
  );
  try {
    const initial = await readGameState(page);
    assert.deepEqual(initial.world.bounds, {
      maxX: 48, maxZ: 48, minX: -48, minZ: -48,
    });
    assert.equal(initial.world.currentDistrict, 'hub');
    assert.equal(initial.world.destinationDistrict, 'fire');
    assert.equal(initial.visualLayout.worldSolids.length, 40);
    const southSignPost = requireWorldSolid(initial, 'south-sign-post-west');
    const hubToolRack = requireWorldSolid(initial, 'hub-tool-rack-post');
    const southTransitX = Math.max(
      initial.landmarks.garage[0] + 6.5,
      hubToolRack.position[0]
        + hubToolRack.scale[0] / 2
        + VEHICLE_COLLIDER_HALF_EXTENTS[0]
        + 1,
    );
    // 南側からhub境界へ戻る区間はgarage背面の手前で終了するため、工具ラックを
    // 奥まで通過する往路とは分け、旧来のgarage外周レーンを使う。
    const southReturnTransitX = initial.landmarks.garage[0] + 6.5;
    const southCaptureTargetZ = southSignPost.position[2] - 2;
    const initialResetCount = initial.vehicle.resetCount;
    const hubCaptureState = await driveAlongWorldAxis(
      page,
      'negativeZ',
      (state) => state.vehicle.position[2] <= initial.landmarks.garage[2] - 5.5,
      'production-map hub garage opening',
    );
    assert.equal(hubCaptureState.vehicle.resetCount, initialResetCount,
      'production-map hub capture reset the vehicle.');
    assert.equal(hubCaptureState.world.currentDistrict, 'hub',
      `production-map hub capture left hub: ${JSON.stringify(hubCaptureState.world)}`);
    assert(initial.vehicle.position[2] - hubCaptureState.vehicle.position[2] >= 5,
      `production-map hub capture did not leave the garage: ${JSON.stringify({
        initial: initial.vehicle.position,
        outside: hubCaptureState.vehicle.position,
      })}`);
    const hubMissionLabel = await captureStableMissionScreenshot(
      page,
      `${outputDirectory}/desktop-production-hub.png`,
      'production-map hub capture',
    );

    const journeys = [];
    journeys.push(await verifyDistrictJourney(
      page,
      'park',
      'production-map hub to park',
      async () => ({
        state: await driveAlongWorldAxis(
          page,
          'negativeZ',
          (state) => state.world.currentDistrict === 'park',
          'production-map hub to park',
        ),
      }),
    ));
    const parkMissionLabel = await captureStableMissionScreenshot(
      page,
      `${outputDirectory}/desktop-production-park.png`,
      'production-map park capture',
    );

    journeys.push(await verifyDistrictJourney(
      page,
      'hub',
      'production-map park to hub',
      async () => ({
        state: await driveAlongWorldAxis(
          page,
          'positiveZ',
          (state) => state.world.currentDistrict === 'hub',
          'production-map park to hub',
        ),
      }),
    ));
    await alignWorldCoordinate(page, 0, initial.landmarks.garage[0], 'production-map hub X');
    // 東西幹線は幅5unitあるため、停止時の約0.9unitの惰性を許容しても車体は道路内に収まる。
    // 0.32unitへの過剰な中心合わせは1frame pulseで往復し、正しい経路をflakyに失敗させる。
    await alignWorldCoordinate(page, 2, 0, 'production-map central crossing Z', 1);

    journeys.push(await verifyDistrictJourney(
      page,
      'south',
      'production-map hub to south',
      async () => {
        const eastStage = await driveAlongWorldAxis(
          page,
          'positiveX',
          (state) => state.vehicle.position[0] >= southTransitX,
          'production-map south garage bypass',
        );
        const alignedStage = await alignWorldCoordinate(
          page,
          0,
          southTransitX,
          'production-map south outbound safe lane X',
          0.8,
        );
        const state = await driveAlongWorldAxis(
          page,
          'positiveZ',
          (candidate) => candidate.world.currentDistrict === 'south',
          'production-map hub to south',
        );
        return { state, waypoints: [eastStage.vehicle.position, alignedStage.vehicle.position] };
      },
    ));
    await alignWorldCoordinate(
      page,
      0,
      0,
      'production-map south capture center X',
      0.35,
    );
    await driveAlongWorldAxis(
      page,
      'positiveZ',
      (state) => state.vehicle.position[2] >= southCaptureTargetZ,
      'production-map south sign staging',
    );
    await waitForFrames(page, 3);
    const southCaptureState = await readGameState(page);
    assert.equal(southCaptureState.vehicle.resetCount, initialResetCount,
      'production-map south capture reset the vehicle.');
    assert.equal(southCaptureState.world.currentDistrict, 'south',
      `production-map south capture left south: ${JSON.stringify(southCaptureState.world)}`);
    assert(southCaptureState.vehicle.position[2] >= southCaptureTargetZ,
      `production-map south capture stopped before the signs: ${JSON.stringify(
        { sign: southSignPost, targetZ: southCaptureTargetZ, vehicle: southCaptureState.vehicle },
      )}`);
    const southCaptureLayout = await measureLayout(page, viewport);
    const southSignScreenPosition = projectWorldPoint(
      southCaptureState.camera,
      southSignPost.position,
    );
    const [southSignScreenX, southSignScreenY] = southSignScreenPosition;
    const screenSafetyMargin = 24;
    assert(
      southSignScreenX >= southCaptureLayout.canvas.left + screenSafetyMargin
        && southSignScreenX <= southCaptureLayout.canvas.right - screenSafetyMargin
        && southSignScreenY >= southCaptureLayout.canvas.top + screenSafetyMargin
        && southSignScreenY <= southCaptureLayout.canvas.bottom - screenSafetyMargin,
      `production-map south sign is outside the canvas safe area: ${JSON.stringify({
        screenPosition: southSignScreenPosition,
        sign: southSignPost,
      })}`,
    );
    const overlappingHudControl = Object.entries(southCaptureLayout.controls).find(
      ([, box]) => southSignScreenX >= box.left - screenSafetyMargin
        && southSignScreenX <= box.right + screenSafetyMargin
        && southSignScreenY >= box.top - screenSafetyMargin
        && southSignScreenY <= box.bottom + screenSafetyMargin,
    );
    assert.equal(overlappingHudControl, undefined,
      `production-map south sign overlaps a HUD safe area: ${JSON.stringify({
        control: overlappingHudControl,
        screenPosition: southSignScreenPosition,
        sign: southSignPost,
      })}`);
    const southMissionLabel = await captureStableMissionScreenshot(
      page,
      `${outputDirectory}/desktop-production-south.png`,
      'production-map south capture',
    );

    journeys.push(await verifyDistrictJourney(
      page,
      'hub',
      'production-map south to hub',
      async () => {
        const eastStage = await driveAlongWorldAxis(
          page,
          'positiveX',
          (state) => state.vehicle.position[0] >= southReturnTransitX,
          'production-map south return garage bypass',
        );
        const alignedStage = await alignWorldCoordinate(
          page,
          0,
          southReturnTransitX,
          'production-map south return safe lane X',
          0.8,
        );
        const state = await driveAlongWorldAxis(
          page,
          'negativeZ',
          (candidate) => candidate.world.currentDistrict === 'hub',
          'production-map south to hub',
        );
        return { state, waypoints: [eastStage.vehicle.position, alignedStage.vehicle.position] };
      },
    ));

    const { breakableBlocks, ...singletonLandmarks } = initial.landmarks;
    return {
      density: {
        districtCount: initial.world.districts.length,
        landmarkCount: breakableBlocks.length + Object.keys(singletonLandmarks).length,
        routeMarkerCount: initial.visualLayout.routeMarkers.length,
        worldSolidCount: initial.visualLayout.worldSolids.length,
      },
      initial: initial.world,
      hubCapture: {
        missionLabel: hubMissionLabel,
        vehicle: hubCaptureState.vehicle,
        world: hubCaptureState.world,
      },
      journeys,
      parkCapture: {
        missionLabel: parkMissionLabel,
      },
      southCapture: {
        missionLabel: southMissionLabel,
        signPost: {
          id: southSignPost.id,
          position: southSignPost.position,
          screenPosition: southSignScreenPosition,
          targetVehicleZ: southCaptureTargetZ,
        },
        vehicle: southCaptureState.vehicle,
        world: southCaptureState.world,
      },
    };
  } finally {
    await context.close();
  }
}

/** Canvasが公開するWebGL renderer情報を取得する。 */
async function readRendererInfo(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.voxel-game-canvas canvas');
    const context = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    if (!context) throw new Error('Voxel Game WebGL context is unavailable.');
    const debug = context.getExtension('WEBGL_debug_renderer_info');
    return {
      drawingBufferHeight: context.drawingBufferHeight,
      drawingBufferWidth: context.drawingBufferWidth,
      renderer: context.getParameter(context.RENDERER),
      unmaskedRenderer: debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      unmaskedVendor: debug ? context.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
      vendor: context.getParameter(context.VENDOR),
      version: context.getParameter(context.VERSION),
    };
  });
}

/** 2秒間の実rendered frame増分、rAF増分、steady draw callsを測る。 */
async function measurePerformance(page, target) {
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => ({
    capturedAt: performance.now(),
    renderer: JSON.parse(window.render_game_to_text()).renderer,
  }));
  const rafDelta = await page.evaluate(() => new Promise((resolve) => {
    let frames = 0;
    const startedAt = performance.now();
    const tick = () => {
      frames += 1;
      if (performance.now() - startedAt >= 2_000) resolve(frames);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  const after = await page.evaluate(() => ({
    capturedAt: performance.now(),
    renderer: JSON.parse(window.render_game_to_text()).renderer,
  }));
  const elapsedSeconds = (after.capturedAt - before.capturedAt) / 1_000;
  const renderedFrameDelta = after.renderer.renderedFrames - before.renderer.renderedFrames;
  assert(renderedFrameDelta > 0 && rafDelta > 0, `${target.name}: frame counters did not advance.`);
  assert(before.renderer.rendererCalls > 0
    && before.renderer.rendererCalls === after.renderer.rendererCalls,
  `${target.name}: renderer calls are not steady: ${JSON.stringify({ before, after })}`);
  return {
    elapsedMilliseconds: after.capturedAt - before.capturedAt,
    fps: renderedFrameDelta / elapsedSeconds,
    rAfFrameDelta: rafDelta,
    renderedFrameDelta,
    rendererCalls: after.renderer.rendererCalls,
    source: 'CPU-side requestAnimationFrame and R3F renderedFrames delta over two seconds',
  };
}

/** CDP実touchで任意screen方向のstickと放水を操作する。 */
async function createTouchDriver(page) {
  const cdp = await page.context().newCDPSession(page);
  const joystick = await page.locator('.touch-joystick').boundingBox();
  const spray = await page.locator('.primary-action-button').boundingBox();
  assert(joystick && spray, 'Touch controls lack bounding boxes.');
  const center = { x: joystick.x + joystick.width / 2, y: joystick.y + joystick.height / 2 };
  const radius = Math.min(joystick.width, joystick.height) / 2;
  const sprayCenter = { x: spray.x + spray.width / 2, y: spray.y + spray.height / 2 };
  let sprayActive = false;
  let stickActive = false;

  return {
    async close() {
      await cdp.detach();
    },
    async pressSpray() {
      assert(!stickActive, 'Spray touch must start after joystick release.');
      if (sprayActive) return;
      await cdp.send('Input.dispatchTouchEvent', {
        touchPoints: [{ id: 72, ...sprayCenter }],
        type: 'touchStart',
      });
      sprayActive = true;
    },
    async releaseSpray() {
      if (!sprayActive) return;
      await cdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
      sprayActive = false;
    },
    async releaseStick() {
      if (!stickActive) return;
      await cdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
      stickActive = false;
    },
    async setStick(x, y) {
      const length = Math.hypot(x, y) || 1;
      const normalizedX = x / length;
      const normalizedY = y / length;
      if (!stickActive) {
        await cdp.send('Input.dispatchTouchEvent', {
          touchPoints: [{ id: 71, ...center }],
          type: 'touchStart',
        });
        stickActive = true;
      }
      await cdp.send('Input.dispatchTouchEvent', {
        touchPoints: [{
          id: 71,
          x: center.x + normalizedX * radius * 0.82,
          y: center.y + normalizedY * radius * 0.82,
        }],
        type: 'touchMove',
      });
    },
  };
}

/** 既存の引数順とbrake任意契約を保って共有cardinal走行を呼ぶ。 */
async function driveAlongWorldAxis(
  page,
  axis,
  predicate,
  description,
  touchDriver,
  maxBursts = 360,
  brakeAfterArrival = true,
) {
  return driveHarness.driveAlongWorldAxis(page, {
    axis,
    brakeAfterArrival,
    description,
    maxBursts,
    predicate,
    touchDriver,
  });
}

/** telemetryの照準点から旧6unit外かつ照準済みになる東側道路位置へ微調整する。 */
async function driveToForgivingSprayTarget(page) {
  const initialResetCount = (await readGameState(page)).vehicle.resetCount;
  const initialState = await readGameState(page);
  const target = initialState.landmarks.fireSprayTarget;
  let latestState = null;
  await alignWorldCoordinate(page, 0, target[0] + 2.1, 'forgiving spray east X', 0.2);
  await alignWorldCoordinate(page, 2, target[2] + 8.1, 'forgiving spray exterior Z', 0.2);
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const state = await readGameState(page);
    latestState = state;
    const horizontalDistance = Math.hypot(
      target[0] - state.mission.nozzleOrigin[0],
      target[2] - state.mission.nozzleOrigin[2],
    );
    if (state.mission.targeted && horizontalDistance > 6 && horizontalDistance <= 7) {
      return state;
    }
    assert.equal(state.vehicle.resetCount, initialResetCount,
      `forgiving spray target acquisition reset unexpectedly: ${JSON.stringify({
        direction: state.mission.direction,
        distance: state.mission.distance,
        horizontalDistance,
        vehiclePosition: state.vehicle.position,
      })}`);
    await pulseAlongWorldAxis(
      page,
      horizontalDistance <= 6 ? 'positiveZ' : 'negativeZ',
      1,
    );
  }
  throw new Error(`forgiving spray target acquisition did not reach the old-range exterior: ${JSON.stringify({
    initial: {
      direction: initialState.mission.direction,
      distance: initialState.mission.distance,
      nozzleOrigin: initialState.mission.nozzleOrigin,
      targeted: initialState.mission.targeted,
      vehiclePosition: initialState.vehicle.position,
    },
    direction: latestState?.mission.direction,
    distance: latestState?.mission.distance,
    vehiclePosition: latestState?.vehicle.position,
  })}`);
}

/** 既存の引数順を保って共有cardinal pulseを呼ぶ。 */
async function pulseAlongWorldAxis(page, axis, frameCount, touchDriver) {
  return driveHarness.pulseWorldAxis(page, {
    axis,
    frameCount,
    touchDriver,
  });
}

/** canonical固有のtolerance-first引数順を保って共有alignを呼ぶ。 */
async function alignWorldCoordinate(
  page,
  coordinateIndex,
  targetValue,
  description,
  tolerance = 0.32,
  touchDriver = null,
  options = {},
) {
  return driveHarness.alignWorldCoordinate(page, {
    coordinateIndex,
    description,
    ...options,
    target: targetValue,
    tolerance,
    touchDriver,
  });
}

/** 中央車庫から東幹線と火災地区道路を通って炎の照準距離へ進む。 */
async function driveMissionToFire(page, touchDriver) {
  const initial = await readGameState(page);
  const garage = initial.landmarks.garage;
  const target = initial.landmarks.fireSprayTarget;
  const routePlan = createFireRoutePlan(initial.mission.jobId, target);
  await driveAlongWorldAxis(page, 'negativeZ', (state) => state.vehicle.position[2] <= garage[2] - 3,
    'fire route garage opening', touchDriver);
  await alignWorldCoordinate(page, 2, 0, 'fire route central crossing Z', 0.5, touchDriver);
  await driveAlongWorldAxis(page, 'positiveX', (state) => state.vehicle.position[0] >= routePlan.trunkX,
    'fire route east trunk road', touchDriver);
  await alignWorldCoordinate(page, 0, routePlan.trunkX, 'fire route east road X', 0.4, touchDriver);
  await driveAlongWorldAxis(page, 'negativeZ', (state) => (
    state.vehicle.position[2] <= routePlan.latitudeZ
  ), 'fire route north road', touchDriver);
  await alignWorldCoordinate(
    page,
    2,
    routePlan.latitudeZ,
    'fire route target latitude',
    0.9,
    touchDriver,
  );
  await alignWorldCoordinate(
    page,
    0,
    routePlan.stagingX,
    `fire route target ${routePlan.approachFace} staging`,
    0.35,
    touchDriver,
  );
  const maximumTargetAcquisitionAttempts = 12;
  const maximumTargetAcquisitionBrakeFrames = 150;
  const targetAcquisitionResetCount = initial.vehicle.resetCount;
  let targetAcquisitionAttemptCount = 0;
  let targetAcquisitionInputFrameCount = 0;
  let targetAcquisitionBrakeFrameCount = 0;
  let targetAcquisitionObservedFrameCount = 0;
  let targetAcquisitionTargetedObservationCount = 0;
  let targetAcquisitionCorrectionPulseCount = 0;
  let targetAcquisitionFirstTargetedDot = null;
  const targetAcquisitionAxes = [];
  let targetedObservedBeforeStop = false;

  /** fire targetへの水平距離と車両forwardとのdotを返す。 */
  const getFireTargetGeometry = (candidate) => {
    const targetDelta = [
      target[0] - candidate.mission.nozzleOrigin[0],
      target[2] - candidate.mission.nozzleOrigin[2],
    ];
    const horizontalDistance = Math.hypot(...targetDelta);
    const forwardLength = Math.hypot(candidate.vehicle.forward[0], candidate.vehicle.forward[2]);
    return {
      dot: horizontalDistance > 0 && forwardLength > 0
        ? (
          candidate.vehicle.forward[0] / forwardLength
            * targetDelta[0] / horizontalDistance
          + candidate.vehicle.forward[2] / forwardLength
            * targetDelta[1] / horizontalDistance
        )
        : Number.NaN,
      horizontalDistance,
    };
  };

  /** ノズルから対象への残差が大きいworld軸を選び、側面接近をXからZへ収束させる。 */
  const chooseTargetAcquisitionAxis = (candidate) => {
    const deltaX = target[0] - candidate.mission.nozzleOrigin[0];
    const deltaZ = target[2] - candidate.mission.nozzleOrigin[2];
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaZ)) return routePlan.acquisitionAxis;
    if (Math.abs(deltaX) >= Math.abs(deltaZ)) return deltaX < 0 ? 'negativeX' : 'positiveX';
    return deltaZ < 0 ? 'negativeZ' : 'positiveZ';
  };

  /** target最終調整の各snapshotでreset・world bounds・targetedを検査する。 */
  const observeTargetAcquisitionState = (candidate, stage) => {
    const colliderSupport = vehicleColliderSupport(candidate.vehicle);
    targetAcquisitionObservedFrameCount += 1;
    assert.equal(candidate.vehicle.resetCount, targetAcquisitionResetCount,
      `${stage}: fire target acquisition reset unexpectedly: ${JSON.stringify(candidate.vehicle)}`);
    assert(candidate.vehicle.position[0] >= candidate.world.bounds.minX + colliderSupport.x
      && candidate.vehicle.position[0] <= candidate.world.bounds.maxX - colliderSupport.x
      && candidate.vehicle.position[2] >= candidate.world.bounds.minZ + colliderSupport.z
      && candidate.vehicle.position[2] <= candidate.world.bounds.maxZ - colliderSupport.z,
    `${stage}: fire target acquisition left the support-safe world bounds: ${JSON.stringify({
      colliderSupport,
      position: candidate.vehicle.position,
      worldBounds: candidate.world.bounds,
    })}`);
    if (candidate.mission.targeted) {
      targetAcquisitionTargetedObservationCount += 1;
      if (targetAcquisitionFirstTargetedDot === null) {
        targetAcquisitionFirstTargetedDot = getFireTargetGeometry(candidate).dot;
      }
      targetedObservedBeforeStop = true;
    }
    return candidate;
  };

  /** 1frame入力と停止までの全brake frameをtarget observerへ通す。 */
  const pulseTargetAcquisition = async (axis, description) => {
    const input = WORLD_AXIS_INPUTS[axis];
    assert(input, `${description}: unknown world axis ${axis}.`);
    const heldKeys = new Set();
    let latest = null;
    try {
      if (touchDriver) await touchDriver.setStick(...input.stick);
      else await syncKeyboardKeys(page, heldKeys, input.keys);
      await waitForFrames(page, 1);
      targetAcquisitionInputFrameCount += 1;
      latest = observeTargetAcquisitionState(
        await readGameState(page),
        `${description}: input`,
      );
    } finally {
      await touchDriver?.releaseStick();
      await releaseKeyboardKeys(page, heldKeys);
    }
    for (let frame = 0; frame < maximumTargetAcquisitionBrakeFrames; frame += 1) {
      await waitForFrames(page, 1);
      targetAcquisitionBrakeFrameCount += 1;
      latest = observeTargetAcquisitionState(
        await readGameState(page),
        `${description}: brake`,
      );
      if (latest.vehicle.speed < 0.24) return latest;
    }
    throw new Error(`${description}: vehicle did not stop within the target acquisition frame limit: ${JSON.stringify({
      latestVehicle: latest?.vehicle,
      maximumTargetAcquisitionBrakeFrames,
      targetAcquisitionAttemptCount,
      targetAcquisitionBrakeFrameCount,
      targetAcquisitionInputFrameCount,
      targetAcquisitionObservedFrameCount,
    })}`);
  };

  let state = observeTargetAcquisitionState(
    await readGameState(page),
    'fire route target acquisition start',
  );
  while (!state.mission.targeted
    && targetAcquisitionAttemptCount < maximumTargetAcquisitionAttempts) {
    if (targetedObservedBeforeStop) targetAcquisitionCorrectionPulseCount += 1;
    targetAcquisitionAttemptCount += 1;
    const acquisitionAxis = chooseTargetAcquisitionAxis(state);
    targetAcquisitionAxes.push(acquisitionAxis);
    state = await pulseTargetAcquisition(
      acquisitionAxis,
      'fire route target acquisition',
    );
  }
  const targetGeometry = getFireTargetGeometry(state);
  if (!Number.isFinite(state.mission.distance)
    || !state.mission.targeted
    || !Number.isFinite(targetAcquisitionFirstTargetedDot)
    || targetAcquisitionFirstTargetedDot < 0.5
    || !Number.isFinite(targetGeometry.dot)
    || targetGeometry.dot < 0.5) {
    throw new Error(`Fire route target acquisition did not converge: ${JSON.stringify({
      maximumTargetAcquisitionAttempts,
      mission: state.mission,
      target,
      targetAcquisitionAttemptCount,
      targetAcquisitionAxes,
      targetAcquisitionBrakeFrameCount,
      targetAcquisitionCorrectionPulseCount,
      targetAcquisitionFirstTargetedDot,
      targetAcquisitionInputFrameCount,
      targetAcquisitionObservedFrameCount,
      targetAcquisitionTargetedObservationCount,
      targetHorizontalDistance: targetGeometry.horizontalDistance,
      targetHorizontalDot: targetGeometry.dot,
      vehicle: state.vehicle,
      worldBounds: state.world.bounds,
    })}`);
  }
  return {
    ...state,
    driveMissionTargetAcquisition: {
      arrivalDistrict: routePlan.arrivalDistrict,
      acquisitionAxes: targetAcquisitionAxes,
      approachFace: routePlan.approachFace,
      targetAcquisitionAttemptCount,
      targetAcquisitionBrakeFrameCount,
      targetAcquisitionCorrectionPulseCount,
      targetAcquisitionFirstTargetedDot,
      targetAcquisitionInputFrameCount,
      targetAcquisitionObservedFrameCount,
      targetAcquisitionTargetedObservationCount,
      targetHorizontalDistance: targetGeometry.horizontalDistance,
      targetHorizontalDot: targetGeometry.dot,
      targeted: state.mission.targeted,
    },
  };
}

/** 照準済み放水が実際に開始するまで有界待機し、失敗時は入力・照準境界を診断する。 */
async function waitForTargetedSpray(page, description, maximumFrames = 60) {
  let spraying = null;
  for (let frame = 0; frame < maximumFrames; frame += 1) {
    await waitForFrames(page, 1);
    spraying = await readGameState(page);
    if (spraying.controls.primaryAction && spraying.mission.sprayOnFire && spraying.mission.targeted) {
      return spraying;
    }
  }
  throw new Error(`${description}: targeted spray did not start within ${maximumFrames} frames: ${JSON.stringify({
    camera: spraying?.camera,
    controls: spraying?.controls,
    mission: spraying?.mission,
    vehicle: spraying?.vehicle,
  })}`);
}

/** 旧6unit外の見える炎を前方から消火でき、背後では火勢が減らないことを確認する。 */
async function verifyForgivingSprayTargeting(browser, errors) {
  const target = { hasTouch: false, height: 720, name: 'forgiving-spray', width: 1_280 };
  const { context, page } = await openViewportPage(browser, target, errors);
  const getTargetGeometry = (state) => {
    const [targetX, , targetZ] = state.landmarks.fireSprayTarget;
    const deltaX = targetX - state.mission.nozzleOrigin[0];
    const deltaZ = targetZ - state.mission.nozzleOrigin[2];
    const horizontalDistance = Math.hypot(deltaX, deltaZ);
    const forwardLength = Math.hypot(state.vehicle.forward[0], state.vehicle.forward[2]);
    return {
      dot: (
        (state.vehicle.forward[0] / forwardLength) * (deltaX / horizontalDistance)
        + (state.vehicle.forward[2] / forwardLength) * (deltaZ / horizontalDistance)
      ),
      horizontalDistance,
    };
  };
  try {
    const initial = await readGameState(page);
    const garage = initial.landmarks.garage;
    const targetPosition = initial.landmarks.fireSprayTarget;
    await driveAlongWorldAxis(page, 'negativeZ', (state) => state.vehicle.position[2] <= garage[2] - 3,
      'forgiving spray garage opening');
    await alignWorldCoordinate(page, 2, 0, 'forgiving spray central crossing Z', 0.5);
    await driveAlongWorldAxis(page, 'positiveX', (state) => state.vehicle.position[0] >= targetPosition[0] + 2,
      'forgiving spray east road');
    const staged = await driveToForgivingSprayTarget(page);
    const stagedGeometry = getTargetGeometry(staged);
    const streamEndpoint = staged.mission.waterPath?.end;
    const endpointError = Array.isArray(streamEndpoint)
      ? Math.hypot(
        targetPosition[0] - streamEndpoint[0],
        targetPosition[1] - streamEndpoint[1],
        targetPosition[2] - streamEndpoint[2],
      )
      : Number.NaN;
    const stagedDiagnostics = {
      dot: stagedGeometry.dot,
      direction: staged.mission.direction,
      distance: staged.mission.distance,
      endpointError,
      horizontalDistance: stagedGeometry.horizontalDistance,
      streamEndpoint,
      vehiclePosition: staged.vehicle.position,
    };
    assert(staged.mission.targeted,
      `Forgiving spray did not acquire visible fire: ${JSON.stringify(stagedDiagnostics)}`);
    assert(Number.isFinite(stagedGeometry.horizontalDistance)
      && stagedGeometry.horizontalDistance > 6
      && stagedGeometry.horizontalDistance <= 7,
    `Forgiving spray horizontal distance is outside (6, 7]: ${JSON.stringify(stagedDiagnostics)}`);
    assert(Number.isFinite(stagedGeometry.dot) && stagedGeometry.dot >= 0.5,
      `Forgiving spray horizontal dot is below 0.5: ${JSON.stringify(stagedDiagnostics)}`);
    assert(Number.isFinite(staged.mission.distance),
      `Forgiving spray 3D mission distance is not finite: ${JSON.stringify(stagedDiagnostics)}`);
    assert(Array.isArray(streamEndpoint) && streamEndpoint.every(Number.isFinite),
      `Forgiving spray endpoint is not finite: ${JSON.stringify(stagedDiagnostics)}`);
    assert(Math.abs(endpointError - 0.55) <= 1e-9,
      `Forgiving spray endpoint is not 0.55 unit before the flame: ${JSON.stringify(stagedDiagnostics)}`);

    await page.keyboard.down('Space');
    const spraying = await waitForTargetedSpray(page, 'forgiving spray targeted');
    await page.evaluate(() => window.advanceTime?.(500));
    await waitForFrames(page, 2);
    const partiallyExtinguished = await readGameState(page);
    assert(partiallyExtinguished.runtime.fireIntensity > 0
      && partiallyExtinguished.runtime.fireIntensity < 1,
    `Forgiving spray did not remain partially extinguished: ${
      partiallyExtinguished.runtime.fireIntensity
    }.`);
    assert.equal(partiallyExtinguished.runtime.missionPhase, 'active',
      `Forgiving spray was not active after 500ms: ${
        partiallyExtinguished.runtime.missionPhase
      }.`);
    assert.equal(partiallyExtinguished.runtime.routeVisible, true,
      'Forgiving spray hid the assigned route before completion.');
    let closestStreamToEndpoint = Number.POSITIVE_INFINITY;
    for (let frame = 0; frame < 90; frame += 1) {
      const visualState = await readGameState(page);
      closestStreamToEndpoint = Math.min(
        ...visualState.visuals.waterInstances
          .filter(({ active, kind }) => active && kind === 'stream')
          .map(({ position }) => Math.hypot(
            streamEndpoint[0] - position[0],
            streamEndpoint[1] - position[1],
            streamEndpoint[2] - position[2],
          )),
      );
      if (closestStreamToEndpoint <= 0.7) break;
      await waitForFrames(page, 1);
    }
    assert(closestStreamToEndpoint <= 0.7,
      `Forgiving spray stream did not visibly reach the endpoint: ${
        closestStreamToEndpoint
      }.`);
    await captureVerifiedScreenshot(page, `${outputDirectory}/desktop-forgiving-spray.png`);
    await page.keyboard.up('Space');

    await page.evaluate(() => window.reset_voxel_game_vehicle?.());
    await waitForFrames(page, 2);
    const backwardRouteState = await driveMissionToFire(page);
    const backwardRouteStartGeometry = getTargetGeometry(backwardRouteState);
    const fireBuilding = requireWorldSolid(backwardRouteState, 'fire-building-body');
    assert(backwardRouteState.mission.targeted && backwardRouteStartGeometry.dot >= 0.5,
      `Backward route did not inherit a valid targeted fire arrival: ${JSON.stringify({
        geometry: backwardRouteStartGeometry,
        mission: backwardRouteState.mission,
        vehicle: backwardRouteState.vehicle,
      })}`);
    const backwardHorizontalSupport = Math.hypot(
      VEHICLE_COLLIDER_HALF_EXTENTS[0],
      VEHICLE_COLLIDER_HALF_EXTENTS[2],
    );
    const backwardCoastReserve = 0.5;
    const backwardSafetyInset = backwardHorizontalSupport + backwardCoastReserve;
    const backwardHeadingReserve = 2 * backwardHorizontalSupport + backwardCoastReserve;
    const fireBuildingEastX = fireBuilding.position[0] + fireBuilding.scale[0] / 2;
    /** 車体の保守的support半径を含むworld内側へwaypointを制限する。 */
    const clampToSafeWorld = (value, minimum, maximum) => (
      Math.max(minimum + backwardSafetyInset, Math.min(value, maximum - backwardSafetyInset))
    );
    const backwardWaypoint = {
      x: clampToSafeWorld(
        Math.max(
          targetPosition[0] + backwardHorizontalSupport,
          fireBuildingEastX + backwardHorizontalSupport + backwardCoastReserve,
        ),
        backwardRouteState.world.bounds.minX,
        backwardRouteState.world.bounds.maxX,
      ),
      z: clampToSafeWorld(
        targetPosition[2] + backwardCoastReserve,
        backwardRouteState.world.bounds.minZ,
        backwardRouteState.world.bounds.maxZ,
      ),
    };
    const backwardHeadingWaypointZ = clampToSafeWorld(
      backwardWaypoint.z - backwardHeadingReserve,
      backwardRouteState.world.bounds.minZ,
      backwardRouteState.world.bounds.maxZ,
    );
    assert(backwardWaypoint.x <= backwardRouteState.world.bounds.maxX - backwardSafetyInset,
      `Backward waypoint exceeds the safe world inset: ${JSON.stringify({
        backwardSafetyInset,
        backwardWaypoint,
        worldBounds: backwardRouteState.world.bounds,
      })}`);
    const backwardRouteResetCount = backwardRouteState.vehicle.resetCount;
    const backwardSafetyMaximumX = backwardRouteState.world.bounds.maxX - backwardSafetyInset;
    let backwardMaximumX = Number.NEGATIVE_INFINITY;
    let backwardObservedFrameCount = 0;

    /** 背面routeの各観測frameでreset・support込みbounds・最大Xを同時検査する。 */
    const observeBackwardRouteState = (state, stage) => {
      const colliderSupport = vehicleColliderSupport(state.vehicle);
      const colliderInset = {
        x: colliderSupport.x + backwardCoastReserve,
        z: colliderSupport.z + backwardCoastReserve,
      };
      backwardMaximumX = Math.max(backwardMaximumX, state.vehicle.position[0]);
      backwardObservedFrameCount += 1;
      assert.equal(state.vehicle.resetCount, backwardRouteResetCount,
        `${stage}: backward route reset unexpectedly: ${JSON.stringify(state.vehicle)}`);
      assert(state.vehicle.position[0] >= state.world.bounds.minX + colliderInset.x
        && state.vehicle.position[0] <= state.world.bounds.maxX - colliderInset.x
        && state.vehicle.position[0] < backwardSafetyMaximumX
        && state.vehicle.position[2] >= state.world.bounds.minZ + colliderInset.z
        && state.vehicle.position[2] <= state.world.bounds.maxZ - colliderInset.z,
      `${stage}: backward route left the support-safe world inset: ${JSON.stringify({
        backwardSafetyInset,
        colliderInset,
        colliderSupport,
        position: state.vehicle.position,
        worldBounds: state.world.bounds,
      })}`);
      return state;
    };

    /** 1frameごとの入力・制動後に指定observerを通す。 */
    const pulseBackwardRoute = async (
      axis,
      frameCount,
      description,
      observeState = observeBackwardRouteState,
    ) => {
      const input = WORLD_AXIS_INPUTS[axis];
      assert(input, `${description}: unknown world axis ${axis}.`);
      const heldKeys = new Set();
      let latest = null;
      try {
        await syncKeyboardKeys(page, heldKeys, input.keys);
        for (let frame = 0; frame < frameCount; frame += 1) {
          await waitForFrames(page, 1);
          latest = observeState(await readGameState(page), `${description}: input`);
        }
      } finally {
        await releaseKeyboardKeys(page, heldKeys);
      }
      for (let frame = 0; frame < 150; frame += 1) {
        await waitForFrames(page, 1);
        latest = observeState(await readGameState(page), `${description}: brake`);
        if (latest.vehicle.speed < 0.24) return latest;
      }
      throw new Error(`${description}: vehicle did not stop within 150 frames.`);
    };

    /** 背面route専用pulseでworld X/Zをwaypointへ整列する。 */
    const alignBackwardCoordinate = async (
      coordinateIndex,
      targetValue,
      description,
      tolerance = 0.2,
    ) => {
      assert(coordinateIndex === 0 || coordinateIndex === 2,
        `${description}: only X/Z can be aligned.`);
      const positiveAxis = coordinateIndex === 0 ? 'positiveX' : 'positiveZ';
      const negativeAxis = coordinateIndex === 0 ? 'negativeX' : 'negativeZ';
      let latest = observeBackwardRouteState(await readGameState(page), `${description}: start`);
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const delta = targetValue - latest.vehicle.position[coordinateIndex];
        if (Math.abs(delta) <= tolerance) return latest;
        const frameCount = Math.max(1, Math.min(7, Math.ceil(Math.abs(delta) * 1.5)));
        latest = await pulseBackwardRoute(
          delta > 0 ? positiveAxis : negativeAxis,
          frameCount,
          description,
        );
      }
      throw new Error(`${description}: coordinate did not align: ${JSON.stringify({
        actual: latest.vehicle.position[coordinateIndex],
        colliderSupport: vehicleColliderSupport(latest.vehicle),
        targetValue,
        vehicle: latest.vehicle,
      })}`);
    };

    observeBackwardRouteState(backwardRouteState, 'forgiving spray backward route start');
    // 固定cameraのscreen入力はworld cardinalへ完全一致しないため、Z pulseより先に
    // 東境界から内側へ寄せ、斜めdriftを含めた車体supportの安全余白を確保する。
    await alignBackwardCoordinate(
      0,
      backwardWaypoint.x,
      'forgiving spray backward safety inset X',
      0.5,
    );
    await alignBackwardCoordinate(
      2,
      backwardHeadingWaypointZ,
      'forgiving spray backward heading stage Z',
      0.5,
    );
    await alignBackwardCoordinate(
      0,
      backwardWaypoint.x,
      'forgiving spray backward turn-in X',
      0.5,
    );
    let headingState = observeBackwardRouteState(
      await readGameState(page),
      'forgiving spray backward heading start',
    );
    for (let attempt = 0; attempt < 36; attempt += 1) {
      if (headingState.vehicle.forward[2] >= 0.8) break;
      headingState = await pulseBackwardRoute(
        'positiveZ',
        1,
        'forgiving spray backward heading',
      );
    }
    assert(headingState.vehicle.forward[2] >= 0.8,
      `forgiving spray backward heading did not converge south: ${JSON.stringify({
        forward: headingState.vehicle.forward,
        position: headingState.vehicle.position,
      })}`);
    const minimumCollisionClearance = -0.09;
    const fireBuildingClearanceBeforeZ = collisionClearance(
      headingState.vehicle,
      fireBuilding,
      'x',
      1,
    );
    assert(fireBuildingClearanceBeforeZ >= minimumCollisionClearance,
      `Backward route reached the fire building before final correction: ${JSON.stringify({
        fireBuilding,
        fireBuildingClearanceBeforeZ,
        minimumCollisionClearance,
        vehicle: headingState.vehicle,
      })}`);
    const maximumBackwardFinalApproachPulses = 96;
    const maximumBackwardCorrectionPulses = 32;
    const maximumBackwardCorrectionFrames = 320;
    let backwardFinalApproachPulseCount = 0;
    let backwardFinalOvershootRecoveryPulseCount = 0;
    let backwardCorrectionPulseCount = 0;
    let backwardCorrectionObservedFrameCount = 0;
    let minimumFireBuildingClearance = Number.POSITIVE_INFINITY;

    /** 最終Z区間の全frameで建物clearanceと共通route制約を検査する。 */
    const observeBackwardFinalApproachState = (state, stage, isCorrection = false) => {
      const latest = observeBackwardRouteState(state, stage);
      const clearance = collisionClearance(latest.vehicle, fireBuilding, 'x', 1);
      minimumFireBuildingClearance = Math.min(minimumFireBuildingClearance, clearance);
      if (isCorrection) {
        backwardCorrectionObservedFrameCount += 1;
        assert(backwardCorrectionObservedFrameCount <= maximumBackwardCorrectionFrames,
          `${stage}: backward correction exceeded its frame limit: ${JSON.stringify({
            backwardCorrectionObservedFrameCount,
            maximumBackwardCorrectionFrames,
          })}`);
      }
      assert(clearance >= minimumCollisionClearance,
        `${stage}: backward final approach penetrated the fire building: ${JSON.stringify({
          clearance,
          fireBuilding,
          minimumCollisionClearance,
          vehicle: latest.vehicle,
        })}`);
      return latest;
    };

    /** 建物側へ寄ったときだけboundedな+X pulseで必要clearanceを回復する。 */
    const recoverBackwardFireBuildingClearance = async (initialState) => {
      let latest = initialState;
      while (collisionClearance(latest.vehicle, fireBuilding, 'x', 1) < backwardCoastReserve) {
        assert(backwardCorrectionPulseCount < maximumBackwardCorrectionPulses,
          `Backward fire-building correction did not converge within its pulse limit: ${JSON.stringify({
            backwardCoastReserve,
            backwardCorrectionObservedFrameCount,
            backwardCorrectionPulseCount,
            clearance: collisionClearance(latest.vehicle, fireBuilding, 'x', 1),
            maximumBackwardCorrectionFrames,
            maximumBackwardCorrectionPulses,
            vehicle: latest.vehicle,
          })}`);
        backwardCorrectionPulseCount += 1;
        latest = await pulseBackwardRoute(
          'positiveX',
          1,
          'forgiving spray backward fire-building correction',
          (state, stage) => observeBackwardFinalApproachState(state, stage, true),
        );
      }
      return latest;
    };

    let backwardFinalState = observeBackwardFinalApproachState(
      headingState,
      'forgiving spray backward final approach start',
    );
    while (true) {
      backwardFinalState = await recoverBackwardFireBuildingClearance(backwardFinalState);
      const remainingZ = backwardWaypoint.z - backwardFinalState.vehicle.position[2];
      if (Math.abs(remainingZ) <= 0.2) break;
      assert(backwardFinalApproachPulseCount < maximumBackwardFinalApproachPulses,
        `Backward final Z approach did not converge within its pulse limit: ${JSON.stringify({
          backwardCorrectionObservedFrameCount,
          backwardCorrectionPulseCount,
          backwardFinalApproachPulseCount,
          backwardFinalOvershootRecoveryPulseCount,
          backwardWaypoint,
          clearance: collisionClearance(backwardFinalState.vehicle, fireBuilding, 'x', 1),
          maximumBackwardFinalApproachPulses,
          minimumFireBuildingClearance,
          vehicle: backwardFinalState.vehicle,
        })}`);
      const finalApproachAxis = remainingZ > 0 ? 'positiveZ' : 'negativeZ';
      if (finalApproachAxis === 'negativeZ') backwardFinalOvershootRecoveryPulseCount += 1;
      backwardFinalApproachPulseCount += 1;
      backwardFinalState = await pulseBackwardRoute(
        finalApproachAxis,
        1,
        `forgiving spray backward final ${finalApproachAxis} approach`,
        observeBackwardFinalApproachState,
      );
    }
    let backwardFinalPositionTolerance = 0.2;
    let backwardHeadingRecoveryPulseCount = 0;
    if (backwardFinalState.vehicle.forward[2] < 0.5) {
      const headingRecoveryX = clampToSafeWorld(
        Math.max(
          backwardWaypoint.x,
          fireBuildingEastX + backwardHorizontalSupport + backwardCoastReserve + 0.8,
        ),
        backwardRouteState.world.bounds.minX,
        backwardRouteState.world.bounds.maxX,
      );
      await alignBackwardCoordinate(
        0,
        headingRecoveryX,
        'forgiving spray backward heading recovery clearance X',
        0.5,
      );
      await alignBackwardCoordinate(
        2,
        backwardHeadingWaypointZ,
        'forgiving spray backward heading recovery runway Z',
        0.5,
      );
      await alignBackwardCoordinate(
        0,
        headingRecoveryX,
        'forgiving spray backward heading recovery turn-in X',
        0.5,
      );
      backwardFinalState = observeBackwardFinalApproachState(
        await readGameState(page),
        'forgiving spray backward heading recovery start',
      );
      backwardFinalPositionTolerance = 0.5;
      while (backwardHeadingRecoveryPulseCount < maximumBackwardFinalApproachPulses) {
        const zError = backwardWaypoint.z - backwardFinalState.vehicle.position[2];
        if (Math.abs(zError) <= backwardFinalPositionTolerance
          && backwardFinalState.vehicle.forward[2] >= 0.5) break;
        if (zError < -backwardFinalPositionTolerance) break;
        backwardHeadingRecoveryPulseCount += 1;
        backwardFinalState = await pulseBackwardRoute(
          'positiveZ',
          1,
          'forgiving spray backward heading recovery approach',
          observeBackwardFinalApproachState,
        );
      }
    }
    const finalBackwardZError = Math.abs(
      backwardWaypoint.z - backwardFinalState.vehicle.position[2],
    );
    const finalFireBuildingClearance = collisionClearance(
      backwardFinalState.vehicle,
      fireBuilding,
      'x',
      1,
    );
    assert(finalBackwardZError <= backwardFinalPositionTolerance
      && backwardFinalState.vehicle.forward[2] >= 0.5,
      `Backward final Z approach did not converge: ${JSON.stringify({
        backwardCorrectionObservedFrameCount,
        backwardCorrectionPulseCount,
        backwardFinalApproachPulseCount,
        backwardFinalOvershootRecoveryPulseCount,
        backwardFinalPositionTolerance,
        backwardHeadingRecoveryPulseCount,
        backwardWaypoint,
        finalBackwardZError,
        minimumFireBuildingClearance,
        vehicle: backwardFinalState.vehicle,
      })}`);
    assert(finalFireBuildingClearance >= backwardCoastReserve,
      `Backward final approach ended without the required fire-building clearance: ${JSON.stringify({
        backwardCoastReserve,
        backwardCorrectionObservedFrameCount,
        backwardCorrectionPulseCount,
        finalFireBuildingClearance,
        vehicle: backwardFinalState.vehicle,
      })}`);
    const backwardEntry = observeBackwardRouteState(
      await readGameState(page),
      'forgiving spray backward entry',
    );
    const backwardEntryGeometry = getTargetGeometry(backwardEntry);
    assert.equal(backwardEntry.vehicle.resetCount, initial.vehicle.resetCount + 1,
      `Backward route did not start after exactly one explicit reset: ${JSON.stringify(backwardEntry.vehicle)}`);
    assert(backwardEntry.vehicle.speed <= 0.24
      && backwardEntry.vehicle.position[0] >= backwardEntry.world.bounds.minX + backwardSafetyInset
      && backwardEntry.vehicle.position[0] <= backwardEntry.world.bounds.maxX - backwardSafetyInset
      && backwardEntry.vehicle.position[2] >= backwardEntry.world.bounds.minZ + backwardSafetyInset
      && backwardEntry.vehicle.position[2] <= backwardEntry.world.bounds.maxZ - backwardSafetyInset
      && backwardEntry.vehicle.forward[2] >= 0.5
      && backwardEntryGeometry.horizontalDistance <= 4.3
      && backwardEntryGeometry.dot < 0
      && !backwardEntry.mission.targeted,
    `Backward route entry is not safely staged: ${JSON.stringify({
      forward: backwardEntry.vehicle.forward,
      geometry: backwardEntryGeometry,
      position: backwardEntry.vehicle.position,
      resetCount: backwardEntry.vehicle.resetCount,
      speed: backwardEntry.vehicle.speed,
      worldBounds: backwardEntry.world.bounds,
    })}`);
    assert(backwardMaximumX >= backwardRouteState.vehicle.position[0],
      `Backward maximum X omitted route frames: ${JSON.stringify({
        backwardMaximumX,
        backwardRouteStartX: backwardRouteState.vehicle.position[0],
      })}`);
    assert(backwardMaximumX < backwardSafetyMaximumX,
      `Backward maximum X reached the safety limit: ${JSON.stringify({
        backwardMaximumX,
        backwardObservedFrameCount,
        backwardSafetyMaximumX,
      })}`);
    const behind = backwardEntry;
    const { dot: behindDot, horizontalDistance: behindHorizontalDistance } = getTargetGeometry(behind);
    assert(Number.isFinite(behindDot) && behindHorizontalDistance <= 7 && behindDot < 0,
      `Backward spray was not strictly behind the vehicle: ${JSON.stringify({
        behindDot,
        behindHorizontalDistance,
        nozzleOrigin: behind.mission.nozzleOrigin,
        vehicleForward: behind.vehicle.forward,
      })}`);
    assert.equal(behind.mission.targeted, false,
      `Backward spray retained the fire target: ${JSON.stringify({
        behindDot,
        behindHorizontalDistance,
        direction: behind.mission.direction,
        distance: behind.mission.distance,
        vehiclePosition: behind.vehicle.position,
      })}`);
    const beforeBackwardSpray = behind.runtime.fireIntensity;
    await page.keyboard.down('Space');
    await waitForFrames(page, 2);
    const backwardSprayStarted = await readGameState(page);
    assert.equal(backwardSprayStarted.controls.primaryAction, true,
      'Backward spray control did not become active.');
    assert.equal(backwardSprayStarted.mission.targeted, false,
      'Backward spray reacquired the fire target before the negative interval.');
    assert.equal(backwardSprayStarted.mission.sprayOnFire, false,
      'Backward spray unexpectedly started on fire.');
    await page.evaluate(() => window.advanceTime?.(500));
    await waitForFrames(page, 2);
    const afterBackwardSpray = await readGameState(page);
    assert.equal(afterBackwardSpray.controls.primaryAction, true,
      'Backward spray control did not remain active for 500ms.');
    assert.equal(afterBackwardSpray.mission.targeted, false,
      'Backward spray auto-targeted the fire during the negative interval.');
    assert.equal(afterBackwardSpray.mission.sprayOnFire, false,
      'Backward spray auto-targeted onto fire during the negative interval.');
    await page.keyboard.up('Space');
    assert.equal(afterBackwardSpray.runtime.fireIntensity, beforeBackwardSpray,
      'Backward spray reduced fire intensity.');

    return {
      backwardEntry: {
        forward: backwardEntry.vehicle.forward,
        position: backwardEntry.vehicle.position,
        resetCount: backwardEntry.vehicle.resetCount,
        speed: backwardEntry.vehicle.speed,
      },
      backwardMaximumX,
      backwardObservedFrameCount,
      backwardRouteResetCount,
      backwardRouteStartDot: backwardRouteStartGeometry.dot,
      backwardRouteStartTargeted: backwardRouteState.mission.targeted,
      backwardSafetyMaximumX,
      backwardTargeted: behind.mission.targeted,
      behindDot,
      behindHorizontalDistance,
      backwardWaypoint,
      backwardHeadingWaypointZ,
      backwardHeadingReserve,
      backwardCoastReserve,
      backwardCorrectionObservedFrameCount,
      backwardCorrectionPulseCount,
      backwardFinalApproachPulseCount,
      backwardFinalOvershootRecoveryPulseCount,
      backwardFinalPositionTolerance,
      backwardHeadingRecoveryPulseCount,
      finalBackwardZError,
      finalFireBuildingClearance,
      fireBuildingClearanceBeforeZ,
      minimumFireBuildingClearance,
      driveMissionTargetAcquisition: backwardRouteState.driveMissionTargetAcquisition,
      dot: stagedGeometry.dot,
      endpointError,
      fireIntensityAfterForwardSpray: partiallyExtinguished.runtime.fireIntensity,
      horizontalDistance: stagedGeometry.horizontalDistance,
      missionPhaseAfterForwardSpray: partiallyExtinguished.runtime.missionPhase,
      closestStreamToEndpoint,
      stagedDistance: staged.mission.distance,
      streamEndpoint,
      targeted: spraying.mission.targeted,
    };
  } finally {
    await page.keyboard.up('Space').catch(() => undefined);
    await context.close();
  }
}

/** 火災現場から東幹線と中央交差点を戻り、車庫でassigned再開まで走る。 */
async function driveMissionBackToGarage(page, touchDriver) {
  const initial = await readGameState(page);
  const garage = initial.landmarks.garage;
  const routePlan = createFireRoutePlan(
    initial.mission.jobId,
    initial.landmarks.fireSprayTarget,
  );
  if (routePlan.requiresEastLaneBeforeReturn) {
    await driveAlongWorldAxis(
      page,
      'positiveX',
      (state) => state.vehicle.position[0] >= routePlan.trunkX,
      'garage route north road to east lane',
      touchDriver,
    );
    await alignWorldCoordinate(
      page,
      0,
      routePlan.trunkX,
      'garage route east lane X',
      0.4,
      touchDriver,
    );
  }
  await driveAlongWorldAxis(page, 'positiveZ', (state) => state.vehicle.position[2] >= 0,
    'garage route east road', touchDriver);
  await alignWorldCoordinate(page, 2, 0, 'garage central crossing Z', 0.5, touchDriver);
  await driveAlongWorldAxis(page, 'negativeX', (state) => state.vehicle.position[0] <= garage[0] + 2,
    'garage central west road', touchDriver);
  await alignWorldCoordinate(page, 0, garage[0], 'garage center X', 0.7, touchDriver);
  await alignWorldCoordinate(page, 2, garage[2], 'garage center Z', 0.7, touchDriver);
  let latestState = await readGameState(page);
  for (let correction = 0; correction < 4; correction += 1) {
    if (latestState.runtime.missionPhase === 'assigned') return latestState;
    await alignWorldCoordinate(page, 0, garage[0], 'garage final X', 0.7, touchDriver);
    await alignWorldCoordinate(page, 2, garage[2], 'garage final Z', 0.7, touchDriver);
    latestState = await readGameState(page);
    const garageDistance = Math.hypot(
      latestState.vehicle.position[0] - garage[0],
      latestState.vehicle.position[2] - garage[2],
    );
    assert(garageDistance <= 3.1,
      `Garage final alignment exceeds restart radius: ${garageDistance}.`);
    for (let frame = 0; frame < 20; frame += 1) {
      const state = await readGameState(page);
      latestState = state;
      if (state.runtime.missionPhase === 'assigned') return state;
      await waitForFrames(page, 1);
    }
  }
  for (let frame = 0; frame < 20; frame += 1) {
    const state = await readGameState(page);
    latestState = state;
    if (state.runtime.missionPhase === 'assigned') return state;
    await waitForFrames(page, 1);
  }
  throw new Error(`Garage return did not restart the assigned mission: ${JSON.stringify({
    mission: latestState?.runtime,
    vehicle: latestState?.vehicle,
  })}`);
}

/** A/D/W/S単独でscreen四方向へ並進し、camera方向が固定されることを確認する。 */
async function verifyDirectMovement(browser, errors) {
  const cases = [
    ['KeyA', -1, 0], ['KeyD', 1, 0], ['KeyW', 0, -1], ['KeyS', 0, 1],
  ];
  const results = {};
  for (const [key, expectedX, expectedY] of cases) {
    const target = { hasTouch: false, height: 720, name: `direct-${key}`, width: 1_280 };
    const { context, page } = await openViewportPage(browser, target, errors);
    try {
      await page.evaluate(() => window.reset_voxel_game_vehicle?.());
      await waitForFrames(page, 30);
      const before = await readGameState(page);
      await page.keyboard.down(key);
      await page.waitForTimeout(350);
      await page.keyboard.up(key);
      const after = await readGameState(page);
      const start = projectWorldPoint(before.camera, before.vehicle.position);
      const end = projectWorldPoint(after.camera, after.vehicle.position);
      const screenDelta = [end[0] - start[0], end[1] - start[1]];
      const worldDistance = Math.hypot(
        after.vehicle.position[0] - before.vehicle.position[0],
        after.vehicle.position[2] - before.vehicle.position[2],
      );
      assert(screenDelta[0] * expectedX > 8 || screenDelta[1] * expectedY > 8,
        `${key} did not move in its screen direction: ${JSON.stringify(screenDelta)}`);
      assert(worldDistance > 0.3, `${key} only rotated without translating: ${worldDistance}`);
      const beforeOffset = getCameraOffset(before);
      const afterOffset = getCameraOffset(after);
      assert(Math.max(...beforeOffset.map((value, index) => Math.abs(value - afterOffset[index]))) < 0.001,
        `${key} changed the world-fixed camera direction.`);
      results[key] = { screenDelta, worldDistance };
    } finally {
      await page.keyboard.up(key).catch(() => undefined);
      await context.close();
    }
  }
  return results;
}

/** keyboardまたは実touchで消火、freeRoam、実走帰庫、仕事再開まで完走する。 */
async function verifyCompleteMission(
  browser,
  errors,
  name,
  hasTouch,
  { targetedScreenshot = null, viewport = null } = {},
) {
  const target = {
    hasTouch,
    height: viewport?.height ?? (hasTouch ? 390 : 720),
    name,
    width: viewport?.width ?? (hasTouch ? 844 : 1_280),
  };
  const { context, page } = await openViewportPage(browser, target, errors);
  const touch = hasTouch ? await createTouchDriver(page) : null;
  try {
    const cycles = [];
    for (let cycleIndex = 1; cycleIndex <= 2; cycleIndex += 1) {
      const initial = await readGameState(page);
      assertInitialWorldPhysicsContract(initial);
      assert.equal(initial.mission.jobCycle, cycleIndex,
        `${name}: cycle ${cycleIndex} did not start with the expected job cycle.`);
      const initialResetCount = initial.vehicle.resetCount;
      readPoolIdentity(initial, `${name} cycle ${cycleIndex} initial`);
      const fireJourneyStartedAtMs = Date.now();
      const targeted = await driveMissionToFire(page, touch);
      const fireArrival = buildVerifiedScenarioArrival(
        initial,
        targeted,
        'fire',
        fireJourneyStartedAtMs,
        `${name}: cycle ${cycleIndex} fire journey`,
        targeted.driveMissionTargetAcquisition.arrivalDistrict,
      );
      if (targetedScreenshot && cycleIndex === 1) {
        await captureStableMissionScreenshot(
          page,
          targetedScreenshot,
          `${name}: targeted capture`,
        );
      }
      if (touch) await touch.pressSpray();
      else await page.keyboard.down('Space');
      await waitForTargetedSpray(page, `${name}: cycle ${cycleIndex} targeted spray`);
      if (hasTouch && target.width === 844 && cycleIndex === 1) {
        await captureVerifiedScreenshot(page, `${outputDirectory}/mobile-landscape-water-fire.png`);
      }
      await page.evaluate(() => window.advanceTime?.(2_500));
      await waitForFrames(page, 2);
      if (touch) await touch.releaseSpray();
      else await page.keyboard.up('Space');
      const celebration = await readGameState(page);
      assert.equal(celebration.runtime.fireIntensity, 0,
        `${name}: cycle ${cycleIndex} fire remains after 2500ms.`);
      assert.equal(celebration.visuals.fireVoxelCount, 0,
        `${name}: cycle ${cycleIndex} voxel fire remains after 2500ms.`);
      assert.equal(celebration.runtime.missionPhase, 'celebrating',
        `${name}: cycle ${cycleIndex} celebration did not start.`);
      assert.equal(celebration.visuals.starCubeCount, 30,
        `${name}: cycle ${cycleIndex} celebration stars are incomplete.`);
      if (!hasTouch && cycleIndex === 1) {
        await captureVerifiedScreenshot(page, `${outputDirectory}/desktop-complete.png`);
      }
      await page.evaluate(() => window.advanceTime?.(1_800));
      await waitForFrames(page, 2);
      const freeRoam = await readGameState(page);
      assert.equal(freeRoam.runtime.missionPhase, 'freeRoam',
        `${name}: cycle ${cycleIndex} freeRoam did not start.`);
      const restarted = await driveMissionBackToGarage(page, touch);
      assert.equal(restarted.runtime.missionPhase, 'assigned',
        `${name}: cycle ${cycleIndex} mission did not restart at garage.`);
      assert.equal(restarted.runtime.signals.atGarage, true,
        `${name}: cycle ${cycleIndex} garage signal is not active.`);
      assert.equal(restarted.runtime.fireIntensity, 1,
        `${name}: cycle ${cycleIndex} fire was not restored at garage.`);
      assert.equal(restarted.visuals.fireHazardEnabled, true,
        `${name}: cycle ${cycleIndex} fire hazard was not restored at garage.`);
      assert.equal(restarted.visuals.fireVoxelCount, 18,
        `${name}: cycle ${cycleIndex} voxel fire was not restored.`);
      assert.equal(restarted.vehicle.resetCount, initialResetCount,
        `${name}: cycle ${cycleIndex} mission route used a vehicle reset.`);
      assert(restarted.runtime.routeVisible,
        `${name}: cycle ${cycleIndex} route was not restored at garage.`);
      assert.notEqual(restarted.mission.jobId, initial.mission.jobId,
        `${name}: cycle ${cycleIndex} completed job repeated at garage.`);
      assert.equal(restarted.mission.jobCycle, cycleIndex + 1,
        `${name}: cycle ${cycleIndex} did not advance its job cycle.`);
      cycles.push({
        ...fireArrival,
        celebration: celebration.runtime,
        completedJobId: initial.mission.jobId,
        freeRoam: freeRoam.runtime,
        restartedJobId: restarted.mission.jobId,
        targetedDistance: targeted.mission.distance,
      });
    }
    assert.equal(new Set(cycles.map(({ completedJobId }) => completedJobId)).size, 2,
      `${name}: two completed cycles did not use distinct jobs.`);
    return {
      ...cycles[0],
      cycles,
      input: hasTouch ? 'touch' : 'keyboard',
      restarted: (await readGameState(page)).runtime,
    };
  } finally {
    await page.keyboard.up('Space').catch(() => undefined);
    await touch?.releaseSpray().catch(() => undefined);
    await touch?.releaseStick().catch(() => undefined);
    await touch?.close().catch(() => undefined);
    await context.close();
  }
}

/** 水流開始、連続描画frameの流動、target着弾飛沫を固定32slotと画像で検証する。 */
async function verifyWaterTimeline(browser, errors) {
  const target = { hasTouch: false, height: 720, name: 'water-timeline', width: 1_280 };
  const { context, page } = await openViewportPage(browser, target, errors);
  try {
    const initial = await readGameState(page);
    const identity = readPoolIdentity(initial, 'water initial');
    await page.keyboard.down('Space');
    await waitForFrames(page, 2);
    const untargeted = await readGameState(page);
    assert.equal(untargeted.visuals.waterInstances.filter(({ active, kind }) => active && kind === 'splash').length, 0,
      'Untargeted spray displayed a splash.');
    await page.keyboard.up('Space');
    await waitForFrames(page, 2);

    await driveMissionToFire(page);
    const steadyCalls = (await readGameState(page)).renderer.rendererCalls;
    await page.keyboard.down('Space');
    await waitForTargetedSpray(page, 'water timeline targeted spray');
    let start = null;
    for (let frame = 0; frame < 16; frame += 1) {
      await waitForFrames(page, 1);
      const state = await readGameState(page);
      const activeStreams = state.visuals.waterInstances.filter(({ active, kind }) => active && kind === 'stream');
      const activeSplashes = state.visuals.waterInstances.filter(({ active, kind }) => active && kind === 'splash');
      if (activeStreams.length >= 4 && activeSplashes.length >= 1) {
        start = state;
        break;
      }
    }
    assert(start, 'Targeted water start frame was not observed.');
    writeJsonArtifact('desktop-water-start.json', {
      mission: start.mission,
      renderer: start.renderer,
      waterInstances: start.visuals.waterInstances,
    });
    await captureVerifiedScreenshot(page, `${outputDirectory}/desktop-water-start.png`);

    const directionLength = Math.hypot(...start.mission.direction) || 1;
    const direction = start.mission.direction.map((value) => value / directionLength);
    let previousBySlot = new Map(start.visuals.waterInstances
      .filter(({ active, kind }) => active && kind === 'stream')
      .map((instance) => [instance.slot, instance]));
    const advancingSlotSet = new Set();
    let flow = start;
    let flowObservedFrameCount = 0;
    for (; flowObservedFrameCount < 6 && advancingSlotSet.size < 4; flowObservedFrameCount += 1) {
      await waitForFrames(page, 1);
      flow = await readGameState(page);
      const activeStreams = flow.visuals.waterInstances.filter(({ active, kind }) => (
        active && kind === 'stream'
      ));
      for (const instance of activeStreams) {
        const previous = previousBySlot.get(instance.slot);
        if (!previous) continue;
        const forwardTravel = instance.position.reduce(
          (sum, value, axis) => sum + (value - previous.position[axis]) * direction[axis],
          0,
        );
        if (forwardTravel > 0.01) advancingSlotSet.add(instance.slot);
      }
      previousBySlot = new Map(activeStreams.map((instance) => [instance.slot, instance]));
    }
    const advancingSlots = [...advancingSlotSet].sort((first, second) => first - second);
    assert(advancingSlots.length >= 4,
      `Fewer than four stream slots advanced over six rendered frames: ${JSON.stringify(advancingSlots)}`);
    writeJsonArtifact('desktop-water-flow.json', {
      advancingSlots,
      flowObservedFrameCount,
      mission: flow.mission,
      renderer: flow.renderer,
      waterInstances: flow.visuals.waterInstances,
    });
    await captureVerifiedScreenshot(page, `${outputDirectory}/desktop-water-flow.png`);

    await waitForFrames(page, 2);
    const splash = await readGameState(page);
    const splashCount = splash.visuals.waterInstances.filter(({ active, kind }) => active && kind === 'splash').length;
    assert(splashCount >= 1, 'Targeted spray displayed no splash.');
    assert(splash.renderer.rendererCalls - steadyCalls <= 2,
      `Water VFX added more than two draw calls: ${splash.renderer.rendererCalls - steadyCalls}`);
    assertPoolIdentity(splash, identity, 'water timeline');
    writeJsonArtifact('desktop-water-splash.json', {
      mission: splash.mission,
      renderer: splash.renderer,
      splashCount,
      waterInstances: splash.visuals.waterInstances,
    });
    await captureVerifiedScreenshot(page, `${outputDirectory}/desktop-water-splash.png`);
    return {
      advancingSlots,
      drawCallDelta: splash.renderer.rendererCalls - steadyCalls,
      fixedColorBatchCount: 2,
      flowObservedFrameCount,
      pool: { splash: 8, stream: 24, total: 32 },
      splashCount,
      untargetedSplashCount: 0,
    };
  } finally {
    await page.keyboard.up('Space').catch(() => undefined);
    await context.close();
  }
}

/**
 * 新しい木/建物colliderを横断しない道路waypointから指定blockの正面へ揃え、
 * garage exitの開始・到達telemetryをbreak結果へ残す。
 */
async function driveToBlockApproach(page, block) {
  const garageExitBefore = await readGameState(page);
  const garage = garageExitBefore.landmarks.garage;
  const plaza = garageExitBefore.landmarks.blockPlaza;
  const hubGate = requireWorldSolid(garageExitBefore, 'hub-gate-post');
  const garageExitAfter = await driveAlongWorldAxis(page, 'negativeZ', (state) => (
    state.vehicle.position[2] <= garage[2] - 3
  ),
    `${block.id} garage exit`);
  const garageExit = {
    after: {
      controls: garageExitAfter.controls,
      position: garageExitAfter.vehicle.position,
      resetCount: garageExitAfter.vehicle.resetCount,
    },
    before: {
      controls: garageExitBefore.controls,
      position: garageExitBefore.vehicle.position,
      resetCount: garageExitBefore.vehicle.resetCount,
    },
  };
  const gateBypassZ = hubGate.position[2] - hubGate.scale[2] / 2
    - VEHICLE_COLLIDER_HALF_EXTENTS[2] - 2;
  await alignWorldCoordinate(page, 2, gateBypassZ, `${block.id} hub gate bypass Z`);

  if (block.id === 'plaza-green') {
    const safeNorthZ = Math.min(
      gateBypassZ,
      plaza.position[2] - plaza.scale[2] / 2 - 3,
    );
    // plaza外周まで迂回しつつ、衝突前snapshotに必要な保守半径より少し外側で止める。
    // 旧外周+2unitは対象から6.3unit離れ、35秒の地区到達契約へ不要な余白だった。
    const westStageX = block.position[0] - 3.8;
    await alignWorldCoordinate(page, 2, safeNorthZ, `${block.id} north bypass Z`);
    await driveAlongWorldAxis(page, 'negativeX', (state) => (
      state.vehicle.position[0] <= westStageX
    ), `${block.id} west trunk road`);
    await alignWorldCoordinate(page, 0, westStageX, `${block.id} west stage X`);
    await alignWorldCoordinate(page, 2, block.position[2], `${block.id} west approach Z`);
    const staged = await readGameState(page);
    if (staged.world.currentDistrict !== 'blocks') {
      await driveAlongWorldAxis(page, 'positiveX', (state) => (
        state.world.currentDistrict === 'blocks'
      ), `${block.id} enter blocks district`);
    }
    return { axis: 'positiveX', approach: 'west-via-north-bypass', garageExit };
  }

  const eastStageX = Math.max(
    block.position[0] + 6,
    plaza.position[0] + plaza.scale[0] / 2 + 2,
  );
  await driveAlongWorldAxis(page, 'negativeX', (state) => (
    state.vehicle.position[0] <= eastStageX
  ), `${block.id} central west road`);
  await alignWorldCoordinate(page, 0, eastStageX, `${block.id} east stage X`);
  await alignWorldCoordinate(page, 2, block.position[2], `${block.id} east approach Z`);
  if (block.id === 'plaza-red' || block.id === 'plaza-blue' || block.id === 'plaza-yellow') {
    return { axis: 'negativeX', approach: 'east-via-central-road', garageExit };
  }
  throw new Error(`${block.id}: no collider-safe block approach is defined.`);
}

/** rAF時系列からactivation遷移、物理許容、上昇→下降arc、連続移動、lifetimeを検証する。 */
function analyzeBreakFrameTimeline(observer, block, beforeImpactCounts, blockId) {
  assert.equal(observer.error, undefined, `${blockId}: page observer failed: ${observer.error}`);
  const firstActiveIndex = observer.samples.findIndex(({ activeFragments }) => activeFragments.length === 6);
  assert(firstActiveIndex >= 0, `${blockId}: page observer did not capture six active fragments.`);
  const firstActive = observer.samples[firstActiveIndex];
  const previousFrame = observer.samples[firstActiveIndex - 1] ?? null;
  const firstImpactIndex = observer.samples.findIndex(({ block }) => (
    (block?.vehicleImpactCount ?? beforeImpactCounts[blockId]) > beforeImpactCounts[blockId]
    && (block?.maxImpactSpeed ?? 0) >= 4
  ));
  const activationFrameDelay = firstActiveIndex - firstImpactIndex;
  const firstInsideAabb = fragmentsAreInsideBlock(firstActive.activeFragments, block.position);
  const activationTransitionCaptured = Boolean(
    previousFrame
    && previousFrame.activeFragments.length === 0
    && observer.firstImpactAtMs !== null
    && (firstActive.block?.vehicleImpactCount ?? beforeImpactCounts[blockId]) > beforeImpactCounts[blockId],
  );
  assert(activationTransitionCaptured,
    `${blockId}: observer did not capture a pre-impact 0-to-6 activation transition.`);
  assert(firstImpactIndex >= 0 && activationFrameDelay >= 0 && activationFrameDelay <= 1,
    `${blockId}: six fragments were not activated in the impact frame or its next rAF (${activationFrameDelay} frames).`);
  const captureDelayFromImpactMs = firstActive.capturedAtMs - observer.firstImpactAtMs;
  const observedFrameIntervalMs = previousFrame
    ? firstActive.capturedAtMs - previousFrame.capturedAtMs
    : 1_000 / 60;
  const activationDelayLimitMs = Math.max(
    ACTIVATION_TRANSITION_DELAY_LIMIT_MS,
    observedFrameIntervalMs + 0.5,
  );
  assert(captureDelayFromImpactMs >= 0
    && captureDelayFromImpactMs <= activationDelayLimitMs,
    `${blockId}: first 6-fragment observation was ${captureDelayFromImpactMs}ms after impact; frame-aware limit is ${activationDelayLimitMs}ms.`);
  const maximumFirstObservedOverflow = maximumFragmentAabbOverflow(firstActive.activeFragments, block.position);
  const {
    accepted: firstObservedAxisOverflowAccepted,
    allowedOverflow: allowedFirstObservedOverflow,
  } = evaluateConservativeFirstObservedAxisOverflow({
    delayMilliseconds: captureDelayFromImpactMs,
    maximumOverflow: maximumFirstObservedOverflow,
  });
  assert(firstObservedAxisOverflowAccepted,
    `${blockId}: first-observed fragments exceed the conservative scheduler-bounded AABB axis-overflow envelope (${maximumFirstObservedOverflow} > ${allowedFirstObservedOverflow}).`);

  const { activeSamples, ended, expectedIds } = readContinuousFragmentWindow(
    observer.samples,
    firstActiveIndex,
    blockId,
  );
  assert(activeSamples.length >= 8, `${blockId}: too few consecutive active rAF samples (${activeSamples.length}).`);
  const sample250 = sampleNearestElapsed(activeSamples, 250, 70);
  assert(sample250, `${blockId}: no rAF sample near 250ms after first active observation.`);
  const firstAverageY = averageFragmentY(firstActive.activeFragments);
  const arcSamples = activeSamples
    .filter(({ sinceFirstActiveMs }) => sinceFirstActiveMs >= 20 && sinceFirstActiveMs <= 260)
    .map((sample) => ({ averageY: averageFragmentY(sample.activeFragments), sample }));
  assert(arcSamples.length >= 3, `${blockId}: early arc lacks rAF samples.`);
  const peak = arcSamples.reduce((highest, candidate) => (
    candidate.averageY > highest.averageY ? candidate : highest
  ));
  const descendingSamples = activeSamples
    .filter(({ sinceFirstActiveMs }) => sinceFirstActiveMs >= peak.sample.sinceFirstActiveMs + 80)
    .map((sample) => ({ averageY: averageFragmentY(sample.activeFragments), sample }));
  assert(descendingSamples.length >= 2, `${blockId}: post-apex arc lacks rAF samples.`);
  const descent = descendingSamples.at(-1);
  const peakRiseAboveBlockCenter = peak.averageY - block.position[1];
  assert(peakRiseAboveBlockCenter > BREAK_FRAGMENT_MINIMUM_PEAK_ABOVE_BLOCK_CENTER,
    `${blockId}: average Y peak did not rise above the source block (${peakRiseAboveBlockCenter}).`);
  assert(descent.averageY < peak.averageY - 0.04,
    `${blockId}: average Y did not descend after the apex (${peak.averageY} -> ${descent.averageY}).`);

  const firstPositions = new Map(firstActive.activeFragments.map(({ id, position }) => [id, position]));
  const movedFragmentIds = sample250.activeFragments.filter(({ id, position }) => {
    const origin = firstPositions.get(id);
    return origin && Math.hypot(...position.map((value, axis) => value - origin[axis])) >= 0.25;
  }).map(({ id }) => id);
  assert(movedFragmentIds.length >= 4,
    `${blockId}: fewer than four fragments moved 0.25 unit by the observed 250ms sample.`);
  const continuity = expectedIds.map((id) => {
    const positions = activeSamples
      .filter(({ sinceFirstActiveMs }) => sinceFirstActiveMs <= 350)
      .map((sample) => sample.activeFragments.find((fragment) => fragment.id === id).position);
    const stepDistances = positions.slice(1).map((position, index) => (
      Math.hypot(...position.map((value, axis) => value - positions[index][axis]))
    ));
    return {
      id,
      movingStepCount: stepDistances.filter((distance) => distance > 0.002).length,
      stepCount: stepDistances.length,
      totalObservedDistance: Math.hypot(...positions.at(-1).map((value, axis) => value - positions[0][axis])),
    };
  });
  assert(continuity.every(({ movingStepCount }) => movingStepCount >= 3),
    `${blockId}: a fragment lacks continuous movement: ${JSON.stringify(continuity)}`);

  const maximumActiveChipCount = Math.max(...observer.samples.map(({ activeChips }) => activeChips.length));
  assert.equal(maximumActiveChipCount, 8, `${blockId}: observed chip maximum is not eight.`);
  for (const sample of observer.samples) {
    for (const other of sample.otherBlocks) {
      assert.equal(other.vehicleImpactCount, beforeImpactCounts[other.id],
        `${blockId}: collision changed ${other.id} vehicleImpactCount.`);
    }
  }
  assert((firstActive.block?.maxImpactSpeed ?? 0) >= 4,
    `${blockId}: real vehicle impact speed is below four.`);
  assert.equal(firstActive.block?.intactEnabledCountAtFragmentActivation, 0,
    `${blockId}: intact body/collider remained enabled at fragment activation.`);
  const fragmentRuntimeLifetimeMs = (firstActive.runtimeBlock?.respawnRemainingMs ?? Number.NaN)
    - (ended.runtimeBlock?.respawnRemainingMs ?? Number.NaN);
  assert(Number.isFinite(fragmentRuntimeLifetimeMs)
    && fragmentRuntimeLifetimeMs >= BREAK_FRAGMENT_RUNTIME_LIFETIME_MIN_MS
    && fragmentRuntimeLifetimeMs <= BREAK_FRAGMENT_RUNTIME_LIFETIME_MAX_MS,
    `${blockId}: fragment runtime lifetime is outside the 1.2 second contract (${fragmentRuntimeLifetimeMs}ms).`);
  assert(ended.sinceFirstActiveMs >= 1_000
    && ended.sinceFirstActiveMs <= BREAK_OBSERVER_WALL_TIMEOUT_MS,
    `${blockId}: fragment wall-clock observation ended outside safety bounds (${ended.sinceFirstActiveMs}ms).`);

  return {
    activationTransitionCaptured,
    activationDelayLimitMs,
    activationFrameDelay,
    allowedFirstObservedOverflow,
    captureDelayFromImpactMs,
    continuity,
    firstAverageY,
    firstInsideAabb,
    firstObservedAtMs: observer.firstActiveAtMs,
    fragmentEndedAtMs: ended.sinceFirstActiveMs,
    fragmentRuntimeLifetimeMs,
    maximumFirstObservedOverflow,
    maximumActiveChipCount,
    movedFragmentIds,
    peak: { averageY: peak.averageY, elapsedMs: peak.sample.sinceFirstActiveMs },
    peakRiseAboveBlockCenter,
    postApex: { averageY: descent.averageY, elapsedMs: descent.sample.sinceFirstActiveMs },
    sample250: {
      activeFragments: sample250.activeFragments,
      averageY: averageFragmentY(sample250.activeFragments),
      elapsedMs: sample250.sinceFirstActiveMs,
    },
  };
}

/** 実車衝突のrAF時系列、chip/主破片終了、安全復元まで1色分を検証する。 */
async function verifyBreakTimeline(browser, errors, contractFailures, blockId, colorName) {
  const target = { hasTouch: false, height: 720, name: `break-${colorName}`, width: 1_280 };
  const { context, page } = await openViewportPage(browser, target, errors);
  const heldKeys = new Set();
  try {
    const initial = await readGameState(page);
    const identity = readPoolIdentity(initial, `${blockId} initial`);
    const block = initial.landmarks.breakableBlocks.find(({ id }) => id === blockId);
    assert(block, `${blockId}: landmark is unavailable.`);
    const beforeImpactCounts = Object.fromEntries(initial.breakables.blocks.map(
      ({ id, vehicleImpactCount }) => [id, vehicleImpactCount],
    ));
    const blockJourneyStartedAtMs = Date.now();
    const approach = await driveToBlockApproach(page, block);
    const approachState = await readGameState(page);
    const blockArrival = buildVerifiedScenarioArrival(
      initial,
      approachState,
      'blocks',
      blockJourneyStartedAtMs,
      `${blockId}: blocks journey`,
    );
    for (const telemetry of approachState.breakables.blocks) {
      assert.equal(telemetry.vehicleImpactCount, beforeImpactCounts[telemetry.id],
        `${blockId}: approach touched ${telemetry.id} before observation.`);
    }
    assert.equal(approachState.runtime.blocks.find(({ id }) => id === blockId)?.phase, 'intact',
      `${blockId}: target was not intact when observation started.`);
    const conservativeVehicleRadius = Math.hypot(
      VEHICLE_COLLIDER_HALF_EXTENTS[0],
      VEHICLE_COLLIDER_HALF_EXTENTS[2],
    );
    const conservativeBlockRadius = Math.hypot(0.75, 0.75);
    const approachDistance = Math.hypot(
      approachState.vehicle.position[0] - block.position[0],
      approachState.vehicle.position[2] - block.position[2],
    );
    assert(approachDistance >= conservativeVehicleRadius + conservativeBlockRadius + 0.1,
      `${blockId}: observer started without collider-support clearance: ${approachDistance}.`);
    await startBreakFrameObserver(page, blockId, beforeImpactCounts[blockId]);
    await syncKeyboardKeys(page, heldKeys, WORLD_AXIS_INPUTS[approach.axis].keys);
    let activationObserved = true;
    try {
      await page.waitForFunction(
        () => window.__voxelBreakFrameObserver?.firstActiveAtMs !== null,
        undefined,
        { timeout: 8_000 },
      );
    } catch {
      activationObserved = false;
    }
    await releaseKeyboardKeys(page, heldKeys);
    if (!activationObserved) {
      const observer = await stopAndReadBreakFrameObserver(page);
      const latestCandidate = await readGameState(page);
      const failure = `${blockId}: effective real-vehicle impact did not expose six active fragments.`;
      contractFailures.push(failure);
      writeJsonArtifact(`desktop-break-${colorName}-timeline.json`, {
        approach,
        failure,
        observer,
        state: latestCandidate,
      });
      await captureVerifiedScreenshot(
        page,
        `${outputDirectory}/desktop-break-${colorName}-first-observed.png`,
      );
      await captureVerifiedScreenshot(page, `${outputDirectory}/desktop-break-${colorName}-arc-250ms.png`);
      return {
        ...blockArrival,
        activationObserved: false,
        approach,
        impactSpeed: latestCandidate?.breakables.blocks.find(({ id }) => id === blockId)?.maxImpactSpeed,
      };
    }
    await captureVerifiedScreenshot(page, `${outputDirectory}/desktop-break-${colorName}-first-observed.png`);
    await page.waitForFunction(
      () => window.__voxelBreakFrameObserver?.samples.some(
        ({ sinceFirstActiveMs }) => sinceFirstActiveMs !== null && sinceFirstActiveMs >= 250,
      ),
      undefined,
      { timeout: 2_000 },
    );
    await captureVerifiedScreenshot(page, `${outputDirectory}/desktop-break-${colorName}-arc-250ms.png`);
    await page.waitForFunction(
      () => window.__voxelBreakFrameObserver?.running === false,
      undefined,
      { timeout: BREAK_OBSERVER_WALL_TIMEOUT_MS + 1_000 },
    );
    const observer = await stopAndReadBreakFrameObserver(page);
    writeJsonArtifact(`desktop-break-${colorName}-timeline.json`, { approach, observer });
    const analysis = analyzeBreakFrameTimeline(observer, block, beforeImpactCounts, blockId);
    writeJsonArtifact(`desktop-break-${colorName}-timeline.json`, { analysis, approach, observer });

    await page.evaluate(() => window.reset_voxel_game_vehicle?.());
    await waitForFrames(page, 2);
    const fragmentExpired = await readGameState(page);
    assert.equal(fragmentExpired.breakables.activeFragments.length, 0,
      `${blockId}: main fragments remain after the observed 1.2 second window.`);
    assert.equal(fragmentExpired.breakables.chips.filter(({ active }) => active).length, 0,
      `${blockId}: chips remain active after 350ms.`);
    const restoringBlock = fragmentExpired.runtime.blocks.find(({ id }) => id === blockId);
    await page.evaluate((milliseconds) => window.advanceTime?.(milliseconds),
      Math.max(1, restoringBlock?.respawnRemainingMs ?? 0));
    await waitForFrames(page, 2);
    const restored = await readGameState(page);
    assert.equal(restored.runtime.blocks.find(({ id }) => id === blockId)?.phase, 'intact',
      `${blockId}: block did not restore after five seconds while vehicle was outside radius three.`);
    assertPoolIdentity(restored, identity, `${blockId} restored`);
    return {
      ...blockArrival,
      activationObserved: true,
      analysis,
      approach,
      chipPoolSlotCount: restored.breakables.chipPoolSlotCount,
      impactSpeed: restored.breakables.blocks.find(({ id }) => id === blockId)?.maxImpactSpeed,
      poolSlotCount: restored.breakables.poolSlotCount,
      restored: restored.runtime.blocks.find(({ id }) => id === blockId),
    };
  } finally {
    await stopAndReadBreakFrameObserver(page).catch(() => undefined);
    await releaseKeyboardKeys(page, heldKeys).catch(() => undefined);
    await context.close();
  }
}

/** 車両yawを考慮したcolliderのworld X/Z support半径を返す。 */
function vehicleColliderSupport(vehicle) {
  const [forwardX, , forwardZ] = vehicle.forward;
  return {
    x: Math.abs(forwardZ) * VEHICLE_COLLIDER_HALF_EXTENTS[0]
      + Math.abs(forwardX) * VEHICLE_COLLIDER_HALF_EXTENTS[2],
    z: Math.abs(forwardX) * VEHICLE_COLLIDER_HALF_EXTENTS[0]
      + Math.abs(forwardZ) * VEHICLE_COLLIDER_HALF_EXTENTS[2],
  };
}

const AXIS_INDEX = { x: 0, z: 2 };

/** 指定軸・障害物側から見た車両colliderとvisual AABBの分離距離を返す。 */
function collisionClearance(vehicle, obstacle, axis, direction) {
  const support = vehicleColliderSupport(vehicle);
  const index = AXIS_INDEX[axis];
  const vehicleSupport = support[axis];
  const obstacleHalf = obstacle.scale[index] / 2;
  const signedCenterDistance = direction * (
    vehicle.position[index] - obstacle.position[index]
  );
  return signedCenterDistance - vehicleSupport - obstacleHalf;
}

/** 実camera basisからworld X/Z方向をDOM touch stick座標へ逆投影する。 */
function worldDirectionToTouchStick(camera, worldX, worldZ) {
  const forwardX = camera.lookTarget[0] - camera.position[0];
  const forwardZ = camera.lookTarget[2] - camera.position[2];
  const forwardLength = Math.hypot(forwardX, forwardZ) || 1;
  const normalizedForward = [forwardX / forwardLength, forwardZ / forwardLength];
  const screenRight = [-normalizedForward[1], normalizedForward[0]];
  const worldLength = Math.hypot(worldX, worldZ) || 1;
  const normalizedWorld = [worldX / worldLength, worldZ / worldLength];
  const moveX = normalizedWorld[0] * screenRight[0] + normalizedWorld[1] * screenRight[1];
  const moveY = normalizedWorld[0] * normalizedForward[0] + normalizedWorld[1] * normalizedForward[1];
  return [moveX, -moveY];
}

/** 車庫外の東側安全路から指定solidの+Z側へ車両を配置する。 */
async function prepareWorldObstacleCollision(page, touch, obstacle, targetX = obstacle.position[0]) {
  const initial = await readGameState(page);
  const garage = initial.landmarks.garage;
  await driveAlongWorldAxis(page, 'negativeZ', (state) => state.vehicle.position[2] <= garage[2] - 3,
    `${obstacle.id} collision garage opening`, touch);
  await alignWorldCoordinate(page, 2, 0, `${obstacle.id} collision central crossing Z`, 0.3, touch);
  const current = await readGameState(page);
  if (targetX >= current.vehicle.position[0]) {
    await driveAlongWorldAxis(page, 'positiveX', (state) => state.vehicle.position[0] >= targetX,
      `${obstacle.id} collision east road`, touch);
  } else {
    await driveAlongWorldAxis(page, 'negativeX', (state) => state.vehicle.position[0] <= targetX,
      `${obstacle.id} collision west road`, touch);
  }
  await alignWorldCoordinate(page, 0, targetX, `${obstacle.id} collision target X`, 0.35, touch);
  const approachZ = obstacle.position[2] + obstacle.scale[2] / 2
    + VEHICLE_COLLIDER_HALF_EXTENTS[2] + 2.5;
  await driveAlongWorldAxis(page, 'negativeZ', (state) => state.vehicle.position[2] <= approachZ,
    `${obstacle.id} collision north staging`, touch);
  await alignWorldCoordinate(page, 2, approachZ, `${obstacle.id} collision staging Z`, 0.35, touch);
}

/** world軸と符号を既存cardinal入力名へ変換する。 */
function worldAxisInputName(axis, direction) {
  assert(axis === 'x' || axis === 'z', `Unknown world input axis: ${axis}.`);
  assert(direction === -1 || direction === 1, `Unknown world input direction: ${direction}.`);
  return `${direction < 0 ? 'negative' : 'positive'}${axis.toUpperCase()}`;
}

/**
 * telemetryのgarage wallと対象post AABBから、安全な車庫出口・正面runwayを算出してkeyboardで配置する。
 */
async function prepareTelemetryPostCollision(page, obstacle, approachAxis, approachDirection) {
  const initial = await readGameState(page);
  const garageSideWalls = [
    requireWorldSolid(initial, 'garage-left-wall'),
    requireWorldSolid(initial, 'garage-right-wall'),
  ];
  const hubGate = requireWorldSolid(initial, 'hub-gate-post');
  const garageFrontFaceZ = Math.min(...garageSideWalls.map((wall) => (
    wall.position[2] - wall.scale[2] / 2
  )));
  const safeSupport = Math.max(...VEHICLE_COLLIDER_HALF_EXTENTS);
  const garageClearanceZ = garageFrontFaceZ - safeSupport - 0.75;
  const hubGateBypassZ = hubGate.position[2] - hubGate.scale[2] / 2
    - VEHICLE_COLLIDER_HALF_EXTENTS[2] - 2;
  const garageExitZ = Math.min(garageClearanceZ, hubGateBypassZ);
  await driveAlongWorldAxis(
    page,
    'negativeZ',
    (state) => state.vehicle.position[2] <= garageExitZ,
    `${obstacle.id} telemetry garage exit`,
  );
  await alignWorldCoordinate(
    page,
    2,
    garageExitZ,
    `${obstacle.id} telemetry garage clearance Z`,
    0.35,
  );

  const perpendicularAxis = approachAxis === 'x' ? 'z' : 'x';
  const perpendicularIndex = AXIS_INDEX[perpendicularAxis];
  const approachIndex = AXIS_INDEX[approachAxis];
  const perpendicularTarget = obstacle.position[perpendicularIndex];
  const runwayReserve = 2.5;
  const stagingCoordinate = obstacle.position[approachIndex] - approachDirection * (
    obstacle.scale[approachIndex] / 2 + safeSupport + runwayReserve
  );
  const garageCenterX = garageSideWalls.reduce((sum, wall) => sum + wall.position[0], 0)
    / garageSideWalls.length;
  const transitDirection = perpendicularTarget < garageCenterX ? -1 : 1;
  const transitMinimumApproach = Math.min(garageExitZ, stagingCoordinate);
  const transitMaximumApproach = Math.max(garageExitZ, stagingCoordinate);
  const transitLateralScan = Math.max(Math.abs(perpendicularTarget - garageCenterX), 12);
  const runwaySolids = approachAxis === 'z'
    ? initial.visualLayout.worldSolids.filter((solid) => {
      if (solid.id === obstacle.id) return false;
      const lateralDistance = (solid.position[0] - garageCenterX) * transitDirection;
      if (lateralDistance <= 0 || lateralDistance > transitLateralScan) return false;
      const halfDepth = solid.scale[2] / 2 + safeSupport;
      return solid.position[2] + halfDepth >= transitMinimumApproach
        && solid.position[2] - halfDepth <= transitMaximumApproach;
    })
    : [];
  const sameSideGarageWall = transitDirection < 0
    ? garageSideWalls.reduce((west, wall) => (
      wall.position[0] < west.position[0] ? wall : west
    ))
    : garageSideWalls.reduce((east, wall) => (
      wall.position[0] > east.position[0] ? wall : east
    ));
  const transitReserve = 2;
  const transitObstacles = [...new Map(
    [hubGate, sameSideGarageWall, ...runwaySolids].map((solid) => [solid.id, solid]),
  ).values()];
  const transitClearanceCoordinates = transitObstacles.map((solid) => (
    solid.position[0] + transitDirection * (
      solid.scale[0] / 2 + VEHICLE_COLLIDER_HALF_EXTENTS[0] + transitReserve
    )
  ));
  const transitTarget = approachAxis === 'z'
    ? transitDirection < 0
      ? Math.min(perpendicularTarget, ...transitClearanceCoordinates)
      : Math.max(perpendicularTarget, ...transitClearanceCoordinates)
    : perpendicularTarget;
  await alignWorldCoordinate(
    page,
    perpendicularIndex,
    transitTarget,
    `${obstacle.id} telemetry gate bypass ${perpendicularAxis.toUpperCase()}`,
    0.3,
  );
  await alignWorldCoordinate(
    page,
    approachIndex,
    stagingCoordinate,
    `${obstacle.id} telemetry runway ${approachAxis.toUpperCase()}`,
    0.3,
  );
  await alignWorldCoordinate(
    page,
    perpendicularIndex,
    perpendicularTarget,
    `${obstacle.id} telemetry frontal alignment ${perpendicularAxis.toUpperCase()}`,
    Math.min(0.2, obstacle.scale[perpendicularIndex] / 3),
    null,
  );
  const staged = await readGameState(page);
  return {
    garageExitZ,
    garageClearanceZ,
    garageFrontFaceZ,
    garageSideWallIds: garageSideWalls.map(({ id }) => id),
    hubGateBypassZ,
    hubGateId: hubGate.id,
    obstaclePosition: obstacle.position,
    obstacleScale: obstacle.scale,
    perpendicularTarget,
    runwayReserve,
    source: 'visualLayout.worldSolids position/scale',
    stagedPosition: staged.vehicle.position,
    stagingCoordinate,
    transitClearanceCoordinates,
    transitDirection,
    transitLateralScan,
    transitObstacleIds: transitObstacles.map(({ id }) => id),
    transitReserve,
    transitTarget,
  };
}

/** 任意world軸から実touch/keyboardでsolidへ押し込み、非貫通・resetなし・離脱操作を数値検証する。 */
async function verifyWorldCollisionScenario(browser, errors, {
  approachAxis,
  approachDirection,
  captureScreenshot = true,
  inputMode = 'touch',
  obstacle,
  prepare,
  recoveryDirection,
}) {
  assert(inputMode === 'keyboard' || inputMode === 'touch', `${obstacle.id}: unknown input mode ${inputMode}.`);
  const target = {
    hasTouch: inputMode === 'touch',
    height: 720,
    name: `collision-${obstacle.id}`,
    width: 1_280,
  };
  const { context, page } = await openViewportPage(browser, target, errors);
  const touch = inputMode === 'touch' ? await createTouchDriver(page) : null;
  const heldKeys = new Set();
  try {
    const initial = await readGameState(page);
    assertInitialWorldPhysicsContract(initial);
    const initialResetCount = initial.vehicle.resetCount;
    const preparation = await prepare(page, touch);
    const aligned = await readGameState(page);
    assert.equal(aligned.vehicle.resetCount, initialResetCount, `${obstacle.id}: reset during approach.`);

    const axisIndex = AXIS_INDEX[approachAxis];
    const perpendicularAxis = approachAxis === 'x' ? 'z' : 'x';
    const perpendicularIndex = AXIS_INDEX[perpendicularAxis];
    const approachVector = approachAxis === 'x'
      ? [approachDirection, 0]
      : [0, approachDirection];
    let contactSample = null;
    let latestState = aligned;
    let minimumClearance = Number.POSITIVE_INFINITY;
    let minimumPerpendicularSeparation = Number.POSITIVE_INFINITY;
    let maximumApproachSpeed = 0;
    const contactPositions = [];
    const approachInputName = worldAxisInputName(approachAxis, approachDirection);
    if (touch) await touch.setStick(...worldDirectionToTouchStick(aligned.camera, ...approachVector));
    else await syncKeyboardKeys(page, heldKeys, WORLD_AXIS_INPUTS[approachInputName].keys);
    for (let frame = 0; frame < 600; frame += 1) {
      await waitForFrames(page, 1);
      const state = await readGameState(page);
      const previousState = latestState;
      latestState = state;
      assert.equal(state.vehicle.resetCount, initialResetCount,
        `${obstacle.id}: reset while pressing solid: ${JSON.stringify({
          aligned: aligned.vehicle,
          current: state.vehicle,
          obstacle,
          previous: previousState?.vehicle,
        })}`);
      maximumApproachSpeed = Math.max(maximumApproachSpeed, state.vehicle.speed);
      const support = vehicleColliderSupport(state.vehicle);
      const headingAlongApproach = state.vehicle.forward[axisIndex] * approachDirection;
      const clearance = collisionClearance(
        state.vehicle,
        obstacle,
        approachAxis,
        -approachDirection,
      );
      const perpendicularOverlap = Math.abs(
        state.vehicle.position[perpendicularIndex] - obstacle.position[perpendicularIndex],
      ) <= support[perpendicularAxis] + obstacle.scale[perpendicularIndex] / 2 + 0.05;
      minimumPerpendicularSeparation = Math.min(
        minimumPerpendicularSeparation,
        Math.abs(state.vehicle.position[perpendicularIndex] - obstacle.position[perpendicularIndex])
          - support[perpendicularAxis] - obstacle.scale[perpendicularIndex] / 2,
      );
      if (headingAlongApproach >= MIN_COLLISION_APPROACH_ALIGNMENT) {
        minimumClearance = Math.min(minimumClearance, clearance);
      }
      if (headingAlongApproach >= MIN_COLLISION_APPROACH_ALIGNMENT
        && perpendicularOverlap && clearance <= 0.12) {
        contactSample ??= { clearance, state, support };
        contactPositions.push(state.vehicle.position[axisIndex]);
        if (contactPositions.length >= COLLISION_SETTLING_FRAME_COUNT + COLLISION_HELD_FRAME_COUNT) break;
      }
    }
    assert(contactSample, `${obstacle.id}: actual collider contact was not reached: ${JSON.stringify({
      aligned: aligned.vehicle,
      latest: latestState.vehicle,
      minimumClearance,
      minimumPerpendicularSeparation,
    })}`);
    assert(maximumApproachSpeed >= 4,
      `${obstacle.id}: approach never reached collision speed: ${maximumApproachSpeed}.`);
    assert(
      contactPositions.length >= COLLISION_SETTLING_FRAME_COUNT + COLLISION_HELD_FRAME_COUNT,
      `${obstacle.id}: contact was not held through settling plus 45 evidence frames: ${JSON.stringify({
      aligned: aligned.vehicle,
      contactFrameCount: contactPositions.length,
      latest: latestState.vehicle,
      minimumClearance,
      minimumPerpendicularSeparation,
      obstacle,
      })}`,
    );
    const settledContactPositions = contactPositions.slice(COLLISION_SETTLING_FRAME_COUNT);
    const contactTravel = Math.max(...settledContactPositions) - Math.min(...settledContactPositions);
    assert(minimumClearance >= MIN_COLLISION_SURFACE_CLEARANCE,
      `${obstacle.id}: vehicle collider penetrated visual AABB: ${JSON.stringify({
        contactPosition: contactSample.state.vehicle.position,
        contactSupport: contactSample.support,
        contactTravel,
        latest: latestState.vehicle,
        minimumClearance,
      })}`);
    assert(contactTravel <= MAX_COLLISION_SETTLING_TRAVEL,
      `${obstacle.id}: vehicle traversed solid while held (${contactTravel}).`);
    const heldState = await readGameState(page);
    assert((-approachDirection) * (
      heldState.vehicle.position[axisIndex] - obstacle.position[axisIndex]
    ) > obstacle.scale[axisIndex] / 2,
      `${obstacle.id}: vehicle center crossed the obstacle visual AABB.`);
    assert(heldState.vehicle.position[0] >= heldState.worldBounds.minX
      && heldState.vehicle.position[0] <= heldState.worldBounds.maxX
      && heldState.vehicle.position[2] >= heldState.worldBounds.minZ
      && heldState.vehicle.position[2] <= heldState.worldBounds.maxZ,
    `${obstacle.id}: collision left the vehicle outside world bounds.`);
    if (captureScreenshot) {
      await waitForFrames(page, 2);
      await captureVerifiedScreenshot(page, `${outputDirectory}/desktop-collision-${obstacle.id}.png`);
    }

    await touch?.releaseStick();
    await releaseKeyboardKeys(page, heldKeys);
    await brakeVehicle(page);
    const beforeRecovery = await readGameState(page);
    const recoveryVector = approachAxis === 'x'
      ? [recoveryDirection, 0]
      : [0, recoveryDirection];
    const recoveryInputName = worldAxisInputName(approachAxis, recoveryDirection);
    if (touch) await touch.setStick(...worldDirectionToTouchStick(beforeRecovery.camera, ...recoveryVector));
    else await syncKeyboardKeys(page, heldKeys, WORLD_AXIS_INPUTS[recoveryInputName].keys);
    await waitForFrames(page, 28);
    await touch?.releaseStick();
    await releaseKeyboardKeys(page, heldKeys);
    await brakeVehicle(page);
    const recovered = await readGameState(page);
    const recoveredDistance = recoveryDirection * (
      recovered.vehicle.position[axisIndex] - beforeRecovery.vehicle.position[axisIndex]
    );
    assert(recoveredDistance >= 0.5,
      `${obstacle.id}: vehicle did not respond after collision.`);
    assert.equal(recovered.vehicle.resetCount, initialResetCount, `${obstacle.id}: recovery triggered reset.`);
    return {
      approach: {
        alignedPosition: aligned.vehicle.position,
        ...preparation,
      },
      approachAxis,
      approachDirection,
      contactFrames: contactPositions.length,
      contactClearance: contactSample.clearance,
      contactPosition: contactSample.state.vehicle.position,
      contactTravel,
      finalClearance: collisionClearance(heldState.vehicle, obstacle, approachAxis, -approachDirection),
      input: inputMode,
      maximumApproachSpeed,
      minimumClearance,
      obstacle,
      passedThrough: false,
      recoveredDistance,
      recoveryDirection,
      resetCount: recovered.vehicle.resetCount,
      resetCountAfter: recovered.vehicle.resetCount,
      resetCountBefore: initialResetCount,
    };
  } finally {
    await touch?.releaseStick().catch(() => undefined);
    await releaseKeyboardKeys(page, heldKeys).catch(() => undefined);
    await touch?.close().catch(() => undefined);
    await context.close();
  }
}

/** 同一contextで有効な火が車両を止め、消火後は同じ空間を通過できることを検証する。 */
async function verifyFireHazardLifecycle(browser, errors) {
  const { context, page } = await openViewportPage(
    browser,
    { hasTouch: true, height: 720, name: 'fire-hazard', width: 1_280 },
    errors,
  );
  const touch = await createTouchDriver(page);
  try {
    const initial = await readGameState(page);
    assertInitialWorldPhysicsContract(initial);
    const fireHazard = initial.visualLayout.fireHazard;
    const easternRunupX = fireHazard.position[0] + fireHazard.scale[0] / 2
      + VEHICLE_COLLIDER_HALF_EXTENTS[2] + 2.5;
    await driveMissionToFire(page, touch);
    await driveAlongWorldAxis(page, 'positiveX', (state) => (
      state.vehicle.position[0] >= easternRunupX
    ),
      'fire hazard east heading staging', touch);
    await alignWorldCoordinate(
      page,
      2,
      fireHazard.position[2],
      'fire hazard targeting lane Z',
      0.15,
      touch,
    );
    await alignWorldCoordinate(page, 0, easternRunupX, 'fire hazard head-on X', 0.15, touch);
    const before = await readGameState(page);
    assert.equal(before.visuals.fireHazardEnabled, true);

    await touch.setStick(...worldDirectionToTouchStick(before.camera, -1, 0));
    let minimumClearance = Number.POSITIVE_INFINITY;
    const contactPositions = [];
    for (let frame = 0; frame < 360; frame += 1) {
      await waitForFrames(page, 1);
      const state = await readGameState(page);
      assert.equal(state.vehicle.resetCount, before.vehicle.resetCount);
      const clearance = collisionClearance(state.vehicle, fireHazard, 'x', 1);
      const headingAlongApproach = -state.vehicle.forward[0];
      if (headingAlongApproach >= MIN_COLLISION_APPROACH_ALIGNMENT) {
        minimumClearance = Math.min(minimumClearance, clearance);
      }
      if (headingAlongApproach >= MIN_COLLISION_APPROACH_ALIGNMENT && clearance <= 0.12) {
        contactPositions.push(state.vehicle.position[0]);
        if (contactPositions.length >= 45) break;
      }
    }
    await touch.releaseStick();
    await brakeVehicle(page);
    const blocked = await readGameState(page);
    assert(contactPositions.length >= 45, `Vehicle did not reach and hold the fire hazard: ${JSON.stringify({
      before: before.vehicle,
      blocked: blocked.vehicle,
      contactFrames: contactPositions.length,
      latestClearance: collisionClearance(blocked.vehicle, fireHazard, 'x', 1),
      minimumClearance,
    })}`);
    const contactTravel = Math.max(...contactPositions) - Math.min(...contactPositions);
    assert(minimumClearance >= MIN_COLLISION_SURFACE_CLEARANCE, `Vehicle penetrated the enabled fire hazard: ${JSON.stringify({
      before: before.vehicle,
      blocked: blocked.vehicle,
      contactTravel,
      minimumClearance,
    })}`);
    assert(contactTravel <= MAX_COLLISION_SETTLING_TRAVEL,
      'Vehicle traversed the enabled fire hazard while input was held.');
    assert.equal(blocked.vehicle.resetCount, before.vehicle.resetCount);
    await waitForFrames(page, 2);
    await captureVerifiedScreenshot(page, `${outputDirectory}/desktop-fire-hazard-before.png`);

    await touch.pressSpray();
    await waitForTargetedSpray(page, 'Fire-hazard lifecycle spray');
    await page.evaluate(() => window.advanceTime?.(2_500));
    await waitForFrames(page, 2);
    await touch.releaseSpray();
    const extinguished = await readGameState(page);
    assert.equal(extinguished.runtime.fireIntensity, 0);
    assert.equal(extinguished.visuals.fireHazardEnabled, false);
    assert.equal(extinguished.visuals.fireVoxelCount, 0,
      'Fire-hazard lifecycle: voxel fire remains after extinguishing.');
    await page.locator('.mission-pill[data-phase="celebrating"]').waitFor({ state: 'visible' });
    await waitForFrames(page, 2);

    await touch.setStick(...worldDirectionToTouchStick(extinguished.camera, -1, 0));
    await waitForFrames(page, 1);
    const passInput = await readGameState(page);
    assert(Math.hypot(passInput.controls.moveX, passInput.controls.moveY) >= 0.8,
      `Former fire-hazard pass input was not applied: ${JSON.stringify(passInput.controls)}`);
    await waitForFrames(page, 19);
    await touch.releaseStick();
    await brakeVehicle(page);
    const passed = await readGameState(page);
    const passedDistance = blocked.vehicle.position[0] - passed.vehicle.position[0];
    assert(passedDistance >= 0.5, `Vehicle did not enter the former fire-hazard space: ${JSON.stringify({
      blocked: blocked.vehicle,
      controls: passed.controls,
      passed: passed.vehicle,
      passedDistance,
      renderedFrameDelta: passed.renderer.renderedFrames - passInput.renderer.renderedFrames,
    })}`);
    assert.equal(passed.vehicle.resetCount, before.vehicle.resetCount);
    await waitForFrames(page, 2);
    await captureVerifiedScreenshot(page, `${outputDirectory}/desktop-fire-hazard-after.png`);

    await page.evaluate(() => window.advanceTime?.(1_800));
    await waitForFrames(page, 2);
    const freeRoam = await readGameState(page);
    assert.equal(freeRoam.runtime.missionPhase, 'freeRoam',
      'Fire-hazard lifecycle did not enter freeRoam before garage return.');
    const restarted = await driveMissionBackToGarage(page, touch);
    assert.equal(restarted.runtime.missionPhase, 'assigned',
      'Fire-hazard lifecycle mission did not restart at garage.');
    assert.equal(restarted.runtime.signals.atGarage, true,
      'Fire-hazard lifecycle garage signal is not active.');
    assert.equal(restarted.runtime.fireIntensity, 1,
      'Fire intensity was not fully restored after returning to the garage.');
    assert.equal(restarted.visuals.fireHazardEnabled, true,
      'Fire hazard was not restored after returning to the garage.');
    assert.equal(restarted.visuals.fireVoxelCount, 18,
      'Fire-hazard lifecycle: voxel fire was not restored after returning to the garage.');
    assert.equal(restarted.vehicle.resetCount, before.vehicle.resetCount,
      'Fire-hazard lifecycle garage return used a vehicle reset.');

    await driveMissionToFire(page, touch);
    const restoredFireHazard = restarted.visualLayout.fireHazard;
    const restoredRoutePlan = createFireRoutePlan(
      restarted.mission.jobId,
      restarted.landmarks.fireSprayTarget,
    );
    const restoredApproach = restoredRoutePlan.approachFace === 'north'
      ? {
        axis: 'z',
        centerIndex: 2,
        clearanceDirection: -1,
        heading: (state) => state.vehicle.forward[2],
        input: [0, 1],
        runup: restoredFireHazard.position[2] - restoredFireHazard.scale[2] / 2
          - VEHICLE_COLLIDER_HALF_EXTENTS[2] - 2.5,
      }
      : {
        axis: 'x',
        centerIndex: 0,
        clearanceDirection: 1,
        heading: (state) => -state.vehicle.forward[0],
        input: [-1, 0],
        runup: restoredFireHazard.position[0] + restoredFireHazard.scale[0] / 2
          + VEHICLE_COLLIDER_HALF_EXTENTS[2] + 2.5,
      };
    if (restoredRoutePlan.approachFace === 'north') {
      await driveAlongWorldAxis(page, 'positiveZ', (state) => (
        state.vehicle.position[2] >= restoredApproach.runup
      ), 'restored fire hazard north heading staging', touch);
      await alignWorldCoordinate(
        page,
        0,
        restoredFireHazard.position[0],
        'restored fire hazard targeting lane X',
        0.15,
        touch,
      );
      await alignWorldCoordinate(
        page,
        2,
        restoredApproach.runup,
        'restored fire hazard head-on Z',
        0.15,
        touch,
      );
    } else {
      await driveAlongWorldAxis(page, 'positiveX', (state) => (
        state.vehicle.position[0] >= restoredApproach.runup
      ), 'restored fire hazard east heading staging', touch);
      await alignWorldCoordinate(
        page,
        2,
        restoredFireHazard.position[2],
        'restored fire hazard targeting lane Z',
        0.15,
        touch,
      );
      await alignWorldCoordinate(
        page,
        0,
        restoredApproach.runup,
        'restored fire hazard head-on X',
        0.15,
        touch,
      );
    }
    const reblockStart = await readGameState(page);
    assert.equal(reblockStart.runtime.fireIntensity, 1,
      'Restored fire intensity changed before second collider contact.');
    assert.equal(reblockStart.visuals.fireHazardEnabled, true,
      'Restored fire hazard telemetry changed before second collider contact.');
    assert.equal(reblockStart.vehicle.resetCount, before.vehicle.resetCount,
      'Second fire-hazard approach used a vehicle reset.');

    await touch.setStick(...worldDirectionToTouchStick(
      reblockStart.camera,
      restoredApproach.input[0],
      restoredApproach.input[1],
    ));
    let reblockMinimumClearance = Number.POSITIVE_INFINITY;
    let reblockContactClearance = null;
    const reblockContactPositions = [];
    for (let frame = 0; frame < 360; frame += 1) {
      await waitForFrames(page, 1);
      const state = await readGameState(page);
      assert.equal(state.vehicle.resetCount, before.vehicle.resetCount,
        'Vehicle reset while pressing the restored fire hazard.');
      const clearance = collisionClearance(
        state.vehicle,
        restoredFireHazard,
        restoredApproach.axis,
        restoredApproach.clearanceDirection,
      );
      const headingAlongApproach = restoredApproach.heading(state);
      if (headingAlongApproach >= MIN_COLLISION_APPROACH_ALIGNMENT) {
        reblockMinimumClearance = Math.min(reblockMinimumClearance, clearance);
      }
      if (headingAlongApproach >= MIN_COLLISION_APPROACH_ALIGNMENT && clearance <= 0.12) {
        reblockContactClearance ??= clearance;
        reblockContactPositions.push(state.vehicle.position[restoredApproach.centerIndex]);
        if (reblockContactPositions.length >= 45) break;
      }
    }
    await touch.releaseStick();
    await brakeVehicle(page);
    const reblockedState = await readGameState(page);
    assert(reblockContactPositions.length >= 45,
      'Vehicle did not reach and hold the restored fire hazard for 45 frames.');
    const reblockContactTravel = Math.max(...reblockContactPositions)
      - Math.min(...reblockContactPositions);
    assert(reblockMinimumClearance >= MIN_COLLISION_SURFACE_CLEARANCE,
      `Vehicle penetrated the restored fire hazard: ${JSON.stringify({
        reblockContactTravel,
        reblockMinimumClearance,
        reblockStart: reblockStart.vehicle,
        reblocked: reblockedState.vehicle,
      })}`);
    assert(reblockContactTravel <= MAX_COLLISION_SETTLING_TRAVEL,
      `Vehicle traversed the restored fire hazard while input was held (${reblockContactTravel}).`);
    const reblockCenterClearance = restoredApproach.clearanceDirection * (
      reblockedState.vehicle.position[restoredApproach.centerIndex]
        - restoredFireHazard.position[restoredApproach.centerIndex]
    );
    assert(reblockCenterClearance > 0,
      `Vehicle center crossed the restored fire hazard: ${JSON.stringify({
        centerClearance: reblockCenterClearance,
        position: reblockedState.vehicle.position,
      })}`);
    assert.equal(reblockedState.vehicle.resetCount, before.vehicle.resetCount,
      'Restored fire-hazard contact used a vehicle reset.');
    assert.equal(reblockedState.runtime.fireIntensity, 1,
      'Fire intensity changed during restored fire-hazard contact.');
    assert.equal(reblockedState.visuals.fireHazardEnabled, true,
      'Fire hazard telemetry changed during restored fire-hazard contact.');

    return {
      before: {
        enabled: before.visuals.fireHazardEnabled,
        fireIntensity: before.runtime.fireIntensity,
        position: before.vehicle.position,
        resetCount: before.vehicle.resetCount,
      },
      blocked: {
        contactTravel,
        minimumClearance,
        position: blocked.vehicle.position,
        resetCount: blocked.vehicle.resetCount,
      },
      extinguished: {
        enabled: extinguished.visuals.fireHazardEnabled,
        fireIntensity: extinguished.runtime.fireIntensity,
        position: extinguished.vehicle.position,
        resetCount: extinguished.vehicle.resetCount,
      },
      passed: {
        passedDistance,
        position: passed.vehicle.position,
        resetCount: passed.vehicle.resetCount,
      },
      reblocked: {
        approachFace: restoredRoutePlan.approachFace,
        centerClearance: reblockCenterClearance,
        contactClearance: reblockContactClearance,
        contactFrameCount: reblockContactPositions.length,
        contactTravel: reblockContactTravel,
        enabled: reblockedState.visuals.fireHazardEnabled,
        fireIntensity: reblockedState.runtime.fireIntensity,
        minimumClearance: reblockMinimumClearance,
        position: reblockedState.vehicle.position,
        resetCount: reblockedState.vehicle.resetCount,
        sameContext: true,
      },
      restarted: {
        atGarage: restarted.runtime.signals.atGarage,
        enabled: restarted.visuals.fireHazardEnabled,
        fireIntensity: restarted.runtime.fireIntensity,
        missionPhase: restarted.runtime.missionPhase,
        position: restarted.vehicle.position,
        resetCount: restarted.vehicle.resetCount,
      },
    };
  } finally {
    await touch.releaseSpray().catch(() => undefined);
    await touch.releaseStick().catch(() => undefined);
    await touch.close().catch(() => undefined);
    await context.close();
  }
}

/** desktop実入力で先頭2枚のroute markerを停止・impactなしに横断する。 */
async function verifyRouteMarkerPassThrough(browser, errors) {
  const { context, page } = await openViewportPage(
    browser,
    { hasTouch: false, height: 720, name: 'route-marker', width: 1_280 },
    errors,
  );
  try {
    const initial = await readGameState(page);
    assertInitialWorldPhysicsContract(initial);
    const markers = initial.visualLayout.routeMarkers.slice(0, 2);
    assert.equal(markers.length, 2, 'Route-marker telemetry lacks the first two markers.');
    assert(markers.every(({ position }) => Math.abs(position[0] - initial.landmarks.garage[0]) <= 0.01),
      'The first two route markers are not on the garage exit lane.');
    const before = initial;
    const impactCountsBefore = before.breakables.blocks.map(({ impactCount }) => impactCount);
    const heldKeys = new Set();
    const markerSpeeds = new Map(markers.map(({ position }, index) => [`route-marker-${index}`, {
      position,
      speeds: [],
    }]));
    const routeCorridorSamples = [];
    let maximumConsecutiveStalledFrames = 0;
    let consecutiveStalledFrames = 0;
    let previousCorridorZ = null;
    const minimumMarkerZ = Math.min(...markers.map(({ position }) => position[2]));
    try {
      await syncKeyboardKeys(page, heldKeys, WORLD_AXIS_INPUTS.negativeZ.keys);
      for (let frame = 0; frame < 360; frame += 1) {
        const state = await readGameState(page);
        assert.equal(state.vehicle.resetCount, initial.vehicle.resetCount);
        if (state.vehicle.position[2] <= markers[0].position[2] + 0.6
          && state.vehicle.position[2] >= minimumMarkerZ - 0.6) {
          const progress = previousCorridorZ === null
            ? null
            : previousCorridorZ - state.vehicle.position[2];
          routeCorridorSamples.push({
            positionZ: state.vehicle.position[2],
            progress,
            speed: state.vehicle.speed,
          });
          if (progress !== null && progress <= 0.003) {
            consecutiveStalledFrames += 1;
            maximumConsecutiveStalledFrames = Math.max(
              maximumConsecutiveStalledFrames,
              consecutiveStalledFrames,
            );
          } else {
            consecutiveStalledFrames = 0;
          }
          previousCorridorZ = state.vehicle.position[2];
        }
        for (const marker of markerSpeeds.values()) {
          if (Math.abs(state.vehicle.position[2] - marker.position[2]) <= 0.45) {
            marker.speeds.push(state.vehicle.speed);
          }
        }
        if (state.vehicle.position[2] <= minimumMarkerZ - 1) break;
        await waitForFrames(page, 1);
      }
    } finally {
      await releaseKeyboardKeys(page, heldKeys);
    }
    await brakeVehicle(page);
    const after = await readGameState(page);
    assert.equal(after.vehicle.resetCount, initial.vehicle.resetCount);
    const travel = before.vehicle.position[2] - after.vehicle.position[2];
    assert(travel >= 6, `Route-marker run was too short: ${travel}.`);
    assert(routeCorridorSamples.length >= 2,
      `Route-marker corridor was not sampled: ${JSON.stringify(routeCorridorSamples)}.`);
    assert(maximumConsecutiveStalledFrames <= 3,
      `Route-marker corridor stopped forward progress for ${maximumConsecutiveStalledFrames} frames: ${
        JSON.stringify(routeCorridorSamples)
      }.`);
    for (const [markerId, { speeds }] of markerSpeeds) {
      assert(speeds.length > 0, `Route marker ${markerId} was not crossed.`);
      assert(Math.max(...speeds) >= 2.5, `Route marker ${markerId} caused a sustained stop.`);
    }
    assert.deepEqual(
      after.breakables.blocks.map(({ impactCount }) => impactCount),
      impactCountsBefore,
      'Route-marker crossing emitted a breakable impact event.',
    );
    assert.equal(after.visuals.routeCubeCount, 12);
    await waitForFrames(page, 2);
    await captureVerifiedScreenshot(page, `${outputDirectory}/desktop-route-marker-pass-through.png`);
    return {
      resetCount: after.vehicle.resetCount,
      routeMarkerCount: after.visuals.routeCubeCount,
      maximumConsecutiveStalledFrames,
      minimumCorridorSpeed: Math.min(...routeCorridorSamples.map(({ speed }) => speed)),
      sampledSpeeds: Object.fromEntries(
        [...markerSpeeds].map(([id, marker]) => [id, marker.speeds]),
      ),
      travel,
    };
  } finally {
    await context.close();
  }
}

/** 8代表solid、動的fire hazard、非solid route markerを実車検証する。 */
async function verifyWorldCollisions(browser, errors) {
  const layoutPage = await openViewportPage(
    browser,
    { hasTouch: false, height: 720, name: 'collision-layout', width: 1_280 },
    errors,
  );
  let worldSolids;
  try {
    worldSolids = (await readGameState(layoutPage.page)).visualLayout.worldSolids;
  } finally {
    await layoutPage.context.close();
  }
  const testedScenarios = [
    {
      approachAxis: 'x',
      approachDirection: -1,
      captureScreenshot: false,
      id: 'hub-gate-post',
      inputMode: 'keyboard',
      recoveryDirection: 1,
    },
    {
      approachAxis: 'z',
      approachDirection: 1,
      captureScreenshot: false,
      id: 'south-sign-post-west',
      inputMode: 'keyboard',
      recoveryDirection: -1,
    },
    {
      approachAxis: 'z',
      approachDirection: -1,
      captureScreenshot: false,
      id: 'south-sign-post-east',
      inputMode: 'keyboard',
      recoveryDirection: 1,
    },
    {
      approachAxis: 'z',
      approachDirection: -1,
      id: 'tree-trunk-3',
      recoveryDirection: 1,
    },
    {
      approachAxis: 'z',
      approachDirection: -1,
      id: 'fire-building-body',
      recoveryDirection: 1,
    },
    {
      approachAxis: 'z',
      approachDirection: 1,
      id: 'garage-back-wall',
      prepare: async (page, touch) => {
        const state = await readGameState(page);
        const obstacle = requireWorldSolid(state, 'garage-back-wall');
        await alignWorldCoordinate(
          page,
          0,
          state.landmarks.garage[0],
          'garage back-wall X',
          0.35,
          touch,
        );
        await alignWorldCoordinate(
          page,
          2,
          obstacle.position[2] - obstacle.scale[2] / 2
            - VEHICLE_COLLIDER_HALF_EXTENTS[2] - 2.5,
          'garage back-wall runway Z',
          0.35,
          touch,
        );
      },
      recoveryDirection: -1,
    },
    {
      approachAxis: 'x',
      approachDirection: 1,
      id: 'garage-right-wall',
      prepare: async (page, touch) => {
        const state = await readGameState(page);
        const obstacle = requireWorldSolid(state, 'garage-right-wall');
        await alignWorldCoordinate(
          page,
          2,
          state.landmarks.garage[2],
          'garage right-wall Z',
          0.35,
          touch,
        );
        await alignWorldCoordinate(
          page,
          0,
          obstacle.position[0] - obstacle.scale[0] / 2
            - Math.max(...VEHICLE_COLLIDER_HALF_EXTENTS) - 2.5,
          'garage right-wall runway X',
          0.35,
          touch,
        );
      },
      recoveryDirection: -1,
    },
    {
      approachAxis: 'z',
      approachDirection: -1,
      id: 'playground-plank',
      recoveryDirection: 1,
    },
  ];
  const requiredKeyboardCollisionIds = [
    'hub-gate-post',
    'south-sign-post-west',
    'south-sign-post-east',
  ];
  const testedIds = testedScenarios.map(({ id }) => id);
  assert.deepEqual(
    requiredKeyboardCollisionIds.filter((id) => !testedIds.includes(id)),
    [],
    'Required keyboard collision IDs are absent from real-input testedIds.',
  );
  const fireHazard = await verifyFireHazardLifecycle(browser, errors);
  const routeMarkers = await verifyRouteMarkerPassThrough(browser, errors);
  const scenarios = {};
  for (const scenario of testedScenarios) {
    const { id } = scenario;
    const obstacle = worldSolids.find((candidate) => candidate.id === id);
    assert(obstacle, `${id}: collision obstacle definition is unavailable.`);
    scenarios[id] = await verifyWorldCollisionScenario(browser, errors, {
      ...scenario,
      obstacle,
      prepare: scenario.prepare ?? (
        scenario.inputMode === 'keyboard'
          ? async (page) => prepareTelemetryPostCollision(
            page,
            obstacle,
            scenario.approachAxis,
            scenario.approachDirection,
          )
          : async (page, touch) => prepareWorldObstacleCollision(page, touch, obstacle)
      ),
    });
  }
  for (const id of requiredKeyboardCollisionIds) {
    assert.equal(scenarios[id]?.input, 'keyboard', `${id}: real keyboard collision evidence is missing.`);
  }
  const sharedDefinitionOnlyReasons = {
    'tree-trunk-1': 'tree-trunk-3 covers the same shared trunk collider shape through real input',
    'tree-trunk-2': 'tree-trunk-3 covers the same shared trunk collider shape through real input',
    'playground-support': 'the adjacent playground-plank assembly is covered through real input',
    'garage-left-wall': 'garage-right-wall covers the symmetric side-wall collider and garage-back-wall covers the rear wall',
    'construction-office-body': 'the dedicated production-map E2E covers this solid through real keyboard and touch input',
    'construction-crane-post-west': 'the east crane post shares the same post collider dimensions and production-map contract',
    'construction-crane-post-east': 'the west crane post shares the same post collider dimensions and production-map contract',
    'construction-timber-stack-a': 'the three timber stacks share one collider shape and the dedicated route proves the assembly blocks traversal',
    'construction-timber-stack-b': 'the three timber stacks share one collider shape and the dedicated route proves the assembly blocks traversal',
    'construction-timber-stack-c': 'the three timber stacks share one collider shape and the dedicated route proves the assembly blocks traversal',
    'construction-sign-post': 'the dedicated production-map route proves this signed road edge remains a solid obstacle',
    'town-house-red-body': 'the dedicated production-map E2E covers this solid through real keyboard and touch input',
    'town-house-yellow-body': 'the red house covers the same house collider dimensions through real input',
    'town-house-white-body': 'the red house covers the same house collider dimensions through real input',
    'town-tree-trunk-a': 'tree-trunk-3 covers the same shared trunk collider shape through real input',
    'town-tree-trunk-b': 'tree-trunk-3 covers the same shared trunk collider shape through real input',
    'town-tree-trunk-c': 'tree-trunk-3 covers the same shared trunk collider shape through real input',
    'town-sign-post-west': 'south-sign-post-west covers the same sign-post collider shape through real keyboard input',
    'town-sign-post-east': 'south-sign-post-east covers the same sign-post collider shape through real keyboard input',
    'hub-tool-rack-post': 'hub-gate-post covers the same streetscape post cuboid through real keyboard input',
    'park-bench-seat': 'the dedicated streetscape E2E covers the adjacent picnic-table cuboid through real input',
    'park-lamp-post': 'south-sign-post-west covers the same streetscape post cuboid through real keyboard input',
    'park-picnic-table': 'the dedicated streetscape E2E covers this solid through real keyboard and touch input',
    'fire-hydrant-body': 'hub-gate-post covers the same streetscape post cuboid through real keyboard input',
    'fire-lamp-post': 'south-sign-post-west covers the same streetscape post cuboid through real keyboard input',
    'blocks-fence-post': 'south-sign-post-west covers the same streetscape post cuboid through real keyboard input',
    'south-viewing-bench': 'the dedicated streetscape E2E covers the shared hard street-furniture cuboid layer',
    'construction-barrier-post': 'south-sign-post-west covers the same streetscape post cuboid through real keyboard input',
    'construction-work-lamp-post': 'south-sign-post-west covers the same streetscape post cuboid through real keyboard input',
    'town-west-lamp-post': 'south-sign-post-west covers the same streetscape post cuboid through real keyboard input',
    'town-east-lamp-post': 'south-sign-post-east covers the same streetscape post cuboid through real keyboard input',
    'town-bench-seat': 'the dedicated streetscape E2E covers the shared hard street-furniture cuboid layer',
  };
  const sharedDefinitionOnly = worldSolids
    .filter(({ id }) => !testedIds.includes(id))
    .map(({ id }) => id);
  assert.deepEqual(
    sharedDefinitionOnly,
    Object.keys(sharedDefinitionOnlyReasons),
    'Definition-only collision coverage changed without a recorded reason.',
  );
  return {
    fireHazard,
    routeMarkers,
    scenarios,
    sharedDefinitionOnly,
    sharedDefinitionOnlyReasons,
    testedIds,
    unitContract: 'src/test/worldCollisionLayout.test.ts verifies all 40 production solids share one definition',
  };
}

/** 代表viewportでperformance/layoutと実運転画像を取得する。 */
async function verifyViewport(browser, target, errors) {
  const { context, page } = await openViewportPage(browser, target, errors);
  let touch = null;
  try {
    const initial = await readGameState(page);
    const layout = await measureLayout(page, target);
    const rendererInfo = await readRendererInfo(page);
    const performance = await measurePerformance(page, target);
    const rendererName = rendererInfo.unmaskedRenderer ?? rendererInfo.renderer;
    const policy = evaluatePerformance(performance.fps, target.minimumFps, rendererName);
    if (policy.physicalGpu && !policy.thresholdMet) {
      throw new Error(`${target.name}: physical GPU missed ${target.minimumFps}fps (${performance.fps}).`);
    }

    if (target.hasTouch) {
      touch = await createTouchDriver(page);
      await touch.setStick(0.55, -0.82);
      await waitForFrames(page, 2);
      const diagonalInput = await readGameState(page);
      assert(diagonalInput.controls.moveX > 0.45 && diagonalInput.controls.moveY > 0.45,
        `${target.name}: touch did not move toward screen upper-right.`);
      await touch.releaseStick();
      const cancelled = await readGameState(page);
      assert(cancelled.controls.moveX === 0 && cancelled.controls.moveY === 0,
        `${target.name}: touch release did not center movement.`);
      await brakeVehicle(page);
      const driven = await driveAlongWorldAxis(
        page,
        'negativeZ',
        (state) => state.vehicle.position[2] <= initial.landmarks.garage[2] - 5.5,
        `${target.name} driving garage opening`,
        touch,
      );
      assert.equal(driven.vehicle.resetCount, initial.vehicle.resetCount,
        `${target.name}: driving capture reset the vehicle.`);
      assert.equal(driven.world.currentDistrict, 'hub',
        `${target.name}: driving capture left hub: ${JSON.stringify(driven.world)}`);
      assert(initial.vehicle.position[2] - driven.vehicle.position[2] >= 5,
        `${target.name}: driving capture did not leave the garage: ${JSON.stringify({
          initial: initial.vehicle.position,
          outside: driven.vehicle.position,
        })}`);
      await captureStableMissionScreenshot(
        page,
        `${outputDirectory}/${target.name}-driving.png`,
        `${target.name} driving capture`,
      );
    } else {
      const driven = await driveAlongWorldAxis(
        page,
        'negativeZ',
        (state) => state.vehicle.position[2] <= initial.landmarks.garage[2] - 5.5,
        'desktop driving garage opening',
      );
      assert.equal(driven.vehicle.resetCount, initial.vehicle.resetCount,
        'Desktop driving capture reset the vehicle.');
      assert.equal(driven.world.currentDistrict, 'hub',
        `Desktop driving capture left hub: ${JSON.stringify(driven.world)}`);
      assert(initial.vehicle.position[2] - driven.vehicle.position[2] >= 5,
        `Desktop driving capture did not leave the garage: ${JSON.stringify({
          initial: initial.vehicle.position,
          outside: driven.vehicle.position,
        })}`);
      await captureStableMissionScreenshot(
        page,
        `${outputDirectory}/desktop-driving.png`,
        'desktop driving capture',
      );
      const beforeTurn = await readGameState(page);
      await page.keyboard.down('KeyA');
      await waitForFrames(page, 18);
      await page.keyboard.up('KeyA');
      const afterTurn = await readGameState(page);
      const beforeOffset = getCameraOffset(beforeTurn);
      const afterOffset = getCameraOffset(afterTurn);
      assert(Math.max(...beforeOffset.map((value, index) => Math.abs(value - afterOffset[index]))) < 0.001,
        'Desktop camera world direction changed with vehicle yaw.');
    }

    if (target.name === 'tablet-landscape') {
      await page.evaluate(() => window.reset_voxel_game_vehicle?.());
      await waitForFrames(page, 2);
      const targeted = await driveMissionToFire(page, touch);
      assert(targeted.mission.targeted, `Tablet fire is not targeted: ${JSON.stringify(targeted.mission)}`);
      await touch.pressSpray();
      await waitForTargetedSpray(page, 'Tablet targeted spray');
      await page.evaluate(() => window.advanceTime?.(1_000));
      await page.waitForTimeout(180);
      const water = await readGameState(page);
      assert(water.visuals.waterInstances.filter(({ active, kind }) => active && kind === 'stream').length >= 4,
        `Tablet water stream is incomplete: ${JSON.stringify(water.visuals)}`);
      assert(water.visuals.waterInstances.filter(({ active, kind }) => active && kind === 'splash').length >= 1,
        `Tablet water splash is incomplete: ${JSON.stringify(water.visuals)}`);
      assert.equal(water.visuals.fireLayerCount, 2, 'Tablet fire did not enter the middle stage.');
      assert.equal(water.visuals.fireVoxelCount, 12, 'Tablet middle-stage voxel count is wrong.');
      await captureVerifiedScreenshot(page, `${outputDirectory}/tablet-landscape-water-fire.png`);
      await touch.releaseSpray();
    }

    const resourceUrls = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
    return { initial: initial.runtime, layout, performance, policy, rendererInfo, resourceCount: resourceUrls.length };
  } finally {
    await touch?.releaseSpray().catch(() => undefined);
    await touch?.releaseStick().catch(() => undefined);
    await touch?.close().catch(() => undefined);
    await context.close();
  }
}

/** 時系列成果物を従来の代表8画像名へ対応付け、全必須画像の存在を確認する。 */
function assembleRepresentativeScreenshots() {
  const copies = [
    ['desktop-water-splash.png', 'desktop-water-fire.png'],
    ['desktop-break-red-arc-250ms.png', 'desktop-block-broken.png'],
  ];
  for (const [source, target] of copies) {
    assert(fs.existsSync(`${outputDirectory}/${source}`), `Missing source screenshot: ${source}`);
    copyVerifiedScreenshot(`${outputDirectory}/${source}`, `${outputDirectory}/${target}`);
  }
  for (const screenshot of expectedScreenshots) {
    assert(fs.existsSync(`${outputDirectory}/${screenshot}`), `Missing representative screenshot: ${screenshot}`);
  }
  for (const screenshot of timelineScreenshots) {
    assert(fs.existsSync(`${outputDirectory}/${screenshot}`), `Missing timeline screenshot: ${screenshot}`);
  }
  for (const screenshot of collisionScreenshots) {
    assert(fs.existsSync(`${outputDirectory}/${screenshot}`), `Missing collision screenshot: ${screenshot}`);
  }
  for (const screenshot of productionMapScreenshots) {
    assert(fs.existsSync(`${outputDirectory}/${screenshot}`), `Missing production-map screenshot: ${screenshot}`);
  }
}

/** 新操作・完全mission・時系列VFX・3 viewportを1回のrelease runとして検証する。 */
async function verifyVoxelGame(scenarioProgress) {
  const runScenario = scenarioProgress.run;
  verifyPerformancePolicySelfCheck();
  await runScenario('server-ready', waitForServer);
  if (focusMode === 'production-map') {
    const browser = await chromium.launch({ headless: true });
    const errors = [];
    const contractFailures = [];
    try {
      const productionMap = await runScenario(
        'production-map-layout',
        () => verifyProductionMap(browser, errors),
      );
      const fire = await runScenario('production-map-fire', async () => {
        const result = await verifyCompleteMission(
          browser,
          errors,
          'production-fire',
          false,
          { targetedScreenshot: `${outputDirectory}/desktop-production-fire.png` },
        );
        assert.equal(result.arrival?.world.currentDistrict, 'fire',
          `production-map fire scenario arrived in ${result.arrival?.world.currentDistrict}.`);
        assert((result.journey?.durationSeconds ?? Number.POSITIVE_INFINITY) <= 35,
          `production-map fire scenario exceeded 35 seconds: ${JSON.stringify(result.journey)}.`);
        return result;
      });
      const blocks = await runScenario('production-map-blocks', async () => {
        const result = await verifyBreakTimeline(
          browser,
          errors,
          contractFailures,
          'plaza-green',
          'green',
        );
        assert.equal(result.arrival?.world.currentDistrict, 'blocks',
          `production-map blocks scenario arrived in ${result.arrival?.world.currentDistrict}.`);
        assert((result.journey?.durationSeconds ?? Number.POSITIVE_INFINITY) <= 35,
          `production-map blocks scenario exceeded 35 seconds: ${JSON.stringify(result.journey)}.`);
        copyVerifiedScreenshot(
          `${outputDirectory}/desktop-break-green-first-observed.png`,
          `${outputDirectory}/desktop-production-blocks.png`,
        );
        return result;
      });
      const errorCounts = await runScenario('production-map-report', async () => {
        const counts = {
          console: errors.filter((error) => error.includes(': console:')).length,
          page: errors.filter((error) => error.includes(': pageerror:')).length,
          request: errors.filter((error) => error.includes(': requestfailed:')).length,
        };
        writeJsonArtifact('production-map.json', {
          blocks,
          contractFailures,
          errorCounts: counts,
          errors,
          fire,
          productionMap,
          screenshotProofs,
        });
        for (const screenshot of productionMapScreenshots) {
          assert(fs.existsSync(`${outputDirectory}/${screenshot}`),
            `Missing production-map screenshot: ${screenshot}`);
        }
        assert.equal(errors.length, 0, `Focused production-map browser/request errors: ${errors.join(' | ')}`);
        assert.equal(contractFailures.length, 0,
          `Focused production-map contract failures: ${contractFailures.join(' | ')}`);
        return counts;
      });
      console.log(JSON.stringify({
        artifacts: productionMapScreenshots,
        blocks,
        errorCounts,
        fire,
        productionMap,
      }));
      return;
    } finally {
      await browser.close();
    }
  }
  if (focusMode === 'nonbreak') {
    const browser = await chromium.launch({ headless: true });
    const errors = [];
    const viewports = {};
    try {
      const canonicalRoot = await runScenario(
        'nonbreak-canonical-root',
        () => verifyCanonicalRoot(browser, errors),
      );
      const directMovement = await runScenario(
        'nonbreak-direct-movement',
        () => verifyDirectMovement(browser, errors),
      );
      const forgivingSprayTargeting = await runScenario(
        'nonbreak-forgiving-spray',
        () => verifyForgivingSprayTargeting(browser, errors),
      );
      const missions = {
        desktop: await runScenario(
          'nonbreak-desktop-mission',
          () => verifyCompleteMission(browser, errors, 'desktop-mission', false),
        ),
        tablet: await runScenario(
          'nonbreak-tablet-mission',
          () => verifyCompleteMission(browser, errors, 'tablet-mission', true, {
            viewport: { height: 768, width: 1_024 },
          }),
        ),
        touch: await runScenario(
          'nonbreak-touch-mission',
          () => verifyCompleteMission(browser, errors, 'touch-mission', true),
        ),
      };
      const waterTimeline = await runScenario(
        'nonbreak-water-timeline',
        () => verifyWaterTimeline(browser, errors),
      );
      for (const target of targets) {
        viewports[target.name] = await runScenario(
          `nonbreak-viewport-${target.name}`,
          () => verifyViewport(browser, target, errors),
        );
      }
      await runScenario('nonbreak-report', async () => {
        assert.equal(errors.length, 0, `Focused non-break browser/request errors: ${errors.join(' | ')}`);
        copyVerifiedScreenshot(
          `${outputDirectory}/desktop-water-splash.png`,
          `${outputDirectory}/desktop-water-fire.png`,
        );
        writeJsonArtifact('focused-nonbreak.json', {
          canonicalRoot,
          directMovement,
          errors,
          forgivingSprayTargeting,
          missions,
          screenshotProofs,
          viewports,
          waterTimeline,
        });
      });
      console.log(JSON.stringify({
        canonicalRoot,
        directMovement,
        forgivingSprayTargeting,
        missions,
        viewports,
        waterTimeline,
      }));
      return;
    } finally {
      await browser.close();
    }
  }
  if (focusMode === 'water') {
    const browser = await chromium.launch({ headless: true });
    const errors = [];
    try {
      const waterTimeline = await runScenario(
        'water-timeline',
        () => verifyWaterTimeline(browser, errors),
      );
      await runScenario('water-report', async () => {
        assert.equal(errors.length, 0, `Focused water browser/request errors: ${errors.join(' | ')}`);
        writeJsonArtifact('focused-water.json', { errors, screenshotProofs, waterTimeline });
      });
      console.log(JSON.stringify({ errors, waterTimeline }));
      return;
    } finally {
      await browser.close();
    }
  }
  if (focusMode === 'collision') {
    const browser = await chromium.launch({ headless: true });
    const errors = [];
    try {
      const collisions = await runScenario('collision', async () => {
        const result = await verifyWorldCollisions(browser, errors);
        for (const screenshot of collisionScreenshots) {
          assert(fs.existsSync(`${outputDirectory}/${screenshot}`),
            `Missing focused collision screenshot: ${screenshot}`);
        }
        writeJsonArtifact('focused-collision.json', {
          artifacts: collisionScreenshots,
          collisions: result,
          errors,
          screenshotProofs,
        });
        assert.equal(errors.length, 0, `Focused collision browser/request errors: ${errors.join(' | ')}`);
        return result;
      });
      console.log(JSON.stringify({ artifacts: collisionScreenshots, collisions, errors }));
      return;
    } finally {
      await browser.close();
    }
  }
  const focusedBreak = focusMode?.match(/^break-(red|yellow|blue|green)$/)?.[1];
  if (focusedBreak) {
    const blockId = `plaza-${focusedBreak}`;
    const browser = await chromium.launch({ headless: true });
    const errors = [];
    const contractFailures = [];
    try {
      const result = await runScenario(`break-${focusedBreak}`, async () => {
        const timeline = await verifyBreakTimeline(browser, errors, contractFailures, blockId, focusedBreak);
        writeJsonArtifact(`focused-break-${focusedBreak}.json`, {
          contractFailures,
          errors,
          result: timeline,
          screenshotProofs,
        });
        assert.equal(errors.length, 0, `Focused browser/request errors: ${errors.join(' | ')}`);
        assert.equal(contractFailures.length, 0,
          `Focused break contract failures: ${contractFailures.join(' | ')}`);
        return timeline;
      });
      console.log(JSON.stringify({ blockId, contractFailures, result }));
      return;
    } finally {
      await browser.close();
    }
  }
  const regressions = [await runScenario(
    'full-task7-regression',
    () => runRegressionScript('scripts/verify-voxel-game-task7.mjs'),
  )];
  const task7 = JSON.parse(fs.readFileSync(`${outputDirectory}/task7/results.json`, 'utf8'));

  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const contractFailures = [];
  const viewports = {};
  const breakTimelines = {};
  let canonicalRoot;
  let collisions;
  let directMovement;
  let forgivingSprayTargeting;
  let missions;
  let productionMap;
  let waterTimeline;
  try {
    productionMap = await runScenario(
      'full-production-map',
      () => verifyProductionMap(browser, errors),
    );
    canonicalRoot = await runScenario(
      'full-canonical-root',
      () => verifyCanonicalRoot(browser, errors),
    );
    directMovement = await runScenario(
      'full-direct-movement',
      () => verifyDirectMovement(browser, errors),
    );
    forgivingSprayTargeting = await runScenario(
      'full-forgiving-spray',
      () => verifyForgivingSprayTargeting(browser, errors),
    );
    missions = {
      desktop: await runScenario(
        'full-desktop-mission',
        () => verifyCompleteMission(
          browser,
          errors,
          'desktop-mission',
          false,
          { targetedScreenshot: `${outputDirectory}/desktop-production-fire.png` },
        ),
      ),
      tablet: await runScenario(
        'full-tablet-mission',
        () => verifyCompleteMission(browser, errors, 'tablet-mission', true, {
          viewport: { height: 768, width: 1_024 },
        }),
      ),
      touch: await runScenario(
        'full-touch-mission',
        () => verifyCompleteMission(browser, errors, 'touch-mission', true),
      ),
    };
    waterTimeline = await runScenario(
      'full-water-timeline',
      () => verifyWaterTimeline(browser, errors),
    );
    collisions = await runScenario(
      'full-collisions',
      () => verifyWorldCollisions(browser, errors),
    );
    for (const [blockId, colorName] of [
      ['plaza-red', 'red'],
      ['plaza-yellow', 'yellow'],
      ['plaza-blue', 'blue'],
      ['plaza-green', 'green'],
    ]) {
      breakTimelines[blockId] = await runScenario(
        `full-break-${colorName}`,
        () => verifyBreakTimeline(browser, errors, contractFailures, blockId, colorName),
      );
    }
    copyVerifiedScreenshot(
      `${outputDirectory}/desktop-break-red-first-observed.png`,
      `${outputDirectory}/desktop-production-blocks.png`,
    );
    for (const target of targets) {
      viewports[target.name] = await runScenario(
        `full-viewport-${target.name}`,
        () => verifyViewport(browser, target, errors),
      );
    }
  } finally {
    await browser.close();
  }
  await runScenario('full-report', async () => {
    assert.equal(errors.length, 0, `Voxel Game browser/request errors: ${errors.join(' | ')}`);
    assembleRepresentativeScreenshots();
    const errorCounts = {
      console: errors.filter((error) => error.includes(': console:')).length,
      page: errors.filter((error) => error.includes(': pageerror:')).length,
      request: errors.filter((error) => error.includes(': requestfailed:')).length,
    };

    const environmentConcerns = Object.entries(viewports)
      .filter(([, result]) => !result.policy.certified)
      .map(([name, result]) => (
        `${name}: ${result.policy.rendererClass} renderer; thresholdMet=${result.policy.thresholdMet}; physical-GPU revalidation required`
      ));
    const report = {
      artifacts: [
        ...expectedScreenshots,
        ...timelineScreenshots,
        ...collisionScreenshots,
        ...productionMapScreenshots,
      ],
      breakTimelines,
      canonicalRoot,
      collisions,
      contractFailures,
      directMovement,
      environmentConcerns,
      errorCounts,
      forgivingSprayTargeting,
      missions,
      performancePolicy: {
        certification: 'certified only when rendererClass is physical and measured fps meets the viewport target',
        rendererClasses: ['software', 'physical', 'unknown'],
        targets: Object.fromEntries(targets.map(({ minimumFps, name }) => [name, minimumFps])),
      },
      productionMap,
      regressions,
      screenshotProofs,
      task7,
      viewports,
      waterTimeline,
    };
    fs.writeFileSync(`${outputDirectory}/results.json`, `${JSON.stringify(report, null, 2)}\n`);
    if (environmentConcerns.length > 0) {
      console.warn(`Voxel Game physical-GPU revalidation required: ${environmentConcerns.join(' | ')}`);
    }
    if (contractFailures.length > 0) {
      throw new Error(`Voxel Game release contract failures: ${contractFailures.join(' | ')}`);
    }
    console.log(JSON.stringify({ artifacts: report.artifacts, environmentConcerns, errorCounts, viewports }));
  });
}

/** 意図的失敗でstale artifact消去とfailed manifest更新を自己検証する。 */
async function verifyManifestFailureSelfCheck() {
  const artifactDirectory = `${outputDirectory}-manifest-self-check`;
  resetOutputArtifacts(artifactDirectory);
  fs.writeFileSync(`${artifactDirectory}/stale.png`, 'stale');
  let caught = null;
  try {
    await runWithManifest(artifactDirectory, async (scenarioProgress) => {
      await scenarioProgress.run('manifest-failure-self-check', async () => {
        throw new Error('Intentional Voxel Game verification failure');
      });
    });
  } catch (error) {
    caught = error;
  }
  try {
    assert(caught instanceof Error, 'Intentional manifest failure was not propagated.');
    assert(!fs.existsSync(`${artifactDirectory}/stale.png`), 'Stale artifact survived failed run reset.');
    const manifest = JSON.parse(fs.readFileSync(`${artifactDirectory}/run-manifest.json`, 'utf8'));
    assert.equal(manifest.status, 'failed');
    assert.match(manifest.error, /Intentional Voxel Game verification failure/);
    assert.equal(manifest.lastScenario, 'manifest-failure-self-check');
    assert.equal(manifest.scenarioStatus, 'failed');
    assert(Number.isFinite(manifest.scenarioElapsedSeconds));
  } finally {
    fs.rmSync(artifactDirectory, { force: true, recursive: true });
  }
}

if (process.argv.includes('--self-check')) {
  verifyPerformancePolicySelfCheck();
  console.log('Voxel Game performance policy self-check passed.');
} else if (process.argv.includes('--manifest-failure-self-check')) {
  await verifyManifestFailureSelfCheck();
  console.log('Voxel Game failed-manifest self-check passed.');
} else {
  await runWithManifest(outputDirectory, verifyVoxelGame, {
    full: focusMode === null,
    mode: focusMode ?? 'full',
  });
}

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const execFileAsync = promisify(execFile);
const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:5173';
const outputDirectory = 'output/voxel-game';
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

/** 現在runの状態をmanifestへ同期保存する。 */
function writeRunManifest(artifactDirectory, status, error = null) {
  fs.writeFileSync(
    `${artifactDirectory}/run-manifest.json`,
    `${JSON.stringify({ error, recordedAt: new Date().toISOString(), status }, null, 2)}\n`,
  );
}

/** artifact初期化から成功/失敗manifestまでを必ず一続きで管理する。 */
async function runWithManifest(artifactDirectory, verification) {
  resetOutputArtifacts(artifactDirectory);
  writeRunManifest(artifactDirectory, 'running');
  try {
    await verification();
    writeRunManifest(artifactDirectory, 'completed');
  } catch (error) {
    const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    writeRunManifest(artifactDirectory, 'failed', errorMessage);
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

/** R3F/Rapierを通常clockで指定frame数進める。 */
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

/** 公開text hookから現在の完全snapshotを読む。 */
async function readGameState(page) {
  const rendered = await page.evaluate(() => window.render_game_to_text?.());
  assert(rendered, 'Voxel Game text state is unavailable.');
  const state = JSON.parse(rendered);
  assert(state.renderer && state.vehicle && state.runtime && state.breakables,
    `Final telemetry is incomplete: ${rendered}`);
  return state;
}

/** console/page/request failureを収集し、独立contextでscene/HUD/hookを開く。 */
async function openViewportPage(browser, target, errors) {
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
  await page.goto(`${baseUrl}/voxel-game.html?release=${target.name}-${Date.now()}`, { waitUntil: 'networkidle' });
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
      spray: '.spray-button',
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

/** 入力を離した自然減速を待つ。 */
async function brakeVehicle(page) {
  for (let frame = 0; frame < 150; frame += 1) {
    await waitForFrames(page, 1);
    if ((await readGameState(page)).vehicle.speed < 0.24) return;
  }
  throw new Error('Vehicle did not stop within 150 frames.');
}

/** 左右入力だけで指定世界方向へ向ける。 */
async function turnVehicleToward(page, targetX, targetZ) {
  const length = Math.hypot(targetX, targetZ) || 1;
  const normalizedX = targetX / length;
  const normalizedZ = targetZ / length;
  for (let attempt = 0; attempt < 220; attempt += 1) {
    const state = await readGameState(page);
    const [forwardX, , forwardZ] = state.vehicle.forward;
    if (forwardX * normalizedX + forwardZ * normalizedZ >= 0.9995) return;
    const current = Math.atan2(forwardX, forwardZ);
    const target = Math.atan2(normalizedX, normalizedZ);
    const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    const key = delta >= 0 ? 'KeyD' : 'KeyA';
    await page.keyboard.down(key);
    await waitForFrames(page, 1);
    await page.keyboard.up(key);
    await waitForFrames(page, 1);
  }
  throw new Error(`Vehicle did not turn toward [${targetX}, ${targetZ}].`);
}

/** Wの公開keyboard経路で条件まで走って停止する。 */
async function driveUntil(page, predicate, description, maxBursts = 180) {
  const resetCount = (await readGameState(page)).vehicle.resetCount;
  await page.keyboard.down('KeyW');
  try {
    for (let burst = 0; burst < maxBursts; burst += 1) {
      await waitForFrames(page, 2);
      const state = await readGameState(page);
      if (predicate(state)) return state;
      assert.equal(state.vehicle.resetCount, resetCount, `${description}: vehicle reset unexpectedly.`);
    }
    throw new Error(`${description}: destination was not reached.`);
  } finally {
    await page.keyboard.up('KeyW');
    await brakeVehicle(page);
  }
}

/** 車庫から右回り道路を走り、火災現場の南へ到達する。 */
async function driveRightRouteToFire(page) {
  await driveUntil(page, (state) => state.vehicle.position[2] >= 15.2, 'garage exit');
  await turnVehicleToward(page, 1, 0);
  await driveUntil(page, (state) => state.vehicle.position[0] >= 12, 'east road');
  await turnVehicleToward(page, 0, -1);
  await driveUntil(page, (state) => state.vehicle.position[2] <= -2, 'north road');
  await driveUntil(page, (state) => state.mission.distance <= 7.5, 'spray coarse approach', 120);
  for (let pulse = 0; pulse < 40; pulse += 1) {
    const state = await readGameState(page);
    if (state.mission.distance <= 5.7) return state;
    await page.keyboard.down('KeyW');
    await waitForFrames(page, 3);
    await page.keyboard.up('KeyW');
    await brakeVehicle(page);
  }
  throw new Error('Tablet spray approach did not reach 5.7 units.');
}

/** 代表viewportでperformance/layoutと実運転画像を取得する。 */
async function verifyViewport(browser, target, errors) {
  const { context, page } = await openViewportPage(browser, target, errors);
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
      const joystick = await page.locator('.touch-joystick').boundingBox();
      assert(joystick, `${target.name}: joystick has no box.`);
      const cdp = await context.newCDPSession(page);
      const center = { x: joystick.x + joystick.width / 2, y: joystick.y + joystick.height / 2 };
      const held = { x: center.x + joystick.width * 0.24, y: center.y - joystick.height * 0.38 };
      try {
        await cdp.send('Input.dispatchTouchEvent', {
          touchPoints: [{ id: 17, x: center.x, y: center.y }],
          type: 'touchStart',
        });
        await cdp.send('Input.dispatchTouchEvent', {
          touchPoints: [{ id: 17, x: held.x, y: held.y }],
          type: 'touchMove',
        });
        await waitForFrames(page, 30);
        const driven = await readGameState(page);
        assert(driven.controls.throttle > 0.5 && driven.controls.steer > 0.2,
          `${target.name}: touch did not drive/steer.`);
        await page.screenshot({ path: `${outputDirectory}/${target.name}-driving.png` });
        await cdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchCancel' });
        const cancelled = await readGameState(page);
        assert(cancelled.controls.throttle === 0 && cancelled.controls.steer === 0,
          `${target.name}: pointercancel did not release drive.`);
      } finally {
        await cdp.detach();
      }
    } else {
      await page.keyboard.down('KeyW');
      await page.keyboard.down('KeyA');
      await waitForFrames(page, 30);
      await page.keyboard.up('KeyW');
      await page.keyboard.up('KeyA');
      await page.screenshot({ path: `${outputDirectory}/desktop-driving.png` });
      await brakeVehicle(page);
      const beforeTurn = await readGameState(page);
      await page.keyboard.down('KeyA');
      await waitForFrames(page, 18);
      await page.keyboard.up('KeyA');
      const afterTurn = await readGameState(page);
      const cameraOffset = (state) => state.camera.position.map(
        (value, index) => value - state.camera.lookTarget[index],
      );
      const beforeOffset = cameraOffset(beforeTurn);
      const afterOffset = cameraOffset(afterTurn);
      assert(Math.max(...beforeOffset.map((value, index) => Math.abs(value - afterOffset[index]))) < 0.001,
        'Desktop camera world direction changed with vehicle yaw.');
    }

    if (target.name === 'tablet-landscape') {
      await page.evaluate(() => window.reset_voxel_game_vehicle?.());
      await waitForFrames(page, 2);
      const targeted = await driveRightRouteToFire(page);
      assert(targeted.mission.targeted, `Tablet fire is not targeted: ${JSON.stringify(targeted.mission)}`);
      await page.keyboard.down('Space');
      await waitForFrames(page, 2);
      await page.evaluate(() => window.advanceTime?.(1_000));
      await waitForFrames(page, 2);
      const water = await readGameState(page);
      assert(water.visuals.waterCubeCount === 18 && water.visuals.fireLayerCount === 2,
        `Tablet water/fire visuals are wrong: ${JSON.stringify(water.visuals)}`);
      await page.screenshot({ path: `${outputDirectory}/tablet-landscape-water-fire.png` });
      await page.keyboard.up('Space');
    }

    const resourceUrls = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
    return { initial: initial.runtime, layout, performance, policy, rendererInfo, resourceCount: resourceUrls.length };
  } finally {
    await context.close();
  }
}

/** 子E2E成果物を最終8画像名へ固定する。 */
function assembleRepresentativeScreenshots() {
  const copies = [
    ['fire-medium-water.png', 'desktop-water-fire.png'],
    ['block-broken.png', 'desktop-block-broken.png'],
    ['mission-complete.png', 'desktop-complete.png'],
    ['fire-medium-water-mobile.png', 'mobile-landscape-water-fire.png'],
  ];
  for (const [source, target] of copies) {
    assert(fs.existsSync(`${outputDirectory}/${source}`), `Missing source screenshot: ${source}`);
    fs.copyFileSync(`${outputDirectory}/${source}`, `${outputDirectory}/${target}`);
  }
  for (const screenshot of expectedScreenshots) {
    assert(fs.existsSync(`${outputDirectory}/${screenshot}`), `Missing representative screenshot: ${screenshot}`);
  }
}

/** 全既存chain、3 viewport、性能policy、8画像を1回のrelease runとして検証する。 */
async function verifyVoxelGame() {
  verifyPerformancePolicySelfCheck();
  await waitForServer();
  const regressions = [];
  for (const scriptPath of [
    'scripts/verify-voxel-game-task5.mjs',
    'scripts/verify-voxel-game-task6.mjs',
    'scripts/verify-voxel-game-task7.mjs',
  ]) {
    regressions.push(await runRegressionScript(scriptPath));
  }
  const task5 = JSON.parse(fs.readFileSync(`${outputDirectory}/task5-results.json`, 'utf8'));
  const task6 = JSON.parse(fs.readFileSync(`${outputDirectory}/task6-results.json`, 'utf8'));
  const task7 = JSON.parse(fs.readFileSync(`${outputDirectory}/task7/results.json`, 'utf8'));

  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const viewports = {};
  try {
    for (const target of targets) {
      viewports[target.name] = await verifyViewport(browser, target, errors);
    }
  } finally {
    await browser.close();
  }
  assert.equal(errors.length, 0, `Voxel Game browser/request errors: ${errors.join(' | ')}`);
  assembleRepresentativeScreenshots();

  const environmentConcerns = Object.entries(viewports)
    .filter(([, result]) => !result.policy.certified)
    .map(([name, result]) => (
      `${name}: ${result.policy.rendererClass} renderer; thresholdMet=${result.policy.thresholdMet}; physical-GPU revalidation required`
    ));
  const report = {
    artifacts: expectedScreenshots,
    environmentConcerns,
    performancePolicy: {
      certification: 'certified only when rendererClass is physical and measured fps meets the viewport target',
      rendererClasses: ['software', 'physical', 'unknown'],
      targets: Object.fromEntries(targets.map(({ minimumFps, name }) => [name, minimumFps])),
    },
    regressions,
    task5,
    task6,
    task7,
    viewports,
  };
  fs.writeFileSync(`${outputDirectory}/results.json`, `${JSON.stringify(report, null, 2)}\n`);
  if (environmentConcerns.length > 0) {
    console.warn(`Voxel Game physical-GPU revalidation required: ${environmentConcerns.join(' | ')}`);
  }
  console.log(JSON.stringify({ artifacts: expectedScreenshots, environmentConcerns, viewports }));
}

/** 意図的失敗でstale artifact消去とfailed manifest更新を自己検証する。 */
async function verifyManifestFailureSelfCheck() {
  const artifactDirectory = `${outputDirectory}-manifest-self-check`;
  resetOutputArtifacts(artifactDirectory);
  fs.writeFileSync(`${artifactDirectory}/stale.png`, 'stale');
  let caught = null;
  try {
    await runWithManifest(artifactDirectory, async () => {
      throw new Error('Intentional Voxel Game verification failure');
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
  await runWithManifest(outputDirectory, verifyVoxelGame);
}

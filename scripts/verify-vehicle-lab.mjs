import fs from 'node:fs';
import { chromium } from 'playwright';

const baseUrl = process.env.VEHICLE_LAB_BASE_URL ?? 'http://127.0.0.1:5173';
const outputDirectory = 'output/vehicle-lab';
const cameraEpsilon = 0.08;
const targets = [
  { name: 'desktop', width: 1280, height: 720, minimumFps: 60 },
  { name: 'tablet-landscape', width: 1024, height: 768, minimumFps: 30 },
  { name: 'mobile-landscape', width: 844, height: 390, minimumFps: 30 },
];
const views = ['front', 'left', 'back', 'right'];
const viewLabels = { front: '正面', left: '左', back: '背面', right: '右' };
const cameraPresets = {
  perspective: { position: [6.5, 4.8, 8], zoom: 72 },
  front: { position: [0, 2.4, -10], zoom: 72 },
  left: { position: [-10, 2.4, 0], zoom: 72 },
  back: { position: [0, 2.4, 10], zoom: 72 },
  right: { position: [10, 2.4, 0], zoom: 72 },
};

/** 条件が偽なら検証を即時失敗させる。 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/** 実測fpsがviewportの性能下限を満たすか判定する。 */
function meetsFrameRateTarget(measuredFps, minimumFps) {
  return measuredFps >= minimumFps;
}

/** WebGL renderer名を既知software、明示physical、unknownへ保守的に分類する。 */
function classifyRenderer(rendererName) {
  const normalizedRendererName = typeof rendererName === 'string' ? rendererName.trim() : '';
  if (/swiftshader|llvmpipe|softpipe|lavapipe|swrast|software (?:renderer|rasterizer|adapter)|basic render (?:driver|adapter)/i.test(normalizedRendererName)) {
    return 'software';
  }
  if (
    /\bNVIDIA\b|\bAMD\b|\bRadeon\b/i.test(normalizedRendererName)
    || /\bIntel(?:\(R\))?\b.*(?:Arc|Iris|UHD|HD Graphics|Graphics|GPU)/i.test(normalizedRendererName)
    || /(?:\bApple\b.*(?:Metal|M[1-9]\d*|GPU|Silicon)|Metal.*\bApple\b)/i.test(normalizedRendererName)
    || /\bAdreno\b|\bMali\b|\bPowerVR\b/i.test(normalizedRendererName)
  ) {
    return 'physical';
  }
  return 'unknown';
}

/** fps下限とrenderer分類を性能認証フィールドへ変換する。 */
function evaluatePerformancePolicy(measuredFps, minimumFps, rendererName) {
  const thresholdMet = meetsFrameRateTarget(measuredFps, minimumFps);
  const rendererClass = classifyRenderer(rendererName);
  const physicalGpu = rendererClass === 'physical';
  return {
    certified: thresholdMet && physicalGpu,
    physicalGpu,
    rendererClass,
    thresholdMet,
  };
}

/** fps境界、software分類、物理GPU認証policyの独立性を自己検証する。 */
function verifyPerformancePolicySelfCheck() {
  const cases = [
    { measuredFps: 59.99, minimumFps: 60, expected: false },
    { measuredFps: 60, minimumFps: 60, expected: true },
    { measuredFps: 29.99, minimumFps: 30, expected: false },
    { measuredFps: 30, minimumFps: 30, expected: true },
  ];

  for (const boundaryCase of cases) {
    const actual = meetsFrameRateTarget(boundaryCase.measuredFps, boundaryCase.minimumFps);
    assert(
      actual === boundaryCase.expected,
      `Frame-rate boundary mismatch: ${JSON.stringify({ ...boundaryCase, actual })}`,
    );
  }

  const policyCases = [
    {
      expected: { certified: false, physicalGpu: false, rendererClass: 'software', thresholdMet: true },
      measuredFps: 120,
      minimumFps: 60,
      rendererName: 'ANGLE (SwiftShader Device)',
    },
    {
      expected: { certified: false, physicalGpu: false, rendererClass: 'software', thresholdMet: false },
      measuredFps: 59.99,
      minimumFps: 60,
      rendererName: 'llvmpipe (LLVM 15.0.7)',
    },
    {
      expected: { certified: false, physicalGpu: false, rendererClass: 'software', thresholdMet: true },
      measuredFps: 120,
      minimumFps: 60,
      rendererName: 'Microsoft Basic Render Driver software adapter',
    },
    {
      expected: { certified: false, physicalGpu: false, rendererClass: 'software', thresholdMet: true },
      measuredFps: 120,
      minimumFps: 60,
      rendererName: 'Mesa Software Renderer',
    },
    {
      expected: { certified: false, physicalGpu: false, rendererClass: 'unknown', thresholdMet: true },
      measuredFps: 120,
      minimumFps: 60,
      rendererName: 'WebKit WebGL',
    },
    {
      expected: { certified: false, physicalGpu: false, rendererClass: 'unknown', thresholdMet: true },
      measuredFps: 120,
      minimumFps: 60,
      rendererName: '',
    },
    {
      expected: { certified: false, physicalGpu: false, rendererClass: 'unknown', thresholdMet: true },
      measuredFps: 120,
      minimumFps: 60,
      rendererName: null,
    },
    {
      expected: { certified: false, physicalGpu: false, rendererClass: 'unknown', thresholdMet: true },
      measuredFps: 120,
      minimumFps: 60,
      rendererName: 'ANGLE (Mystery Vulkan Backend)',
    },
    {
      expected: { certified: true, physicalGpu: true, rendererClass: 'physical', thresholdMet: true },
      measuredFps: 60,
      minimumFps: 60,
      rendererName: 'ANGLE (NVIDIA GeForce RTX 4080)',
    },
    {
      expected: { certified: true, physicalGpu: true, rendererClass: 'physical', thresholdMet: true },
      measuredFps: 30,
      minimumFps: 30,
      rendererName: 'AMD Radeon RX 7900 XT',
    },
    {
      expected: { certified: true, physicalGpu: true, rendererClass: 'physical', thresholdMet: true },
      measuredFps: 60,
      minimumFps: 60,
      rendererName: 'ANGLE (Intel(R) Iris Xe Graphics)',
    },
    {
      expected: { certified: true, physicalGpu: true, rendererClass: 'physical', thresholdMet: true },
      measuredFps: 30,
      minimumFps: 30,
      rendererName: 'ANGLE Metal Renderer: Apple M3 Pro',
    },
    {
      expected: { certified: true, physicalGpu: true, rendererClass: 'physical', thresholdMet: true },
      measuredFps: 30,
      minimumFps: 30,
      rendererName: 'Qualcomm Adreno 740',
    },
    {
      expected: { certified: true, physicalGpu: true, rendererClass: 'physical', thresholdMet: true },
      measuredFps: 30,
      minimumFps: 30,
      rendererName: 'ARM Mali-G715',
    },
    {
      expected: { certified: true, physicalGpu: true, rendererClass: 'physical', thresholdMet: true },
      measuredFps: 30,
      minimumFps: 30,
      rendererName: 'PowerVR Rogue GE8320',
    },
    {
      expected: { certified: false, physicalGpu: true, rendererClass: 'physical', thresholdMet: false },
      measuredFps: 59.99,
      minimumFps: 60,
      rendererName: 'ANGLE (NVIDIA GeForce RTX 4080)',
    },
  ];

  for (const policyCase of policyCases) {
    const actual = evaluatePerformancePolicy(
      policyCase.measuredFps,
      policyCase.minimumFps,
      policyCase.rendererName,
    );
    assert(
      JSON.stringify(actual) === JSON.stringify(policyCase.expected),
      `Performance policy mismatch: ${JSON.stringify({ ...policyCase, actual })}`,
    );
  }
}

/** 指定runの既知artifactを完全削除し、空の出力directoryを作る。 */
function resetOutputArtifacts(artifactDirectory) {
  fs.rmSync(artifactDirectory, { force: true, recursive: true });
  fs.mkdirSync(artifactDirectory, { recursive: true });
}

/** 指定runの状態をmanifestへ記録し、途中失敗を前回成功と区別可能にする。 */
function writeRunManifest(artifactDirectory, status, error = null) {
  fs.writeFileSync(
    `${artifactDirectory}/run-manifest.json`,
    JSON.stringify({ error, recordedAt: new Date().toISOString(), status }, null, 2),
  );
}

/** Vite開発サーバーが応答するまで最大30秒待つ。 */
async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/vehicle-lab.html`);
      if (response.ok) {
        return;
      }
    } catch {
      // 次の短いポーリングで再試行する。
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vehicle Lab server did not become ready: ${baseUrl}`);
}

/** R3Fへ操作結果が反映されるまで2フレーム待つ。 */
async function waitForTwoFrames(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

/** Vehicle Labが公開した実測値を取得する。 */
async function readTelemetry(page) {
  return JSON.parse(await page.evaluate(() => window.render_vehicle_lab_to_text()));
}

/** 2秒間のR3F描画フレーム増分からCPU側実効fpsを計算する。 */
async function measureRenderFps(page) {
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => ({
    capturedAt: performance.now(),
    renderedFrames: JSON.parse(window.render_vehicle_lab_to_text()).renderedFrames,
  }));
  await page.waitForTimeout(2_000);
  const after = await page.evaluate(() => ({
    capturedAt: performance.now(),
    renderedFrames: JSON.parse(window.render_vehicle_lab_to_text()).renderedFrames,
  }));
  const elapsedSeconds = (after.capturedAt - before.capturedAt) / 1_000;
  const frameDelta = after.renderedFrames - before.renderedFrames;
  return {
    after,
    before,
    elapsedMilliseconds: after.capturedAt - before.capturedAt,
    fps: frameDelta / elapsedSeconds,
    frameDelta,
    source: 'CPU-side requestAnimationFrame/renderedFrames delta',
  };
}

/** 指定したカメラ値がbookmarkの許容誤差内にあることを確認する。 */
function assertCameraPreset(telemetry, view) {
  const preset = cameraPresets[view];
  const positionMatches = telemetry.cameraPosition.every(
    (value, index) => Math.abs(value - preset.position[index]) <= cameraEpsilon,
  );
  assert(positionMatches, `${view} camera position did not reset: ${JSON.stringify(telemetry)}`);
  assert(
    Math.abs(telemetry.cameraZoom - preset.zoom) <= cameraEpsilon,
    `${view} camera zoom did not reset: ${JSON.stringify(telemetry)}`,
  );
}

/** steady renderer callsが車両7 batchと展示台・床2 drawの合計か検証する。 */
function assertStableRendererCalls(telemetry) {
  const expectedRendererCalls = telemetry.vehicleDrawCalls + 2;
  assert(
    telemetry.rendererCalls === expectedRendererCalls,
    `Renderer calls do not match vehicle + showroom draws: ${JSON.stringify({ expectedRendererCalls, telemetry })}`,
  );
  return expectedRendererCalls;
}

/** 自動回転を止め、指定viewの決定的camera bookmarkを再適用する。 */
async function setView(page, view) {
  await page.evaluate((nextView) => window.set_vehicle_lab_view(nextView), view);
  await page.waitForFunction(
    (expectedView) => JSON.parse(window.render_vehicle_lab_to_text()).view === expectedView,
    view,
  );
  await waitForTwoFrames(page);
  const telemetry = await readTelemetry(page);
  assertCameraPreset(telemetry, view);
  return telemetry;
}

/** カメラ位置またはzoomが操作前から変化するまで待つ。 */
async function waitForCameraChange(page, before, property) {
  await page.waitForFunction(
    ({ previous, targetProperty }) => {
      const current = JSON.parse(window.render_vehicle_lab_to_text());
      if (targetProperty === 'cameraZoom') {
        return Math.abs(current.cameraZoom - previous.cameraZoom) > 0.01;
      }
      return current.cameraPosition.some(
        (value, index) => Math.abs(value - previous.cameraPosition[index]) > 0.01,
      );
    },
    { previous: before, targetProperty: property },
  );
  await waitForTwoFrames(page);
  return readTelemetry(page);
}

/** Canvas中心と実寸を返す。 */
async function readCanvasGeometry(page) {
  const box = await page.locator('canvas').boundingBox();
  if (!box) {
    throw new Error('Vehicle Lab canvas has no bounding box');
  }
  return {
    box,
    centerX: box.x + box.width / 2,
    centerY: box.y + box.height / 2,
  };
}

/** 2つのcamera position間の最大軸差分を返す。 */
function calculateMaximumPositionDelta(first, second) {
  return Math.max(...first.map((value, index) => Math.abs(value - second[index])));
}

/** zoom操作後のperspective cameraが時間経過しても静止することを検証する。 */
async function verifyPerspectiveCameraStability(page, afterZoom, inputType) {
  await page.waitForTimeout(600);
  const afterWait = await readTelemetry(page);
  const maximumPositionDelta = calculateMaximumPositionDelta(
    afterZoom.cameraPosition,
    afterWait.cameraPosition,
  );
  assert(afterZoom.view === 'perspective', `${inputType} zoom changed the initial perspective view`);
  assert(afterWait.view === 'perspective', `${inputType} zoom wait changed the perspective view`);
  assert(
    maximumPositionDelta <= 0.02,
    `${inputType} zoom did not stop auto-rotate: ${JSON.stringify({ afterWait, afterZoom, maximumPositionDelta })}`,
  );
  return { afterWait, afterZoom, maximumPositionDelta };
}

/** CDPで2本指を広げ、OrbitControlsのpinch zoomを発生させる。 */
async function dispatchPinchZoom(client, centerX, centerY) {
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: centerX - 30, y: centerY },
      { x: centerX + 30, y: centerY },
    ],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: centerX - 75, y: centerY },
      { x: centerX + 75, y: centerY },
    ],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** fixed view、aria状態、telemetry viewが一致することを確認する。 */
async function assertFixedViewState(page, view) {
  const telemetry = await readTelemetry(page);
  const pressed = await page.getByRole('button', { name: viewLabels[view], exact: true }).getAttribute('aria-pressed');
  assert(telemetry.view === view, `Telemetry view changed after zoom: ${JSON.stringify(telemetry)}`);
  assert(pressed === 'true', `${view} button lost aria-pressed after zoom: ${pressed}`);
  return { pressed, telemetry };
}

/** デスクトップの固定view維持、同一preset再適用、drag自由視点を実測する。 */
async function verifyMouseControls(page) {
  const { box, centerX, centerY } = await readCanvasGeometry(page);

  const beforePerspectiveZoom = await readTelemetry(page);
  assert(beforePerspectiveZoom.view === 'perspective', 'Mouse scenario did not start in perspective');
  await page.mouse.move(centerX, centerY);
  await page.mouse.wheel(0, -500);
  const afterPerspectiveZoom = await waitForCameraChange(page, beforePerspectiveZoom, 'cameraZoom');
  const perspectiveZoomStability = await verifyPerspectiveCameraStability(
    page,
    afterPerspectiveZoom,
    'Mouse wheel',
  );

  await setView(page, 'front');

  const beforeZoom = await readTelemetry(page);
  await page.mouse.move(centerX, centerY);
  await page.mouse.wheel(0, -500);
  const afterZoom = await waitForCameraChange(page, beforeZoom, 'cameraZoom');
  const fixedAfterZoom = await assertFixedViewState(page, 'front');

  const resetSameFixed = await setView(page, 'front');
  const beforeOrbit = await readTelemetry(page);
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + Math.min(100, box.width * 0.15), centerY + 32, { steps: 8 });
  await page.mouse.up();
  const afterOrbit = await waitForCameraChange(page, beforeOrbit, 'cameraPosition');
  assert(afterOrbit.view === 'perspective', `Mouse drag did not switch to perspective: ${JSON.stringify(afterOrbit)}`);
  assert(
    afterOrbit.cameraPosition.some((value, index) => Math.abs(value - cameraPresets.perspective.position[index]) > cameraEpsilon),
    `Mouse drag reset camera to perspective preset: ${JSON.stringify(afterOrbit)}`,
  );
  const resetPerspective = await setView(page, 'perspective');

  return {
    afterOrbit,
    afterZoom,
    beforeOrbit,
    beforePerspectiveZoom,
    beforeZoom,
    fixedAfterZoom,
    perspectiveZoomStability,
    resetPerspective,
    resetSameFixed,
  };
}

/** タッチ端末の固定view維持、同一preset再適用、drag自由視点を実測する。 */
async function verifyTouchControls(page) {
  const { box, centerX, centerY } = await readCanvasGeometry(page);
  const client = await page.context().newCDPSession(page);

  try {
    const beforePerspectiveZoom = await readTelemetry(page);
    assert(beforePerspectiveZoom.view === 'perspective', 'Touch scenario did not start in perspective');
    await dispatchPinchZoom(client, centerX, centerY);
    const afterPerspectiveZoom = await waitForCameraChange(page, beforePerspectiveZoom, 'cameraZoom');
    const perspectiveZoomStability = await verifyPerspectiveCameraStability(
      page,
      afterPerspectiveZoom,
      'Touch pinch',
    );

    await setView(page, 'front');
    const beforeZoom = await readTelemetry(page);
    await dispatchPinchZoom(client, centerX, centerY);
    const afterZoom = await waitForCameraChange(page, beforeZoom, 'cameraZoom');
    const fixedAfterZoom = await assertFixedViewState(page, 'front');

    const resetSameFixed = await setView(page, 'front');
    const beforeOrbit = await readTelemetry(page);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: centerX, y: centerY }],
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: centerX + Math.min(90, box.width * 0.14), y: centerY + 28 }],
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const afterOrbit = await waitForCameraChange(page, beforeOrbit, 'cameraPosition');
    assert(afterOrbit.view === 'perspective', `Touch drag did not switch to perspective: ${JSON.stringify(afterOrbit)}`);
    assert(
      afterOrbit.cameraPosition.some((value, index) => Math.abs(value - cameraPresets.perspective.position[index]) > cameraEpsilon),
      `Touch drag reset camera to perspective preset: ${JSON.stringify(afterOrbit)}`,
    );
    const resetPerspective = await setView(page, 'perspective');

    return {
      afterOrbit,
      afterZoom,
      beforeOrbit,
      beforePerspectiveZoom,
      beforeZoom,
      fixedAfterZoom,
      perspectiveZoomStability,
      resetPerspective,
      resetSameFixed,
    };
  } finally {
    await client.detach();
  }
}

/** header、Canvas、footerと4方向ボタンの実境界を計測する。 */
async function measureLayout(page) {
  return page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const selectors = ['.vehicle-lab-header', '.vehicle-lab-canvas', '.vehicle-lab-footer'];
    const boxes = selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Missing layout element: ${selector}`);
      }
      const rect = element.getBoundingClientRect();
      return {
        selector,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        withinViewport:
          rect.left >= 0 && rect.top >= 0 &&
          rect.right <= viewport.width && rect.bottom <= viewport.height,
      };
    });
    const buttonGroup = document.querySelector('.vehicle-view-buttons');
    if (!buttonGroup) {
      throw new Error('Missing .vehicle-view-buttons');
    }
    const groupRect = buttonGroup.getBoundingClientRect();
    const buttons = [...buttonGroup.querySelectorAll('button')].map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        label: button.textContent,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        withinParent:
          rect.left >= groupRect.left && rect.top >= groupRect.top &&
          rect.right <= groupRect.right && rect.bottom <= groupRect.bottom,
      };
    });
    const canvas = document.querySelector('canvas');
    if (!canvas) {
      throw new Error('Missing canvas');
    }
    return {
      boxes,
      buttonGroup: {
        bottom: groupRect.bottom,
        left: groupRect.left,
        right: groupRect.right,
        role: buttonGroup.getAttribute('role'),
        top: groupRect.top,
      },
      buttons,
      canvasBackingStore: {
        cssHeight: canvas.getBoundingClientRect().height,
        cssWidth: canvas.getBoundingClientRect().width,
        height: canvas.height,
        width: canvas.width,
      },
      viewport,
    };
  });
}

/** WebGL contextが公開するrendererとdrawing buffer情報を記録する。 */
async function readRendererInfo(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const context = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    if (!context) {
      throw new Error('Vehicle Lab WebGL context is unavailable');
    }
    const debugRendererInfo = context.getExtension('WEBGL_debug_renderer_info');
    return {
      drawingBufferHeight: context.drawingBufferHeight,
      drawingBufferWidth: context.drawingBufferWidth,
      renderer: context.getParameter(context.RENDERER),
      shadingLanguageVersion: context.getParameter(context.SHADING_LANGUAGE_VERSION),
      unmaskedRenderer: debugRendererInfo
        ? context.getParameter(debugRendererInfo.UNMASKED_RENDERER_WEBGL)
        : null,
      unmaskedVendor: debugRendererInfo
        ? context.getParameter(debugRendererInfo.UNMASKED_VENDOR_WEBGL)
        : null,
      vendor: context.getParameter(context.VENDOR),
      version: context.getParameter(context.VERSION),
    };
  });
}

/** fixed view切替ごとのframe counterと方向画像を記録する。 */
async function captureFixedViews(page, targetName) {
  const frameSequence = [];
  const screenshots = [];
  for (const view of views) {
    const telemetry = await setView(page, view);
    frameSequence.push({ renderedFrames: telemetry.renderedFrames, view });
    const path = `${outputDirectory}/${targetName}-${view}.png`;
    await page.screenshot({ path, fullPage: false });
    screenshots.push(path);
  }
  assert(
    frameSequence.every((entry, index) => index === 0 || entry.renderedFrames > frameSequence[index - 1].renderedFrames),
    `renderedFrames was not monotonic across fixed views: ${JSON.stringify(frameSequence)}`,
  );
  return { frameSequence, screenshots };
}

/** OrbitControlsへwheelイベントを反復し、指定zoom上限または下限へ到達させる。 */
async function zoomToLimit(page, targetZoom) {
  const current = await readTelemetry(page);
  const wheelDelta = targetZoom > current.cameraZoom ? -120 : 120;
  for (let index = 0; index < 40; index += 1) {
    await page.mouse.wheel(0, wheelDelta);
  }
  await page.waitForFunction(
    (expectedZoom) => Math.abs(JSON.parse(window.render_vehicle_lab_to_text()).cameraZoom - expectedZoom) < 0.08,
    targetZoom,
  );
  await waitForTwoFrames(page);
}

/** Desktopのdesign/near/far camera envelopeを決定的に撮影する。 */
async function captureCameraEnvelope(page) {
  await setView(page, 'perspective');
  const design = await readTelemetry(page);
  const designPath = `${outputDirectory}/desktop-perspective-design-72.png`;
  await page.screenshot({ path: designPath, fullPage: false });

  const { centerX, centerY } = await readCanvasGeometry(page);
  await page.mouse.move(centerX, centerY);
  await zoomToLimit(page, 110);
  const near = await readTelemetry(page);
  const nearPath = `${outputDirectory}/desktop-perspective-near-110.png`;
  await page.screenshot({ path: nearPath, fullPage: false });

  await zoomToLimit(page, 45);
  const far = await readTelemetry(page);
  const farPath = `${outputDirectory}/desktop-perspective-far-45.png`;
  await page.screenshot({ path: farPath, fullPage: false });

  assert(design.view === 'perspective' && near.view === 'perspective' && far.view === 'perspective', 'Zoom changed perspective view');
  return {
    captures: [designPath, nearPath, farPath],
    design,
    far,
    near,
  };
}

/** 代表viewportでlayout、操作、性能、model統計、画像を検証する。 */
async function verifyVehicleLab() {
  await waitForServer();

  const browser = await chromium.launch({ headless: true });
  const browserVersion = browser.version();
  const environmentConcerns = [];
  const results = [];
  const verificationFailures = [];

  try {
    for (const target of targets) {
      const page = await browser.newPage({
        deviceScaleFactor: 1,
        hasTouch: target.name !== 'desktop',
        viewport: { height: target.height, width: target.width },
      });
      const errors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') {
          errors.push(message.text());
        }
      });
      page.on('pageerror', (error) => errors.push(String(error)));

      await page.goto(`${baseUrl}/vehicle-lab.html?verify=${Date.now()}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => typeof window.render_vehicle_lab_to_text === 'function');
      await page.waitForFunction(() => JSON.parse(window.render_vehicle_lab_to_text()).renderedFrames >= 10);

      const layout = await measureLayout(page);
      assert(
        layout.boxes.every((box) => box.withinViewport && box.width > 0 && box.height > 0),
        `Layout overflow at ${target.name}: ${JSON.stringify(layout)}`,
      );
      const [headerBox, canvasBox, footerBox] = layout.boxes;
      assert(
        headerBox.bottom <= canvasBox.top && canvasBox.bottom <= footerBox.top,
        `HUD overlaps canvas at ${target.name}: ${JSON.stringify(layout.boxes)}`,
      );
      assert(
        layout.buttons.length === 4 && layout.buttons.every((button) => button.withinParent),
        `Direction buttons overflow at ${target.name}: ${JSON.stringify(layout.buttons)}`,
      );
      assert(layout.buttonGroup.role === 'group', `Direction button group role is missing at ${target.name}`);

      const initialTelemetry = await readTelemetry(page);
      const rendererInfo = await readRendererInfo(page);
      const loadedResources = await page.evaluate(() =>
        performance.getEntriesByType('resource').map((entry) => entry.name),
      );
      assert(initialTelemetry.voxelCount === 640, `Expected 640 voxels: ${JSON.stringify(initialTelemetry)}`);
      assert(initialTelemetry.vehicleDrawCalls === 7, `Expected 7 vehicle draw calls: ${JSON.stringify(initialTelemetry)}`);
      assert(initialTelemetry.vehicleDrawCalls <= 10, `Vehicle draw call limit exceeded: ${JSON.stringify(initialTelemetry)}`);
      const expectedStableRendererCalls = assertStableRendererCalls(initialTelemetry);
      assert(!loadedResources.some((resourceUrl) => /rapier/i.test(resourceUrl)), `Vehicle Lab loaded Rapier: ${loadedResources.join(' | ')}`);

      const performance = await measureRenderFps(page);
      const rendererName = rendererInfo.unmaskedRenderer ?? rendererInfo.renderer;
      const { certified, physicalGpu, rendererClass, thresholdMet } = evaluatePerformancePolicy(
        performance.fps,
        target.minimumFps,
        rendererName,
      );
      if (!physicalGpu) {
        environmentConcerns.push(
          `${rendererClass} renderer cannot certify ${target.name} performance; thresholdMet=${thresholdMet}; physical-GPU revalidation required (${rendererName || 'empty renderer string'})`,
        );
      } else if (!thresholdMet) {
        verificationFailures.push(
          `Frame rate below target at ${target.name}: ${performance.fps.toFixed(2)} < ${target.minimumFps}`,
        );
      }

      const controls = target.name === 'desktop'
        ? await verifyMouseControls(page)
        : await verifyTouchControls(page);
      const fixedCaptures = await captureFixedViews(page, target.name);
      const cameraEnvelope = target.name === 'desktop' ? await captureCameraEnvelope(page) : null;
      const finalTelemetry = await readTelemetry(page);
      assertStableRendererCalls(finalTelemetry);

      assert(errors.length === 0, `Browser errors at ${target.name}: ${errors.join(' | ')}`);
      results.push({
        cameraEnvelope,
        certified,
        controls,
        errors,
        expectedStableRendererCalls,
        finalTelemetry,
        fixedCaptures,
        initialTelemetry,
        layout,
        loadedResources,
        performance,
        physicalGpu,
        rendererInfo,
        rendererClass,
        target,
        thresholdMet,
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  const report = {
    backend: 'Chromium headless / browser default WebGL backend',
    browserVersion,
    cameraManifest: {
      deviceScaleFactor: 1,
      envelope: { design: 72, far: 45, near: 110 },
      presets: cameraPresets,
    },
    deterministicInputs: {
      postProcessing: false,
      randomSeed: null,
      textures: false,
      time: 'live; fixed camera captures wait for two requestAnimationFrame callbacks',
    },
    gpuTiming: {
      available: false,
      limitation: 'GPU time is not exposed by this harness and is not inferred from CPU-side rAF timing.',
    },
    environmentConcerns,
    performancePolicy: {
      certification: 'Certified only when physicalGpu and thresholdMet are both true.',
      physicalGpu: 'Fail when a physical GPU misses the viewport target.',
      rendererClassification: 'Only explicitly recognized physical GPU vendors/devices are physical; known software rasterizers are software; all other renderers are unknown.',
      softwareOrUnknownRenderer: 'Always record an environment concern and never certify, regardless of thresholdMet.',
      targets: Object.fromEntries(targets.map((target) => [target.name, target.minimumFps])),
    },
    results,
    verificationFailures,
  };
  fs.writeFileSync(`${outputDirectory}/results.json`, JSON.stringify(report, null, 2));
  if (environmentConcerns.length > 0) {
    console.warn(`Vehicle Lab performance requires physical-GPU revalidation: ${environmentConcerns.join(' | ')}`);
  }
  if (verificationFailures.length > 0) {
    throw new Error(`Vehicle Lab verification failed: ${verificationFailures.join(' | ')}`);
  }
}

/** artifact初期化、policy、browser検証、manifestを1回のrunとして管理する。 */
async function runVehicleLabVerification({
  artifactDirectory = outputDirectory,
  policySelfCheck = verifyPerformancePolicySelfCheck,
  vehicleLabVerification = verifyVehicleLab,
} = {}) {
  resetOutputArtifacts(artifactDirectory);
  writeRunManifest(artifactDirectory, 'running');
  try {
    policySelfCheck();
    await vehicleLabVerification();
    writeRunManifest(artifactDirectory, 'completed');
  } catch (error) {
    const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    writeRunManifest(artifactDirectory, 'failed', errorMessage);
    throw error;
  }
}

/** 意図的policy失敗で旧artifact消去とfailed manifest更新を一時directory内に実証する。 */
async function verifyManifestFailureSelfCheck() {
  const artifactDirectory = `${outputDirectory}-manifest-self-check`;
  const staleArtifactPath = `${artifactDirectory}/stale-artifact.png`;
  const staleResultsPath = `${artifactDirectory}/results.json`;
  let browserVerificationCalled = false;
  fs.rmSync(artifactDirectory, { force: true, recursive: true });
  fs.mkdirSync(artifactDirectory, { recursive: true });
  fs.writeFileSync(staleArtifactPath, 'stale');
  fs.writeFileSync(staleResultsPath, '{"stale":true}');

  try {
    let caughtError = null;
    try {
      await runVehicleLabVerification({
        artifactDirectory,
        policySelfCheck: () => {
          throw new Error('Intentional policy self-check failure');
        },
        vehicleLabVerification: async () => {
          browserVerificationCalled = true;
        },
      });
    } catch (error) {
      caughtError = error;
    }

    assert(caughtError instanceof Error, 'Intentional policy failure was not propagated');
    assert(!browserVerificationCalled, 'Browser verification ran after policy self-check failure');
    assert(!fs.existsSync(staleArtifactPath), 'Stale PNG survived policy self-check failure');
    assert(!fs.existsSync(staleResultsPath), 'Stale results survived policy self-check failure');
    const manifest = JSON.parse(fs.readFileSync(`${artifactDirectory}/run-manifest.json`, 'utf8'));
    assert(manifest.status === 'failed', `Expected failed manifest: ${JSON.stringify(manifest)}`);
    assert(
      manifest.error.includes('Intentional policy self-check failure'),
      `Failed manifest did not record policy error: ${JSON.stringify(manifest)}`,
    );
  } finally {
    fs.rmSync(artifactDirectory, { force: true, recursive: true });
  }
}

if (process.argv.includes('--self-check')) {
  verifyPerformancePolicySelfCheck();
  console.log('Performance policy self-check passed: 20 cases');
} else if (process.argv.includes('--manifest-failure-self-check')) {
  await verifyManifestFailureSelfCheck();
  console.log('Manifest failure self-check passed: stale artifacts removed and failed status recorded');
} else {
  await runVehicleLabVerification();
}

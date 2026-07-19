import fs from 'node:fs';
import { chromium } from 'playwright';
import * as THREE from 'three';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:5173';
const outputDirectory = 'output/voxel-game/task7';
const viewports = [
  { name: 'desktop', width: 1_280, height: 720 },
  { name: 'tablet', width: 1_024, height: 768 },
  { name: 'mobile', width: 844, height: 390 },
];

fs.rmSync(outputDirectory, { force: true, recursive: true });
fs.mkdirSync(outputDirectory, { recursive: true });

/** 条件を満たさない場合にscenarioを含むErrorで停止する。 */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** 2矩形が面積を持って重なるか判定する。 */
function rectanglesOverlap(first, second) {
  return first.left < second.right
    && first.right > second.left
    && first.top < second.bottom
    && first.bottom > second.top;
}

/** Playwright bounding boxを辺表現へ変換する。 */
function toEdges(box) {
  return {
    bottom: box.y + box.height,
    left: box.x,
    right: box.x + box.width,
    top: box.y,
  };
}

/** 実camera telemetryと車両headingでvehicle world boxをscreenへ投影する。 */
function projectVehicleToScreenRect(cameraTelemetry, vehicle, bounds) {
  const { height, width } = cameraTelemetry.viewport;
  const camera = new THREE.OrthographicCamera(width / -2, width / 2, height / 2, height / -2);
  camera.position.fromArray(cameraTelemetry.position);
  camera.zoom = cameraTelemetry.zoom;
  camera.lookAt(new THREE.Vector3(...cameraTelemetry.lookTarget));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const yaw = Math.atan2(vehicle.forward[0], vehicle.forward[2]);
  const rotation = new THREE.Matrix4().makeRotationY(yaw);
  const point = new THREE.Vector3();
  const rect = {
    bottom: Number.NEGATIVE_INFINITY,
    left: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    top: Number.POSITIVE_INFINITY,
  };
  for (const xSign of [-1, 1]) {
    for (const ySign of [-1, 1]) {
      for (const zSign of [-1, 1]) {
        point.set(
          bounds.scale[0] / 2 * xSign,
          bounds.scale[1] / 2 * ySign + bounds.offset[1],
          bounds.scale[2] / 2 * zSign,
        ).applyMatrix4(rotation).add(new THREE.Vector3(...vehicle.position)).project(camera);
        const x = (point.x + 1) * width / 2;
        const y = (1 - point.y) * height / 2;
        rect.left = Math.min(rect.left, x);
        rect.right = Math.max(rect.right, x);
        rect.top = Math.min(rect.top, y);
        rect.bottom = Math.max(rect.bottom, y);
      }
    }
  }
  return rect;
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

/** 公開hookの完成版text stateを読む。 */
async function readGameState(page) {
  const rendered = await page.evaluate(() => window.render_game_to_text?.());
  assert(rendered, 'render_game_to_text is unavailable.');
  const state = JSON.parse(rendered);
  for (const key of ['coordinateSystem', 'fire', 'mission', 'blocks', 'controls', 'vehicle']) {
    assert(Object.hasOwn(state, key), `Final text state lacks ${key}: ${rendered}`);
  }
  for (const compatibilityKey of ['camera', 'runtime', 'breakables', 'visualLayout', 'visuals', 'landmarks', 'mode']) {
    assert(Object.hasOwn(state, compatibilityKey), `Compatibility text state lacks ${compatibilityKey}.`);
  }
  return state;
}

/** scene、HUD、公開hookが揃うまで待つ。 */
async function openPage(browser, scenario, viewport, errors) {
  const context = await browser.newContext({ hasTouch: true, viewport });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${scenario}: console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`${scenario}: pageerror: ${String(error)}`));
  page.on('requestfailed', (request) => errors.push(
    `${scenario}: requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`,
  ));
  await page.goto(`${baseUrl}/voxel-game.html?task7=${scenario}-${Date.now()}`, { waitUntil: 'networkidle' });
  await page.locator('.voxel-game-canvas canvas').waitFor({ state: 'visible' });
  await page.locator('.voxel-game-hud').waitFor({ state: 'visible', timeout: 5_000 });
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

/** Canvas/HUD/親子境界/実vehicle projectionをviewportごとに数値検証する。 */
async function measureLayout(page, viewport) {
  const selectors = {
    fullscreen: '.fullscreen-button',
    joystick: '.touch-joystick',
    mission: '.mission-pill',
    spray: '.spray-button',
  };
  const raw = {};
  for (const [name, selector] of Object.entries(selectors)) {
    const box = await page.locator(selector).boundingBox();
    assert(box, `${viewport.name}: ${name} box is unavailable.`);
    raw[name] = box;
  }
  const boxes = Object.fromEntries(Object.entries(raw).map(([name, box]) => [name, toEdges(box)]));
  const hudBox = await page.locator('.voxel-game-hud').boundingBox();
  const canvasBox = await page.locator('.voxel-game-canvas canvas').boundingBox();
  assert(hudBox && canvasBox, `${viewport.name}: HUD or Canvas box unavailable.`);
  assert(Math.abs(canvasBox.width - viewport.width) <= 1 && Math.abs(canvasBox.height - viewport.height) <= 1,
    `${viewport.name}: Canvas does not match viewport: ${JSON.stringify(canvasBox)}.`);
  const hudEdges = toEdges(hudBox);
  for (const [name, box] of Object.entries(boxes)) {
    assert(box.left >= hudEdges.left && box.top >= hudEdges.top
      && box.right <= hudEdges.right && box.bottom <= hudEdges.bottom,
    `${viewport.name}: ${name} exceeds HUD parent: ${JSON.stringify({ box, hudEdges })}`);
  }
  const pairs = [['joystick', 'spray'], ['joystick', 'mission'], ['spray', 'mission'], ['mission', 'fullscreen']];
  for (const [first, second] of pairs) {
    assert(!rectanglesOverlap(boxes[first], boxes[second]),
      `${viewport.name}: ${first}/${second} overlap: ${JSON.stringify(boxes)}`);
  }

  const thumbBox = await page.locator('.touch-joystick__thumb').boundingBox();
  const sprayGlyphBox = await page.locator('.spray-button__glyph').boundingBox();
  assert(thumbBox && sprayGlyphBox, `${viewport.name}: inner control box unavailable.`);
  assert(!rectanglesOverlap(toEdges(thumbBox), {
    bottom: boxes.joystick.top,
    left: boxes.joystick.left,
    right: boxes.joystick.right,
    top: boxes.joystick.top,
  })
    && toEdges(thumbBox).right <= boxes.joystick.right
    && toEdges(thumbBox).bottom <= boxes.joystick.bottom,
  `${viewport.name}: joystick thumb exceeds parent.`);
  assert(toEdges(sprayGlyphBox).right <= boxes.spray.right && toEdges(sprayGlyphBox).bottom <= boxes.spray.bottom,
    `${viewport.name}: spray glyph exceeds parent.`);

  const state = await readGameState(page);
  const vehicleRect = projectVehicleToScreenRect(state.camera, state.vehicle, state.visualLayout.vehicleBounds);
  for (const [name, box] of Object.entries(boxes)) {
    assert(!rectanglesOverlap(vehicleRect, box),
      `${viewport.name}: projected vehicle overlaps ${name}: ${JSON.stringify({ vehicleRect, box })}`);
  }
  if (viewport.name === 'mobile') {
    assert(boxes.mission.bottom < Math.min(boxes.joystick.top, boxes.spray.top),
      `mobile: mission bottom does not clear control tops: ${JSON.stringify(boxes)}`);
  }
  return { boxes, canvasBox, hudBox, vehicleRect };
}

/** desktop keyboard、blur、reset、F/button fullscreenを実際のevent経路で検証する。 */
async function verifyDesktop(browser, errors, results) {
  const opened = await openPage(browser, 'desktop-controls', { width: 1_280, height: 720 }, errors);
  const { context, page } = opened;
  try {
    const initial = await readGameState(page);
    assert(initial.coordinateSystem === 'origin=center, +x=right, +y=up, +z=toward-garage',
      `Unexpected coordinate system: ${initial.coordinateSystem}`);
    assert(initial.mission.phase === 'assigned' && initial.mission.routeVisible,
      `Initial final mission contract is wrong: ${JSON.stringify(initial.mission)}`);
    assert(initial.fire.intensity === 1 && !initial.fire.targeted,
      `Initial final fire contract is wrong: ${JSON.stringify(initial.fire)}`);
    assert(Array.isArray(initial.blocks) && initial.blocks.length === 4, 'Final blocks contract is incomplete.');
    await page.getByText('火のところへいこう', { exact: true }).waitFor({ state: 'visible' });

    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyA');
    await page.keyboard.down('Space');
    await waitForFrames(page, 2);
    const pressed = await readGameState(page);
    assert(pressed.controls.throttle === 1 && pressed.controls.steer === -1 && pressed.controls.spray,
      `Keyboard command is wrong: ${JSON.stringify(pressed.controls)}`);
    assert(await page.locator('.spray-button').getAttribute('aria-pressed') === 'true',
      'Keyboard spray command did not update aria-pressed true.');
    await page.getByText('おみずをかけよう', { exact: true }).waitFor({ state: 'visible' });
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await waitForFrames(page, 1);
    const blurred = await readGameState(page);
    assert(blurred.controls.throttle === 0 && blurred.controls.steer === 0 && !blurred.controls.spray,
      `Blur did not release all controls: ${JSON.stringify(blurred.controls)}`);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyA');
    await page.keyboard.up('Space');

    const resetBefore = blurred.vehicle.resetCount;
    await page.evaluate(() => window.reset_voxel_game_vehicle?.());
    const reset = await readGameState(page);
    assert(reset.vehicle.resetCount === resetBefore + 1, 'Vehicle reset hook did not increment resetCount.');

    const fullscreenButton = page.locator('.fullscreen-button');
    assert(await fullscreenButton.getAttribute('aria-label') === '全画面であそぶ', 'Fullscreen enter label is unclear.');
    await fullscreenButton.focus();
    await page.screenshot({ path: `${outputDirectory}/desktop-focus.png` });
    await page.keyboard.press('KeyF');
    await page.waitForFunction(() => Boolean(document.fullscreenElement));
    assert(await fullscreenButton.getAttribute('aria-pressed') === 'true', 'F fullscreen did not update aria state.');
    let canvas = await page.locator('.voxel-game-canvas canvas').boundingBox();
    assert(canvas && Math.abs(canvas.width - 1_280) <= 1 && Math.abs(canvas.height - 720) <= 1,
      `Fullscreen Canvas size mismatch: ${JSON.stringify(canvas)}`);
    await page.keyboard.press('KeyF');
    await page.waitForFunction(() => !document.fullscreenElement);
    await fullscreenButton.click();
    await page.waitForFunction(() => Boolean(document.fullscreenElement));
    assert(await fullscreenButton.getAttribute('aria-label') === '全画面をおわる', 'Fullscreen exit label is unclear.');
    await fullscreenButton.click();
    await page.waitForFunction(() => !document.fullscreenElement);
    canvas = await page.locator('.voxel-game-canvas canvas').boundingBox();
    assert(canvas && Math.abs(canvas.width - 1_280) <= 1 && Math.abs(canvas.height - 720) <= 1,
      `Post-fullscreen Canvas size mismatch: ${JSON.stringify(canvas)}`);

    results.desktop = { blurred: blurred.controls, pressed: pressed.controls, reset: reset.vehicle };
  } finally {
    await context.close();
  }
}

/** CDP touch drag/cancelでjoystick、spray hold/release/cancel/lostをDOM経路から検証する。 */
async function verifyTouch(browser, errors, results) {
  const opened = await openPage(browser, 'touch-controls', { width: 844, height: 390 }, errors);
  const { context, page } = opened;
  const cdp = await context.newCDPSession(page);
  try {
    const joystick = await page.locator('.touch-joystick').boundingBox();
    const spray = await page.locator('.spray-button').boundingBox();
    assert(joystick && spray, 'Touch controls lack bounding boxes.');
    const center = { x: joystick.x + joystick.width / 2, y: joystick.y + joystick.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', {
      touchPoints: [{ id: 7, x: center.x, y: center.y }],
      type: 'touchStart',
    });
    await cdp.send('Input.dispatchTouchEvent', {
      touchPoints: [{ id: 7, x: center.x + joystick.width * 0.38, y: center.y - joystick.height * 0.38 }],
      type: 'touchMove',
    });
    await waitForFrames(page, 1);
    const dragged = await readGameState(page);
    assert(dragged.controls.throttle > 0.45 && dragged.controls.steer > 0.45,
      `Actual touch drag did not move/steer: ${JSON.stringify(dragged.controls)}`);
    await page.screenshot({ path: `${outputDirectory}/touch-active.png` });
    await cdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchCancel' });
    const cancelled = await readGameState(page);
    assert(cancelled.controls.throttle === 0 && cancelled.controls.steer === 0,
      `Touch cancel did not center joystick: ${JSON.stringify(cancelled.controls)}`);

    const sprayCenter = { x: spray.x + spray.width / 2, y: spray.y + spray.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', {
      touchPoints: [{ id: 9, x: sprayCenter.x, y: sprayCenter.y }],
      type: 'touchStart',
    });
    await waitForFrames(page, 1);
    assert((await readGameState(page)).controls.spray, 'Touch spray hold did not set command true.');
    assert(await page.locator('.spray-button').getAttribute('aria-pressed') === 'true',
      'Touch spray hold did not set aria-pressed true.');
    await page.screenshot({ path: `${outputDirectory}/spray-active.png` });
    await cdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
    assert(!(await readGameState(page)).controls.spray, 'Touch spray release did not set command false.');
    assert(await page.locator('.spray-button').getAttribute('aria-pressed') === 'false',
      'Touch spray release did not set aria-pressed false.');

    await page.locator('.spray-button').dispatchEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: sprayCenter.x,
      clientY: sprayCenter.y,
      pointerId: 41,
      pointerType: 'touch',
    });
    await page.locator('.spray-button').dispatchEvent('pointercancel', { bubbles: true, pointerId: 41, pointerType: 'touch' });
    assert(!(await readGameState(page)).controls.spray, 'Spray pointercancel left command stuck.');
    await page.locator('.spray-button').dispatchEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: sprayCenter.x,
      clientY: sprayCenter.y,
      pointerId: 42,
      pointerType: 'touch',
    });
    await page.locator('.spray-button').dispatchEvent('lostpointercapture', {
      bubbles: true,
      pointerId: 42,
      pointerType: 'touch',
    });
    assert(!(await readGameState(page)).controls.spray, 'Spray lostpointercapture left command stuck.');
    assert(await page.locator('.spray-button').getAttribute('aria-pressed') === 'false',
      'Spray lostpointercapture left aria-pressed stuck.');
    results.touch = { cancelled: cancelled.controls, dragged: dragged.controls };
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
const errors = [];
const results = {};

try {
  await verifyDesktop(browser, errors, results);
  await verifyTouch(browser, errors, results);
  results.layouts = {};
  for (const viewport of viewports) {
    const opened = await openPage(browser, `layout-${viewport.name}`, viewport, errors);
    try {
      results.layouts[viewport.name] = await measureLayout(opened.page, viewport);
      await opened.page.screenshot({ path: `${outputDirectory}/${viewport.name}.png` });
    } finally {
      await opened.context.close();
    }
  }
  assert(errors.length === 0, `Task7 browser/request errors: ${errors.join(' | ')}`);
  fs.writeFileSync(`${outputDirectory}/results.json`, `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}

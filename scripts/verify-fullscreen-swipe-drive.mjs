import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import * as THREE from 'three';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:4173';
const outputDirectory = process.env.VOXEL_GAME_SWIPE_OUTPUT ?? 'output/voxel-game-swipe';
const configuredViewports = [
  { height: 720, name: 'desktop-touch', originRatio: [0.58, 0.62], width: 1_280 },
  { height: 768, name: 'tablet', originRatio: [0.56, 0.62], width: 1_024 },
  { height: 390, name: 'mobile-landscape', originRatio: [0.5, 0.62], width: 844 },
];
const viewportFilter = process.env.VOXEL_GAME_SWIPE_VIEWPORT ?? '';
const viewports = viewportFilter.length === 0
  ? configuredViewports
  : configuredViewports.filter(({ name }) => name === viewportFilter);
assert(viewports.length > 0, `Unknown swipe viewport: ${viewportFilter}.`);
const directions = [
  { command: [-1, 0], drag: [-1, 0], name: 'left', screen: [-1, 0] },
  { command: [1, 0], drag: [1, 0], name: 'right', screen: [1, 0] },
  { command: [0, 1], drag: [0, -1], name: 'up', screen: [0, -1] },
  { command: [0, -1], drag: [0, 1], name: 'down', screen: [0, 1] },
];

/** Vite previewが応答するまで最大30秒pollする。 */
async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return;
    } catch {
      // preview起動中は次のpollへ進む。
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Swipe drive preview did not become ready: ${baseUrl}`);
}

/** 指定数の描画frameを待ち、React eventとR3F/Rapier状態を同期する。 */
async function waitForFrames(page, count = 2) {
  await page.evaluate((frameCount) => new Promise((resolve) => {
    let remaining = frameCount;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), count);
}

/** 公開hookからJSON化可能なゲーム状態を読む。 */
async function readGameState(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

/** reset後にdamped cameraが車両の固定offsetへ収束するまで有界待機する。 */
async function waitForCameraAtVehicle(page, description) {
  let latest = null;
  for (let frame = 0; frame < 120; frame += 1) {
    await waitForFrames(page, 1);
    latest = await readGameState(page);
    const expectedLookX = latest.vehicle.position[0];
    const expectedLookZ = latest.vehicle.position[2] - 1.5;
    if (
      Math.abs(latest.camera.lookTarget[0] - expectedLookX) <= 0.05
      && Math.abs(latest.camera.lookTarget[2] - expectedLookZ) <= 0.05
    ) return latest;
  }
  throw new Error(`${description}: camera did not settle after reset: ${JSON.stringify({
    camera: latest?.camera,
    vehicle: latest?.vehicle,
  })}.`);
}

/** DOMRectを比較・artifactへ保存しやすい辺形式へ変換する。 */
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

/** 実camera telemetryでworld座標を現在viewportのscreen座標へ投影する。 */
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

/** 移動commandが完全に停止していることを検証する。 */
function assertStopped(state, description) {
  assert.equal(state.controls.moveX, 0, `${description}: moveX did not stop.`);
  assert.equal(state.controls.moveY, 0, `${description}: moveY did not stop.`);
  assert.equal(state.controls.primaryAction, false, `${description}: primary action remained pressed.`);
}

/** 任意点がdrive surfaceを実際のhit targetにすることを確認する。 */
async function assertDriveOriginIsAvailable(page, origin, viewport) {
  const hit = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    return {
      className: target instanceof HTMLElement ? target.className : null,
      driveSurface: target instanceof Element && target.closest('.touch-drive-surface') !== null,
    };
  }, origin);
  assert.equal(hit.driveSurface, true,
    `${viewport.name}: arbitrary origin is not on the drive surface: ${JSON.stringify({ hit, origin })}.`);
}

/** interactive HUDが全画面surfaceより前面でhit-testされることを確認する。 */
async function assertInteractiveHudHitTargets(page, viewport) {
  for (const selector of [
    '.vehicle-selector__button',
    '.fullscreen-button',
    '.audio-toggle-button',
    '.primary-action-button',
  ]) {
    const hit = await page.evaluate((targetSelector) => {
      const element = document.querySelector(targetSelector);
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      return document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      )?.closest(targetSelector) === element;
    }, selector);
    assert.equal(hit, true, `${viewport.name}: ${selector} is hidden behind the drive surface.`);
  }
}

/** 音、車両選択、主操作が運転を誤開始しないことを実touchで確認する。 */
async function verifyHudButtonIsolation(page, cdp, viewport) {
  await assertInteractiveHudHitTargets(page, viewport);

  await page.locator('.audio-toggle-button').tap();
  await waitForFrames(page, 2);
  const audioState = await readGameState(page);
  assertStopped(audioState, `${viewport.name}: audio button`);
  assert.equal(await page.locator('.audio-toggle-button').getAttribute('aria-pressed'), 'true');

  await page.getByRole('button', { name: 'ブルドーザーをえらぶ' }).tap();
  await waitForFrames(page, 2);
  const bulldozer = await readGameState(page);
  assertStopped(bulldozer, `${viewport.name}: vehicle selector`);
  assert.equal(bulldozer.vehicleSelection.selected, 'bulldozer');
  await page.getByRole('button', { name: 'しょうぼうしゃをえらぶ' }).tap();
  await waitForFrames(page, 2);

  const actionBox = await page.locator('.primary-action-button').boundingBox();
  assert(actionBox, `${viewport.name}: primary action bounds are unavailable.`);
  const actionPoint = {
    id: 90,
    x: actionBox.x + actionBox.width / 2,
    y: actionBox.y + actionBox.height / 2,
  };
  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [actionPoint], type: 'touchStart' });
  await waitForFrames(page, 2);
  const actionHeld = await readGameState(page);
  assert.equal(actionHeld.controls.primaryAction, true,
    `${viewport.name}: primary action touch was not held.`);
  assert.equal(actionHeld.controls.moveX, 0, `${viewport.name}: primary action started horizontal drive.`);
  assert.equal(actionHeld.controls.moveY, 0, `${viewport.name}: primary action started vertical drive.`);
  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
  await waitForFrames(page, 2);
  assertStopped(await readGameState(page), `${viewport.name}: primary action release`);

  return { actionPoint, audioEnabled: true, selectedVehicleRestored: 'fire-truck' };
}

/** 1方向の任意点dragでcommand、車両screen delta、release、DOM原点を検証する。 */
async function verifyDirection(page, cdp, viewport, origin, idlePad, direction, pointerId) {
  await page.evaluate(() => window.reset_voxel_game_vehicle?.());
  const before = await waitForCameraAtVehicle(page, `${viewport.name}/${direction.name}`);
  assertStopped(before, `${viewport.name}/${direction.name}: before drag`);
  await assertDriveOriginIsAvailable(page, origin, viewport);

  const radius = idlePad.width / 2;
  const heldPoint = {
    id: pointerId,
    x: origin.x + direction.drag[0] * radius * 0.82,
    y: origin.y + direction.drag[1] * radius * 0.82,
  };
  await cdp.send('Input.dispatchTouchEvent', {
    touchPoints: [{ id: pointerId, ...origin }],
    type: 'touchStart',
  });
  await waitForFrames(page, 2);
  const tapped = await readGameState(page);
  assertStopped(tapped, `${viewport.name}/${direction.name}: tap dead zone`);
  const activePadBox = await page.locator('.touch-joystick').boundingBox();
  assert(activePadBox, `${viewport.name}/${direction.name}: active pad bounds are unavailable.`);
  const activePad = toEdges(activePadBox);
  const activeCenter = {
    x: (activePad.left + activePad.right) / 2,
    y: (activePad.top + activePad.bottom) / 2,
  };
  assert(Math.abs(activeCenter.x - origin.x) <= 1 && Math.abs(activeCenter.y - origin.y) <= 1,
    `${viewport.name}/${direction.name}: pad did not move to pointer origin: ${JSON.stringify({ activeCenter, origin })}.`);
  assert.equal(await page.locator('.touch-joystick').getAttribute('data-active'), 'true');

  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [heldPoint], type: 'touchMove' });
  await page.waitForTimeout(420);
  const held = await readGameState(page);
  const [commandX, commandY] = direction.command;
  if (commandX !== 0) {
    assert(held.controls.moveX * commandX > 0.7,
      `${viewport.name}/${direction.name}: horizontal command points the wrong way: ${JSON.stringify(held.controls)}.`);
    assert(Math.abs(held.controls.moveY) < 0.15,
      `${viewport.name}/${direction.name}: horizontal drag leaked vertical command.`);
  } else {
    assert(held.controls.moveY * commandY > 0.7,
      `${viewport.name}/${direction.name}: vertical command points the wrong way: ${JSON.stringify(held.controls)}.`);
    assert(Math.abs(held.controls.moveX) < 0.15,
      `${viewport.name}/${direction.name}: vertical drag leaked horizontal command.`);
  }

  const start = projectWorldPoint(before.camera, before.vehicle.position);
  const end = projectWorldPoint(held.camera, held.vehicle.position);
  const screenDelta = [end[0] - start[0], end[1] - start[1]];
  const fixedCameraEnd = projectWorldPoint(before.camera, held.vehicle.position);
  const fixedCameraScreenDelta = [fixedCameraEnd[0] - start[0], fixedCameraEnd[1] - start[1]];
  const worldDistance = Math.hypot(
    held.vehicle.position[0] - before.vehicle.position[0],
    held.vehicle.position[2] - before.vehicle.position[2],
  );
  const [screenX, screenY] = direction.screen;
  assert(fixedCameraScreenDelta[0] * screenX > 8 || fixedCameraScreenDelta[1] * screenY > 8,
    `${viewport.name}/${direction.name}: vehicle did not move in the drag screen direction: ${JSON.stringify({
      beforePosition: before.vehicle.position,
      command: held.controls,
      heldPosition: held.vehicle.position,
      fixedCameraScreenDelta,
      screenDelta,
      speed: held.vehicle.speed,
      worldDistance,
    })}.`);
  assert(worldDistance > 0.3,
    `${viewport.name}/${direction.name}: vehicle did not translate: ${worldDistance}.`);

  const thumbBox = await page.locator('.touch-joystick__thumb').boundingBox();
  assert(thumbBox, `${viewport.name}/${direction.name}: thumb bounds are unavailable.`);
  const thumb = toEdges(thumbBox);
  assert(
    thumb.left >= activePad.left && thumb.top >= activePad.top
    && thumb.right <= activePad.right && thumb.bottom <= activePad.bottom,
    `${viewport.name}/${direction.name}: thumb exceeds floating pad: ${JSON.stringify({ activePad, thumb })}.`,
  );
  if (direction.name === 'right' || direction.name === 'up') {
    await page.screenshot({ path: `${outputDirectory}/${viewport.name}-${direction.name}.png` });
  }

  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
  await waitForFrames(page, 2);
  const released = await readGameState(page);
  assertStopped(released, `${viewport.name}/${direction.name}: release`);
  assert.equal(await page.locator('.touch-drive-surface').getAttribute('data-active'), 'false');
  const restoredPadBox = await page.locator('.touch-joystick').boundingBox();
  assert(restoredPadBox, `${viewport.name}/${direction.name}: restored pad bounds are unavailable.`);
  assert(Math.abs(restoredPadBox.x - idlePad.left) <= 1 && Math.abs(restoredPadBox.y - idlePad.top) <= 1,
    `${viewport.name}/${direction.name}: pad did not return to its safe anchor.`);

  return { command: held.controls, fixedCameraScreenDelta, screenDelta, worldDistance };
}

/** 運転pointerと主操作pointerを同時に保持でき、cancelで両方停止することを確認する。 */
async function verifySimultaneousAction(page, cdp, viewport, origin, idlePad, actionPoint) {
  await page.evaluate(() => window.reset_voxel_game_vehicle?.());
  await waitForFrames(page, 20);
  const drivePoint = {
    id: 201,
    x: origin.x + idlePad.width * 0.28,
    y: origin.y - idlePad.height * 0.28,
  };
  await cdp.send('Input.dispatchTouchEvent', {
    touchPoints: [{ id: 201, ...origin }],
    type: 'touchStart',
  });
  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [drivePoint], type: 'touchMove' });
  await waitForFrames(page, 2);
  await cdp.send('Input.dispatchTouchEvent', {
    touchPoints: [drivePoint, { ...actionPoint, id: 202 }],
    type: 'touchStart',
  });
  await waitForFrames(page, 2);
  const simultaneous = await readGameState(page);
  assert(simultaneous.controls.moveX > 0.35 && simultaneous.controls.moveY > 0.35,
    `${viewport.name}: simultaneous drive command was released: ${JSON.stringify(simultaneous.controls)}.`);
  assert.equal(simultaneous.controls.primaryAction, true,
    `${viewport.name}: simultaneous primary action was not held.`);
  assert.equal(await page.locator('.primary-action-button').getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: `${outputDirectory}/${viewport.name}-simultaneous.png` });

  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchCancel' });
  await waitForFrames(page, 2);
  const cancelled = await readGameState(page);
  assertStopped(cancelled, `${viewport.name}: simultaneous cancel`);
  return { held: simultaneous.controls, released: cancelled.controls };
}

/** 1 viewportの全画面drive surface、4方向、HUD競合、同時操作を実touchで検証する。 */
async function verifyViewport(browser, viewport, errors) {
  const context = await browser.newContext({
    hasTouch: true,
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
  const cdp = await context.newCDPSession(page);
  try {
    await page.goto(`${baseUrl}/?swipe=${viewport.name}-${Date.now()}&job-seed=1`, { waitUntil: 'networkidle' });
    await page.locator('.voxel-game-canvas canvas').waitFor({ state: 'visible' });
    await page.locator('.touch-drive-surface').waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => document.documentElement.dataset.voxelSceneReady === 'true'
        && typeof window.render_game_to_text === 'function'
        && typeof window.reset_voxel_game_vehicle === 'function',
      undefined,
      { timeout: 10_000 },
    );
    const surfaceBox = await page.locator('.touch-drive-surface').boundingBox();
    const idlePadBox = await page.locator('.touch-joystick').boundingBox();
    assert(surfaceBox && idlePadBox, `${viewport.name}: drive surface or idle pad bounds are unavailable.`);
    const surface = toEdges(surfaceBox);
    const idlePad = toEdges(idlePadBox);
    assert(Math.abs(surface.width - viewport.width) <= 1 && Math.abs(surface.height - viewport.height) <= 1,
      `${viewport.name}: drive surface does not cover viewport: ${JSON.stringify(surface)}.`);
    const origin = {
      x: Math.round(viewport.width * viewport.originRatio[0]),
      y: Math.round(viewport.height * viewport.originRatio[1]),
    };
    const idleCenter = {
      x: (idlePad.left + idlePad.right) / 2,
      y: (idlePad.top + idlePad.bottom) / 2,
    };
    assert(Math.hypot(origin.x - idleCenter.x, origin.y - idleCenter.y) > 100,
      `${viewport.name}: arbitrary origin is still inside the fixed lever.`);
    await assertDriveOriginIsAvailable(page, origin, viewport);
    await page.screenshot({ path: `${outputDirectory}/${viewport.name}-idle.png` });

    const buttons = await verifyHudButtonIsolation(page, cdp, viewport);
    const directionResults = {};
    for (const [index, direction] of directions.entries()) {
      directionResults[direction.name] = await verifyDirection(
        page,
        cdp,
        viewport,
        origin,
        idlePad,
        direction,
        110 + index,
      );
    }
    const simultaneous = await verifySimultaneousAction(
      page,
      cdp,
      viewport,
      origin,
      idlePad,
      buttons.actionPoint,
    );
    return { buttons, directions: directionResults, idlePad, origin, simultaneous, surface };
  } finally {
    await cdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchCancel' }).catch(() => {});
    await cdp.detach().catch(() => {});
    await context.close();
  }
}

/** 全viewportを順に検証し、結果とbrowser errorをartifactへ残す。 */
async function verifyFullscreenSwipeDrive() {
  fs.rmSync(outputDirectory, { force: true, recursive: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const results = {};
  try {
    for (const viewport of viewports) {
      results[viewport.name] = await verifyViewport(browser, viewport, errors);
    }
  } finally {
    await browser.close();
  }
  assert.deepEqual(errors, [], `Swipe drive browser errors: ${errors.join(' | ')}`);
  const report = {
    errors,
    generatedAt: new Date().toISOString(),
    results,
    viewports,
  };
  fs.writeFileSync(`${outputDirectory}/results.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

await verifyFullscreenSwipeDrive();

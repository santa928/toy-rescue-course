import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import * as THREE from 'three';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://web:5173';
const inputOnly = process.env.USABILITY_INPUT_ONLY === '1';
const output = inputOnly ? 'output/product-review/input' : 'output/product-review/usability';
fs.mkdirSync(output, { recursive: true });
const vehicles = ['fire-truck', 'bulldozer', 'excavator', 'ambulance', 'police'];
const viewports = inputOnly ? [] : (process.env.USABILITY_VIEWPORTS ?? '1469x745,1280x720,1024x768,844x390,667x375,390x844,360x800').split(',').map(size => size.split('x').map(Number));
const report = { layouts: [], input: [], faults: [], errors: [] };
const browser = await chromium.launch({ args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });

/** 通常描画と操作パネルの両方が準備されるまで待つ。 */
async function ready(page) {
  await page.locator('.primary-action-button').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).renderer.renderedFrames >= 8);
}

/** 画面と同じ公開状態を読む。 */
async function state(page) { return page.evaluate(() => JSON.parse(window.render_game_to_text())); }

/** 車体の外接8頂点を、実カメラ・実車体の回転で画面へ投影する。 */
function vehicleRect(s, width, height) {
  const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2);
  camera.position.fromArray(s.camera.position);
  camera.lookAt(new THREE.Vector3(...s.camera.lookTarget));
  camera.zoom = s.camera.zoom;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const { scale, offset } = s.visualLayout.vehicleBounds;
  const yaw = Math.atan2(s.vehicle.forward[0], s.vehicle.forward[2]);
  const points = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const p = new THREE.Vector3(offset[0] + x * scale[0] / 2, offset[1] + y * scale[1] / 2, offset[2] + z * scale[2] / 2);
    p.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(...s.vehicle.position)).project(camera);
    points.push([(p.x + 1) * width / 2, (1 - p.y) * height / 2]);
  }
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** 矩形同士の最短距離を求める。 */
function gap(a, b) {
  return Math.hypot(Math.max(a.x - b.x - b.width, b.x - a.x - a.width, 0), Math.max(a.y - b.y - b.height, b.y - a.y - a.height, 0));
}

/** HUDの実寸、子の収まり、tap領域、車体との余白を確認する。 */
async function measure(page, width, height, id) {
  const s = await state(page);
  const boxes = { vehicle: vehicleRect(s, width, height) };
  for (const [name, selector] of Object.entries({ selector: '.vehicle-selector', mission: '.mission-pill', audio: '.audio-toggle-button', fullscreen: '.fullscreen-button', map: '.mission-map', stick: '.touch-joystick', action: '.primary-action-button' })) {
    boxes[name] = await page.locator(selector).boundingBox();
  }
  for (const [name, box] of Object.entries(boxes)) {
    assert(box && box.x >= 8 && box.y >= 8 && box.x + box.width <= width - 8 && box.y + box.height <= height - 8,
      `${width}x${height} ${id} ${name} outside safe viewport: ${JSON.stringify(box)}`);
  }
  const entries = Object.entries(boxes);
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    assert(gap(entries[i][1], entries[j][1]) >= 8, `${width}x${height} ${id}: ${entries[i][0]}/${entries[j][0]} overlap: ${JSON.stringify(boxes)}`);
  }
  const children = await page.locator('.vehicle-selector__button').all();
  for (const child of children) {
    const r = await child.boundingBox();
    const p = boxes.selector;
    assert(r.width >= 56 && r.height >= 56, 'vehicle target is too small');
    assert(r.x >= p.x && r.y >= p.y && r.x + r.width <= p.x + p.width + 0.01 && r.y + r.height <= p.y + p.height + 0.01, 'vehicle target exceeds parent');
  }
  for (const selector of ['.mission-pill__job', '.mission-pill__objective', '.vehicle-selector__button']) {
    const clipped = await page.locator(selector).evaluateAll(elements => elements.filter(e => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map(e => e.textContent));
    assert.deepEqual(clipped, [], `${width}x${height}: clipped ${selector}`);
  }
  return { viewport: [width, height], id, boxes, renderer: s.renderer };
}

try {
  for (const [width, height] of viewports) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: true });
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
    await page.goto(`${baseUrl}/?job-seed=1`);
    await ready(page);
    for (const id of vehicles) {
      await page.locator(`.vehicle-selector__button[data-vehicle="${id}"]`).click();
      await page.waitForFunction(id => JSON.parse(window.render_game_to_text()).vehicle.id === id, id);
      await page.waitForTimeout(150);
      report.layouts.push(await measure(page, width, height, id));
      await page.screenshot({ path: `${output}/${width}x${height}-${id}.png` });
    }
    console.log(`[usability] layout ${width}x${height}: 5 vehicles`);
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, hasTouch: true });
  await page.goto(`${baseUrl}/?job-seed=1`);
  await ready(page);
  await page.locator('.vehicle-selector__button[data-vehicle="ambulance"]').focus();
  await page.keyboard.press('Space');
  assert.equal((await state(page)).vehicle.id, 'ambulance');
  assert.equal((await state(page)).controls.primaryAction, false);
  await page.locator('.audio-toggle-button').focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).audio.enabled);
  assert(await page.locator('.audio-toggle-button').evaluate(e => document.activeElement === e), 'audio toggle must retain keyboard focus');
  assert.equal((await state(page)).controls.primaryAction, false);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !JSON.parse(window.render_game_to_text()).audio.enabled);
  report.input.push('vehicle/audio native Space and Enter');

  const action = page.locator('.primary-action-button');
  await action.focus();
  for (const key of ['Space', 'Enter']) {
    await page.keyboard.down(key);
    assert.equal((await state(page)).controls.primaryAction, true);
    await page.keyboard.up(key);
    assert.equal((await state(page)).controls.primaryAction, false);
  }
  await action.evaluate(e => e.blur());
  const box = await action.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (const firstRelease of ['keyboard', 'pointer']) {
    await page.keyboard.down('Space');
    await page.mouse.down();
    if (firstRelease === 'keyboard') await page.keyboard.up('Space'); else await page.mouse.up();
    assert.equal((await state(page)).controls.primaryAction, true);
    if (firstRelease === 'keyboard') await page.mouse.up(); else await page.keyboard.up('Space');
    assert.equal((await state(page)).controls.primaryAction, false);
  }
  report.input.push('primary keyboard holding and mixed input release orders');
  await page.keyboard.down('w');
  await page.keyboard.down('ArrowUp');
  await page.keyboard.up('w');
  assert.equal((await state(page)).controls.moveY, 1);
  await page.locator('.audio-toggle-button').focus();
  await page.keyboard.up('ArrowUp');
  assert.equal((await state(page)).controls.moveY, 0);
  report.input.push('alias keys and focus-change keyup');

  await page.locator('.fullscreen-button').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await page.keyboard.press('Space');
  await page.waitForFunction(() => !document.fullscreenElement);
  report.input.push('native fullscreen Enter/Space');

  await page.evaluate(() => {
    const field = document.createElement('input');
    field.id = 'keyboard-test-field'; document.body.appendChild(field); field.focus();
  });
  await page.keyboard.type('wfs ');
  assert.equal(await page.locator('#keyboard-test-field').inputValue(), 'wfs ');
  assert.equal((await state(page)).controls.moveY, 0);
  assert.equal((await state(page)).controls.primaryAction, false);
  await page.locator('#keyboard-test-field').evaluate(e => e.remove());
  const nativeEvents = await page.evaluate(() => ['metaKey', 'ctrlKey', 'altKey', 'isComposing'].map(property => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'KeyW', [property]: true });
    document.body.dispatchEvent(event); return event.defaultPrevented;
  }));
  assert.deepEqual(nativeEvents, [false, false, false, false]);
  assert.equal((await state(page)).controls.moveY, 0);
  report.input.push('editable text and modifier/IME event exclusion');

  await page.keyboard.down('w');
  await page.evaluate(() => window.reset_voxel_game_vehicle());
  await page.keyboard.down('w');
  assert.equal((await state(page)).controls.moveY, 0, 'repeat must not revive a reset key');
  await page.keyboard.up('w');
  await page.keyboard.down('w');
  assert.equal((await state(page)).controls.moveY, 1);
  await page.keyboard.up('w');
  await page.evaluate(() => window.reset_voxel_game_vehicle());
  report.input.push('reset clears key ownership and blocks autorepeat revival');

  const actionBox = await action.boundingBox();
  await action.evaluate(e => e.addEventListener('pointerdown', event => { e.dataset.testPointer = String(event.pointerId); }));
  await page.mouse.move(actionBox.x + actionBox.width / 2, actionBox.y + actionBox.height / 2);
  await page.mouse.down();
  assert.equal((await state(page)).controls.primaryAction, true);
  assert(await action.evaluate(e => e.hasPointerCapture(Number(e.dataset.testPointer))));
  await page.evaluate(() => window.reset_voxel_game_vehicle());
  assert.equal((await state(page)).controls.primaryAction, false);
  assert.equal(await action.evaluate(e => e.hasPointerCapture(Number(e.dataset.testPointer))), false);
  await page.mouse.up();
  await page.mouse.down();
  assert.equal((await state(page)).controls.primaryAction, true);
  await page.keyboard.down('Space');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal((await state(page)).controls.primaryAction, false);
  await page.mouse.up(); await page.keyboard.up('Space');
  report.input.push('real pointer capture ownership released by reset; blur clears mixed input');

  await page.evaluate(() => window.reset_voxel_game_vehicle());
  for (const [width, height] of [[390, 844], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(250);
    await measure(page, width, height, 'ambulance');
  }
  report.input.push('portrait/landscape reflow in the same running scene');
  await page.close();
  assert.deepEqual(report.errors, []);
} finally {
  fs.writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log('[usability] PASS');

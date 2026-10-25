import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, webkit } from 'playwright';
import { createDomTouchStickDriver, readGameState, waitForFrames } from './voxel-game-e2e/drive-harness.mjs';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:4173';
const output = 'output/controller-support';
const viewports = [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile-landscape', width: 844, height: 390 },
];
const viewportFilter = process.env.GAMEPAD_VIEWPORT;
const allViewports = [...viewports,
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'small-portrait', width: 320, height: 568 },
];
const selectedViewports = viewportFilter ? allViewports.filter(({ name }) => name === viewportFilter) : viewports;
assert(selectedViewports.length > 0, 'Unknown GAMEPAD_VIEWPORT');
const engines = process.env.GAMEPAD_BROWSER === 'webkit' ? { webkit } : { chromium };
fs.mkdirSync(output, { recursive: true });
const results = [];

/** production sourceへtest専用APIを加えず、ブラウザのGamepad境界だけを置換する。 */
function installVirtualPad() {
  window.__pad = { connected: false, axes: [0, 0], buttons: [], mapping: 'standard' };
  window.__visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { get: () => window.__visibility });
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.__pad.connected ? [{
    id: 'virtual-standard-input', index: 0, connected: true, mapping: window.__pad.mapping,
    timestamp: performance.now(), axes: window.__pad.axes,
    buttons: Array.from({ length: 17 }, (_, index) => ({
      pressed: window.__pad.buttons.includes(index), touched: false, value: Number(window.__pad.buttons.includes(index)),
    })),
  }] : [] });
}

/** 仮想snapshotを更新し、pollingとReact/physicsを通常frameで進める。 */
async function setPad(page, values) {
  await page.evaluate((next) => Object.assign(window.__pad, next), values);
  await waitForFrames(page, 4);
}

/** 全入力sourceの停止を公開telemetryで確かめる。 */
async function assertStopped(page, label) {
  assert.deepEqual((await readGameState(page)).controls, { moveX: 0, moveY: 0, primaryAction: false }, label);
}

/** 同じ出発位置で実車体の移動量を読み、keyboardとpadの方向を比較する。 */
async function measureMovement(page, start, stop) {
  await page.evaluate(() => window.reset_voxel_game_vehicle());
  await waitForFrames(page, 12);
  const before = (await readGameState(page)).vehicle.position;
  await start();
  await waitForFrames(page, 18);
  const after = (await readGameState(page)).vehicle.position;
  await stop();
  return [after[0] - before[0], after[2] - before[2]];
}

/** 案内が画面内で読め、既存HUDを覆わないことを実寸で検証する。 */
async function assertHintLayout(page) {
  const layout = await page.locator('.gamepad-hint').evaluate((element) => {
    const box = element.getBoundingClientRect();
    const obstacles = [...document.querySelectorAll('.mission-pill, .color-effect-pill, .vehicle-selector, .hud-utilities, .mission-map, .primary-action-button, .touch-joystick')];
    const overlaps = obstacles.filter((other) => {
      const otherBox = other.getBoundingClientRect();
      return Math.min(box.right, otherBox.right) - Math.max(box.left, otherBox.left) > 0
        && Math.min(box.bottom, otherBox.bottom) - Math.max(box.top, otherBox.top) > 0;
    }).map((other) => other.className);
    return { x: box.x, y: box.y, width: box.width, height: box.height, overlaps,
      fits: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
      textFits: element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight };
  });
  assert(layout.fits && layout.textFits, `hint clips: ${JSON.stringify(layout)}`);
  assert.deepEqual(layout.overlaps, [], 'hint overlaps existing HUD');
  return layout;
}

/** 押下を一度だけ発生させ、release待機まで解除する。 */
async function press(page, button) {
  await setPad(page, { buttons: [button], axes: [0, 0] });
  await setPad(page, { buttons: [] });
}

for (const [engine, browserType] of Object.entries(engines)) {
  const browser = await browserType.launch({ headless: true });
  try {
    for (const viewport of selectedViewports) {
      console.log(`[gamepad-e2e] ${engine} ${viewport.name} start`);
      const context = await browser.newContext({ viewport, hasTouch: true });
      await context.addInitScript(installVirtualPad);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      try {
        await page.goto(`${baseUrl}/?job-seed=1`, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => document.documentElement.dataset.voxelSceneReady === 'true', undefined, { timeout: 45000 });
        await page.locator('.gamepad-hint[data-gamepad-status="waiting"]').waitFor();
        await setPad(page, { connected: true, axes: [1, 0], buttons: [0] });
        await assertStopped(page, 'held at connect');
        assert.equal(await page.locator('.gamepad-hint').getAttribute('data-gamepad-status'), 'release');
        await setPad(page, { axes: [0, 0], buttons: [] });
        await setPad(page, { axes: [0.12, -0.12] });
        await assertStopped(page, 'dead zone');
        await setPad(page, { axes: [0, 0] });

        if (process.env.GAMEPAD_LAYOUT_ONLY === '1') {
          await press(page, 9);
          const layout = await assertHintLayout(page);
          await page.screenshot({ path: `${output}/${engine}-${viewport.name}-garage.png` });
          assert.deepEqual(errors, [], 'browser errors');
          results.push({ engine, viewport: viewport.name, status: 'layout-passed', layout });
          continue;
        }

        for (const [axes, code] of [[[1, 0], 'KeyD'], [[-1, 0], 'KeyA'], [[0, -1], 'KeyW'], [[0, 1], 'KeyS']]) {
          const keyboard = await measureMovement(page, () => page.keyboard.down(code), () => page.keyboard.up(code));
          const gamepad = await measureMovement(page,
            () => setPad(page, { axes }), () => setPad(page, { axes: [0, 0] }));
          assert(Math.hypot(...gamepad) > 0.08, `pad did not move: ${axes}`);
          const cosine = (keyboard[0] * gamepad[0] + keyboard[1] * gamepad[1]) / Math.hypot(...keyboard) / Math.hypot(...gamepad);
          assert(cosine > 0.97, `screen direction differs from keyboard: ${cosine}`);
        }
        await page.evaluate(() => window.reset_voxel_game_vehicle());
        await waitForFrames(page, 15);
        await setPad(page, { axes: [0, 0], buttons: [12, 15] });
        const diagonal = (await readGameState(page)).controls;
        assert(Math.abs(Math.hypot(diagonal.moveX, diagonal.moveY) - 1) < 0.0001);
        await setPad(page, { buttons: [] });
        await setPad(page, { buttons: [0] });
        await waitForFrames(page, 20);
        assert.equal((await readGameState(page)).controls.primaryAction, true);
        assert.equal(await page.locator('[data-primary-action]').getAttribute('aria-pressed'), 'true');
        await setPad(page, { buttons: [] });
        await assertStopped(page, 'tool released');

        await page.evaluate(() => window.reset_voxel_game_vehicle());
        await waitForFrames(page, 20);
        const fleet = ['bulldozer', 'excavator', 'ambulance', 'police', 'fire-truck'];
        for (const vehicleId of fleet) {
          await press(page, 9);
          assert.equal(await page.locator('.gamepad-hint').getAttribute('data-gamepad-menu'), 'true');
          await setPad(page, { axes: [1, 0] });
          await waitForFrames(page, 8);
          assert.equal(await page.locator('[data-gamepad-highlighted="true"]').getAttribute('data-vehicle'), vehicleId);
          await setPad(page, { axes: [0, 0] });
          if (vehicleId === 'ambulance') {
            await assertHintLayout(page);
            await page.screenshot({ path: `${output}/${engine}-${viewport.name}-garage.png` });
          }
          await setPad(page, { buttons: [0] });
          await waitForFrames(page, 10);
          assert.equal((await readGameState(page)).vehicleSelection.selected, vehicleId);
          await assertStopped(page, 'confirm must not become held tool');
          await setPad(page, { buttons: [] });
        }
        await press(page, 9);
        await press(page, 1);
        assert.equal(await page.locator('.gamepad-hint').getAttribute('data-gamepad-menu'), 'false');

        // keyboardとtouchの保持はpadの通常releaseでは消えない。
        await page.keyboard.down('Space');
        await setPad(page, { buttons: [0] });
        await setPad(page, { buttons: [] });
        assert.equal((await readGameState(page)).controls.primaryAction, true);
        await page.keyboard.up('Space');
        const touch = await createDomTouchStickDriver(page);
        await touch.setStick(-1, 0);
        const touchCommand = (await readGameState(page)).controls;
        assert(touchCommand.moveX < -0.5);
        await setPad(page, { axes: [1, 0], buttons: [0] });
        assert.equal((await readGameState(page)).controls.moveX, touchCommand.moveX);
        await touch.releaseStick();
        await setPad(page, { connected: false });
        await assertStopped(page, 'disconnect');
        await setPad(page, { connected: true, axes: [1, 0], buttons: [0] });
        await assertStopped(page, 'held on reconnect');
        await setPad(page, { axes: [0, 0], buttons: [] });
        await setPad(page, { axes: [1, 0], buttons: [0] });
        await page.evaluate(() => {
          window.__visibility = 'hidden';
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await assertStopped(page, 'hidden event');
        await page.evaluate(() => {
          window.__visibility = 'visible';
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await waitForFrames(page, 5);
        await assertStopped(page, 'held after visibility restore');
        await setPad(page, { axes: [0, 0], buttons: [] });
        await setPad(page, { buttons: [0] });
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await assertStopped(page, 'blur event');
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await waitForFrames(page, 4);
        await assertStopped(page, 'held after focus restore');
        await setPad(page, { axes: [0, 0], buttons: [] });
        await setPad(page, { mapping: '' });
        await waitForFrames(page, 4);
        await assertStopped(page, 'nonstandard mapping');
        assert.equal(await page.locator('.gamepad-hint').getAttribute('data-gamepad-status'), 'unsupported');
        await setPad(page, { mapping: 'standard' });
        await page.screenshot({ path: `${output}/${engine}-${viewport.name}-drive.png` });
        const layout = await assertHintLayout(page);
        assert.deepEqual(errors, [], 'browser errors');
        results.push({ engine, viewport: viewport.name, status: 'passed', layout, evidence: 'virtual Gamepad API; real production WebGL; no physical device' });
        console.log(`[gamepad-e2e] ${engine} ${viewport.name} passed`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
fs.writeFileSync(`${output}/${Object.keys(engines)[0]}${viewportFilter ? `-${viewportFilter}` : ''}-results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));

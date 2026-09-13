import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createDomTouchStickDriver, createDriveHarness } from './voxel-game-e2e/drive-harness.mjs';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:4173';
const output = 'output/town-rebuild/depot';
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const harness = createDriveHarness({ alignAttemptLimit: 45, brakeFrameLimit: 220 });
const results = [];

/** 状態を変更するdebug hookを使わず、入口を往復して同じ前庭へ帰れることを確認する。 */
async function verifyDepot(viewport, vehicle) {
  const page = await browser.newPage({ viewport, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const name = `${viewport.width}x${viewport.height}-${vehicle}`;
  try {
    await page.goto(`${baseUrl}/?job-seed=1`);
    await page.waitForFunction(() => window.render_game_to_text && JSON.parse(window.render_game_to_text()).renderer.renderedFrames > 8);
    await page.locator(`.vehicle-selector__button[data-vehicle="${vehicle}"]`).click();
    await page.waitForFunction(vehicle => JSON.parse(window.render_game_to_text()).vehicle.id === vehicle, vehicle);
    const before = await harness.readGameState(page);
    const touchDriver = await createDomTouchStickDriver(page);
    // 前庭から正面開口へ。駐車枠と入口は同じZ=6で接続する。
    await harness.driveToCoordinate(page, { coordinateIndex: 0, target: -8.8, tolerance: 0.3, touchDriver, description: `${name} enter depot` });
    const inside = await harness.readGameState(page);
    assert(Math.abs(inside.vehicle.position[2] - 6) < 0.6, 'entry must stay within the opening');
    assert.equal(inside.vehicle.resetCount, before.vehicle.resetCount);
    await page.screenshot({ path: `${output}/${name}-inside.png` });
    // 入庫後の方向転換も含めて通常入力だけで出庫する。
    await harness.driveToCoordinate(page, { coordinateIndex: 0, target: 0, tolerance: 0.4, touchDriver, description: `${name} exit depot` });
    await harness.brakeVehicle(page);
    await page.waitForFunction(() => !document.querySelector('[data-vehicle="fire-truck"]').disabled);
    const after = await harness.readGameState(page);
    assert.equal(after.vehicle.resetCount, before.vehicle.resetCount);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/${name}-returned.png` });
    results.push({ name, inside: inside.vehicle.position, returned: after.vehicle.position, resetCount: after.vehicle.resetCount, renderer: after.renderer });
    console.log('[depot] PASS', name);
  } catch (error) {
    fs.writeFileSync(`${output}/${name}-failed.json`, JSON.stringify(await harness.readGameState(page), null, 2));
    await page.screenshot({ path: `${output}/${name}-failed.png` });
    throw error;
  } finally { await page.close(); }
}

try {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 844, height: 390 }]) {
    for (const vehicle of ['fire-truck', 'bulldozer', 'excavator', 'ambulance', 'police']) {
      await verifyDepot(viewport, vehicle);
    }
  }
} finally {
  fs.writeFileSync(`${output}/report.json`, JSON.stringify(results, null, 2));
  await browser.close();
}

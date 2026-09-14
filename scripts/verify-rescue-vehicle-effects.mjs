import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { readGameState, waitForFrames } from './voxel-game-e2e/drive-harness.mjs';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:5174';
const output = process.env.RESCUE_EFFECTS_OUTPUT ?? 'output/rescue-effects/after';
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const reports = [];

/** 実ポインターで押下・保持・解除し、車体と演出の連続画像を記録する。 */
async function verify(viewport, vehicle) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const name = `${viewport.width}-${vehicle}`;
  const phases = [];
  try {
    await page.goto(`${baseUrl}/?job-seed=1`);
    await page.waitForFunction(() => window.render_game_to_text && JSON.parse(window.render_game_to_text()).renderer.renderedFrames > 8);
    await page.locator(`[data-vehicle="${vehicle}"].vehicle-selector__button`).click();
    await page.waitForFunction(id => JSON.parse(window.render_game_to_text()).vehicle.id === id, vehicle);
    await waitForFrames(page, 8);
    const box = await page.locator('.primary-action-button').boundingBox();
    assert(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (const [phase, frames] of [['idle', 1], ['press', 5], ['hold', 24], ['sustain', 50], ['release', 30]]) {
      if (phase === 'press') await page.mouse.down();
      if (phase === 'release') await page.mouse.up();
      await waitForFrames(page, frames);
      const state = await readGameState(page);
      assert.equal(state.vehicle.id, vehicle);
      assert.equal(state.controls.primaryAction, !['idle', 'release'].includes(phase));
      if (phase === 'release' && vehicle !== 'fire-truck') assert.equal(state.vehicleActionVfx.activeCubeCount, 0);
      if (['press', 'hold', 'sustain'].includes(phase) && vehicle !== 'fire-truck') assert(state.vehicleActionVfx.activeCubeCount >= 8);
      assert(state.renderer.rendererCalls <= 34);
      await page.screenshot({ path: `${output}/${name}-${phase}.png` });
      phases.push({ phase, state });
    }
    assert.deepEqual(errors, []);
    reports.push({ name, phases, errors });
    console.log('[rescue-effects] PASS', name);
  } finally { await page.close(); }
}

try {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 844, height: 390 }]) {
    for (const vehicle of ['fire-truck', 'ambulance', 'police']) await verify(viewport, vehicle);
  }
} finally {
  fs.writeFileSync(`${output}/report.json`, JSON.stringify(reports, null, 2));
  await browser.close();
}

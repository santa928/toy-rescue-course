import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://web:5173';
const output = 'output/product-review/recovery';
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const report = [];

/** ゲーム操作が可能な状態を待つ。 */
async function ready(page) {
  await page.locator('.primary-action-button').waitFor({ timeout: 30000 });
}

/** DOMエラーと操作系の破棄を確認し、実画面を保存する。 */
async function failure(page, name) {
  await page.getByRole('alert').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('.primary-action-button').count(), 0);
  assert.equal(await page.evaluate(() => typeof window.render_game_to_text), 'undefined');
  assert(await page.getByRole('button', { name: 'もういちど ひらく' }).isVisible());
  await page.screenshot({ path: `${output}/${name}.png` });
  report.push({ name, message: await page.getByRole('alert').innerText(), controlsRemoved: true });
}

try {
  for (const kind of ['module', 'scene', 'webgl', 'context']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const url = `${baseUrl}/?job-seed=1&recovery=${kind}`;
    if (kind === 'module') await page.route('**/src/voxel-game/VoxelGameApp.tsx*', r => r.abort());
    if (kind === 'scene') await page.route('**/src/voxel-game/scene/VoxelGameScene.tsx*', r => r.fulfill({
      contentType: 'application/javascript',
      body: 'export function VoxelGameScene(){throw new Error("scene fixture")} export function syncVehicleMissionSpatialSignals(){}',
    }));
    if (kind === 'webgl') await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return /webgl/.test(type) ? null : getContext.call(this, type, ...args);
      };
    });
    await page.goto(url);
    if (kind === 'context') {
      await ready(page);
      await page.locator('.audio-toggle-button').click();
      await page.keyboard.down('Space');
      await page.evaluate(() => {
        const gl = document.querySelector('canvas').getContext('webgl2');
        gl.getExtension('WEBGL_lose_context').loseContext();
      });
    }
    await failure(page, kind);
    if (kind === 'module' || kind === 'scene') await page.unrouteAll();
    await page.getByRole('button', { name: 'もういちど ひらく' }).click();
    assert.equal(page.url(), url);
    if (kind === 'webgl') await failure(page, 'webgl-retry');
    else await ready(page);
    await page.close();
  }

  const slow = await browser.newPage({ viewport: { width: 667, height: 375 } });
  await slow.route('**/src/voxel-game/VoxelGameApp.tsx*', async r => {
    await new Promise(resolve => setTimeout(resolve, 18000));
    await r.continue().catch(() => {});
  });
  await slow.goto(`${baseUrl}/?job-seed=1&recovery=slow`, { waitUntil: 'domcontentloaded' });
  await slow.getByText('よみこみに じかんが かかっています').waitFor({ timeout: 20000 });
  assert.equal(await slow.locator('.primary-action-button').count(), 0);
  await slow.screenshot({ path: `${output}/slow.png` });
  await ready(slow);
  report.push({ name: 'slow', delayedMessage: true, recovered: true });
  await slow.close();

  const nojs = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 360, height: 800 } });
  await nojs.goto(baseUrl);
  assert(await nojs.locator('noscript').isVisible());
  assert(await nojs.getByRole('link', { name: 'もういちど ひらく' }).isVisible());
  await nojs.screenshot({ path: `${output}/no-javascript.png` });
  report.push({ name: 'no-javascript', readableFallback: true });
  await nojs.close();
} finally {
  fs.writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log('[recovery] PASS', report);

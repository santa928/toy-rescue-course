import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.PRODUCTION_BASE_URL ?? 'http://127.0.0.1:4173';
const targets = [
  {
    name: 'root',
    pathname: '/',
    ready: () => document.documentElement.dataset.voxelSceneReady === 'true'
      && typeof window.render_game_to_text === 'function',
    selector: '.voxel-game-canvas canvas',
  },
  {
    name: 'compatibility',
    pathname: '/voxel-game.html',
    ready: () => document.documentElement.dataset.voxelSceneReady === 'true'
      && typeof window.render_game_to_text === 'function',
    selector: '.voxel-game-canvas canvas',
  },
  {
    name: 'vehicle-lab',
    pathname: '/vehicle-lab.html',
    ready: () => typeof window.render_vehicle_lab_to_text === 'function'
      && JSON.parse(window.render_vehicle_lab_to_text()).renderedFrames >= 10,
    selector: '.vehicle-lab-canvas canvas',
  },
];

/** production previewが応答するまで短いpollを行う。 */
async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // preview起動中は次のpollで再試行する。
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Production preview did not become ready: ${baseUrl}`);
}

/** 3つの公開entryを独立contextで開き、WebGL起動とbrowser error不在を確認する。 */
async function verifyProductionEntrypoints() {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const target of targets) {
      const context = await browser.newContext({ viewport: { height: 720, width: 1_280 } });
      const page = await context.newPage();
      const errors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console: ${message.text()}`);
      });
      page.on('pageerror', (error) => errors.push(`pageerror: ${String(error)}`));
      page.on('requestfailed', (request) => errors.push(
        `requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`,
      ));

      try {
        const response = await page.goto(
          `${baseUrl}${target.pathname}?production-smoke=${Date.now()}&job-seed=1`,
          { waitUntil: 'networkidle' },
        );
        assert.equal(response?.ok(), true, `${target.name}: HTML response failed.`);
        await page.locator(target.selector).waitFor({ state: 'visible' });
        await page.waitForFunction(target.ready, undefined, { timeout: 10_000 });
        const canvas = await page.locator(target.selector).boundingBox();
        assert(canvas && canvas.width > 0 && canvas.height > 0, `${target.name}: Canvas has no size.`);
        assert.deepEqual(errors, [], `${target.name}: ${errors.join(' | ')}`);
        results.push({
          canvas: { height: canvas.height, width: canvas.width },
          name: target.name,
          pathname: target.pathname,
          title: await page.title(),
        });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ baseUrl, results, status: 'completed' }, null, 2));
}

await verifyProductionEntrypoints();

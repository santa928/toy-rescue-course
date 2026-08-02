import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:4173';
const outputDirectory = process.env.VOXEL_GAME_CAMERA_OUTPUT ?? 'output/voxel-game-camera-stability';
const viewports = [
  { height: 720, name: 'desktop', width: 1_280 },
  { height: 768, name: 'tablet', width: 1_024 },
  { height: 390, name: 'mobile-landscape', width: 844 },
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
  throw new Error(`Voxel game preview did not become ready: ${baseUrl}`);
}

/** 微小な丸め差を除外し、軸移動の符号が反転した回数を返す。 */
function countDirectionReversals(values, epsilon = 0.000_01) {
  let previousDirection = 0;
  let reversals = 0;
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    if (Math.abs(delta) <= epsilon) continue;
    const direction = Math.sign(delta);
    if (previousDirection !== 0 && direction !== previousDirection) reversals += 1;
    previousDirection = direction;
  }
  return reversals;
}

/** 連続frameの軸範囲と反転数を安定性判定向けに要約する。 */
function summarizeAxis(samples, key, axis) {
  const values = samples.map((sample) => sample[key][axis]);
  return {
    range: Math.max(...values) - Math.min(...values),
    reversals: countDirectionReversals(values),
  };
}

/** 車庫壁へ車体を押し付け、車体だけが揺れてcameraは反転しないことを確認する。 */
async function verifyViewport(browser, viewport) {
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    viewport: { height: viewport.height, width: viewport.width },
  });
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
    await page.goto(
      `${baseUrl}/?camera-stability=${viewport.name}-${Date.now()}&job-seed=1`,
      { waitUntil: 'networkidle' },
    );
    await page.waitForFunction(() => (
      document.documentElement.dataset.voxelSceneReady === 'true'
      && typeof window.render_game_to_text === 'function'
    ), undefined, { timeout: 12_000 });
    await page.waitForTimeout(750);

    await page.keyboard.down('KeyS');
    const samples = await page.evaluate(async () => {
      const rows = [];
      for (let index = 0; index < 150; index += 1) {
        await new Promise(requestAnimationFrame);
        const state = JSON.parse(window.render_game_to_text());
        rows.push({ camera: state.camera.position, vehicle: state.vehicle.position });
      }
      return rows;
    });
    await page.keyboard.up('KeyS');

    const camera = [0, 1, 2].map((axis) => summarizeAxis(samples, 'camera', axis));
    const vehicle = [0, 1, 2].map((axis) => summarizeAxis(samples, 'vehicle', axis));
    assert.equal(camera[1].range, 0, `${viewport.name}: camera followed vertical contact jitter.`);
    assert(
      camera[0].range > 0.1 || camera[2].range > 0.1,
      `${viewport.name}: collision camera scenario did not exercise follow movement.`,
    );
    assert(
      vehicle[0].reversals + vehicle[2].reversals >= 12,
      `${viewport.name}: vehicle did not reach the intended collision jitter scenario.`,
    );
    assert(
      camera[0].reversals <= 1 && camera[2].reversals <= 1,
      `${viewport.name}: camera still reverses with collision jitter: ${JSON.stringify(camera)}`,
    );
    assert.deepEqual(errors, [], `${viewport.name}: ${errors.join(' | ')}`);

    const screenshot = `${outputDirectory}/${viewport.name}.png`;
    await page.screenshot({ path: screenshot });
    return { camera, screenshot, vehicle, viewport };
  } finally {
    await page.keyboard.up('KeyS').catch(() => undefined);
    await context.close();
  }
}

await mkdir(outputDirectory, { recursive: true });
await waitForServer();
const browser = await chromium.launch({ headless: true });
try {
  const results = [];
  for (const viewport of viewports) results.push(await verifyViewport(browser, viewport));
  console.log(JSON.stringify({ baseUrl, results, status: 'completed' }, null, 2));
} finally {
  await browser.close();
}

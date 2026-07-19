import fs from 'node:fs';
import { chromium } from 'playwright';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:5173';
const outputDirectory = 'output/voxel-game';
fs.mkdirSync(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { height: 720, width: 1280 } });
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') {
    errors.push(message.text());
  }
});
page.on('pageerror', (error) => errors.push(String(error)));

try {
  await page.goto(`${baseUrl}/voxel-game.html?verify=${Date.now()}`, {
    waitUntil: 'networkidle',
  });
  await page.locator('.voxel-game-canvas canvas').waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => document.documentElement.dataset.voxelSceneReady === 'true',
    undefined,
    { timeout: 3000 },
  );
  const renderedState = await page.evaluate(() => window.render_game_to_text?.());
  if (!renderedState?.includes('static-world')) {
    throw new Error('Voxel Game text state is unavailable.');
  }
  await page.screenshot({ path: `${outputDirectory}/static-desktop.png` });
  const canvasScreenshot = await page.locator('.voxel-game-canvas canvas').screenshot();
  const sampledColorCount = await page.evaluate(async (base64Screenshot) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64Screenshot}`;
    await image.decode();
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = image.width;
    sampleCanvas.height = image.height;
    const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return 0;
    }
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
    const colors = new Set();
    for (let y = 0; y < sampleCanvas.height; y += 40) {
      for (let x = 0; x < sampleCanvas.width; x += 40) {
        const index = (y * sampleCanvas.width + x) * 4;
        colors.add(`${pixels[index]}:${pixels[index + 1]}:${pixels[index + 2]}`);
      }
    }
    return colors.size;
  }, canvasScreenshot.toString('base64'));
  if (sampledColorCount < 5) {
    throw new Error(`Voxel Game canvas is visually empty (${sampledColorCount} sampled colors).`);
  }
  if (errors.length > 0) {
    throw new Error(`Voxel Game browser errors: ${errors.join(' | ')}`);
  }
} finally {
  await browser.close();
}

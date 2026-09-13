import fs from 'node:fs';
import { chromium } from 'playwright';

const urls = { base: process.env.BASE_GAME_URL ?? 'http://127.0.0.1:5173', head: process.env.VOXEL_GAME_BASE_URL ?? 'http://web:5173' };
const results = [];
const browser = await chromium.launch({ args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
try {
  for (let round = 0; round < 3; round++) {
    for (const label of round % 2 ? ['head', 'base'] : ['base', 'head']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto(`${urls[label]}/?job-seed=1`);
      await page.waitForFunction(() => typeof window.render_game_to_text === 'function'
        && JSON.parse(window.render_game_to_text()).renderer.renderedFrames >= 8);
      const sample = await page.evaluate(() => new Promise(resolve => {
        const intervals = [];
        let start, previous;
        const frame = time => {
          start ??= time;
          if (time - start > 2000 && previous !== undefined) intervals.push(time - previous);
          previous = time;
          if (time - start < 14000) return requestAnimationFrame(frame);
          const fps = intervals.map(ms => 1000 / ms).sort((a, b) => a - b);
          resolve({ meanFps: 1000 * intervals.length / intervals.reduce((a, b) => a + b, 0),
            medianFps: fps[Math.floor(fps.length / 2)], p10Fps: fps[Math.floor(fps.length / 10)],
            frames: intervals.length, renderer: JSON.parse(window.render_game_to_text()).renderer });
        };
        requestAnimationFrame(frame);
      }));
      results.push({ label, round: round + 1, ...sample });
      console.log(label, round + 1, sample.medianFps, sample.p10Fps);
      await page.close();
    }
  }
} finally {
  fs.mkdirSync('output/product-review', { recursive: true });
  fs.writeFileSync('output/product-review/performance.json', JSON.stringify({
    viewport: [1280, 720], seed: 1, warmupMs: 2000, sampleMs: 12000,
    note: '同じDocker内のsoftware rendererによる交互3回比較。物理GPU性能や実機体験は認証しない。', results,
  }, null, 2));
  await browser.close();
}

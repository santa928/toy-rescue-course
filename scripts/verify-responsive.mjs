import fs from 'node:fs';
import { chromium } from 'playwright';

const targets = [
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

/**
 * 代表viewportでHUD境界、車種選択、走行後状態、スクリーンショットを記録する。
 */
async function verifyResponsive() {
  fs.mkdirSync('output/responsive', { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader'],
  });
  const results = [];

  for (const target of targets) {
    const page = await browser.newPage({
      viewport: { width: target.width, height: target.height },
    });
    const errors = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });
    page.on('pageerror', (error) => errors.push(String(error)));

    await page.goto('http://host.docker.internal:5180', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.click('button:has-text("ブルドーザー")');
    await page.waitForTimeout(300);
    const stateAfterSelect = await page.evaluate(() => window.render_game_to_text?.() ?? 'null');

    const upButton = page.locator('.touch-button', { hasText: '↑' });
    await upButton.dispatchEvent('pointerdown');
    await page.waitForTimeout(6500);
    await upButton.dispatchEvent('pointerup');
    await page.waitForTimeout(300);

    const stateAfterDrive = await page.evaluate(() => window.render_game_to_text?.() ?? 'null');
    const layout = await page.evaluate(() => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const boxes = [...document.querySelectorAll('.vehicle-strip, .status-strip, .touch-pad')].map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: element.className,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          within:
            rect.left >= 0 &&
            rect.top >= 0 &&
            rect.right <= viewport.width &&
            rect.bottom <= viewport.height,
        };
      });

      return { viewport, boxes };
    });

    await page.screenshot({ path: `output/responsive/${target.name}.png`, fullPage: false });
    results.push({ target, errors, stateAfterSelect, stateAfterDrive, layout });
    await page.close();
  }

  await browser.close();
  fs.writeFileSync('output/responsive/results.json', JSON.stringify(results, null, 2));
}

await verifyResponsive();

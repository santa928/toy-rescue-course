import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createDriveHarness } from './voxel-game-e2e/drive-harness.mjs';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:4173';
const output = 'output/product-review/remaining-jobs';
fs.mkdirSync(output, { recursive: true });
// 製品のJobDeck.draw()で各配列の2/3番目を引く最小seedを確認した値。
const cases = [
  ['ambulance', 5376, 'patient-playground'], ['ambulance', 10752, 'patient-picnic'],
  ['excavator', 5376, 'soil-south'], ['excavator', 10752, 'soil-west'],
  ['police', 5376, 'patrol-pools'], ['police', 10752, 'patrol-showers'],
  ['bulldozer', 5376, 'debris-south'],
].filter(([, , id]) => !process.env.JOB_FILTER || process.env.JOB_FILTER.split(',').includes(id));
const harness = createDriveHarness({ alignAttemptLimit: 45, brakeFrameLimit: 220, defaultMaxBursts: 480 });
const { readGameState: state, driveToCoordinate, driveAlongWorldAxis, brakeVehicle, pulseWorldAxis } = harness;
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const results = [];

/** 通常のkeyboard入力だけで、道路上の指定X/Zへ停止する。 */
async function move(page, coordinateIndex, target, description, tolerance = 0.5) {
  await driveToCoordinate(page, { coordinateIndex, target, description, tolerance });
}

/** 停止条件を満たして主操作を保持し、実ミッションの完了を待つ。 */
async function hold(page, vehicle, count, id) {
  await brakeVehicle(page);
  await page.screenshot({ path: `${output}/${id}-before-${count}.png` });
  await page.keyboard.down('Space');
  try {
    await page.waitForFunction(({ vehicle, count }) => JSON.parse(window.render_game_to_text())[vehicle].completedCount >= count,
      { vehicle, count }, { timeout: 15000 });
  } finally { await page.keyboard.up('Space'); }
}

try {
  for (const [vehicle, seed, id] of cases) {
    const page = await browser.newPage({ viewport: { width: 1469, height: 745 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(`${baseUrl}/?job-seed=${seed}`);
      await page.locator('.primary-action-button').waitFor();
      await page.locator(`.vehicle-selector__button[data-vehicle="${vehicle}"]`).click();
      await page.waitForFunction(vehicle => JSON.parse(window.render_game_to_text()).vehicle.id === vehicle, vehicle);
      const initial = await state(page);
      assert.equal(initial.mission.jobId, id);
      console.log('[jobs] start', id, seed);
      const gate = initial.visualLayout.worldSolids.find(b => b.id === 'hub-gate-post');
      const gateZ = gate.position[2] - gate.scale[2] / 2 - 4;
      await move(page, 2, gateZ, `${id} garage exit`);

      if (vehicle === 'ambulance') {
        const target = initial.mission.targetPositions[0];
        await move(page, 2, -12, `${id} park road`);
        if (id === 'patient-playground') {
          await move(page, 0, 10.5, `${id} east park lane`);
          await move(page, 2, target[2], `${id} north park lane`);
          await move(page, 0, target[0], `${id} patient approach`);
        } else {
          await move(page, 2, -15, `${id} picnic staging`);
          await move(page, 0, target[0], `${id} picnic longitude`);
          await move(page, 2, target[2] + 0.8, `${id} patient approach`);
        }
        await hold(page, vehicle, 1, id);
      } else if (vehicle === 'police') {
        const targets = initial.mission.targetPositions;
        await move(page, 0, targets[0][0], `${id} side road`);
        await move(page, 2, 17, `${id} gate staging`);
        for (const [index, target] of targets.entries()) {
          await move(page, 0, target[0], `${id} gate ${index + 1} longitude`);
          await page.screenshot({ path: `${output}/${id}-before-${index + 1}.png` });
          await page.keyboard.down('Space');
          try {
            await driveAlongWorldAxis(page, { axis: 'positiveZ', description: `${id} gate ${index + 1}`,
              predicate: s => s.police.completedCount >= index + 1 });
          } finally { await page.keyboard.up('Space'); }
        }
      } else {
        const targets = [...initial.mission.targetPositions].sort((a, b) => b[0] - a[0] || a[2] - b[2]);
        await move(page, 0, -13, `${id} west staging`);
        if (id === 'soil-west') await move(page, 0, -37, `${id} west lane`);
        for (const [index, target] of targets.entries()) {
          console.log('[jobs] target', id, index + 1, target);
          if (id === 'soil-west') await move(page, 0, -37, `${id} clear lane`);
          await move(page, 2, target[2], `${id} target latitude`, 0.3);
          if (vehicle === 'bulldozer') {
            await move(page, 0, target[0] + 4, `${id} blade staging`);
            await page.keyboard.down('Space');
            try {
              await driveAlongWorldAxis(page, { axis: 'negativeX', description: `${id} clear ${index + 1}`,
                predicate: s => s.bulldozer.clearedCount >= index + 1 });
            } finally { await page.keyboard.up('Space'); }
          } else {
            const direction = id === 'soil-west' ? 1 : -1;
            await move(page, 0, target[0] - direction * 2.6, `${id} bucket staging`, 0.35);
            if ((await state(page)).vehicle.forward[0] * direction < 0.8) {
              await pulseWorldAxis(page, { axis: direction > 0 ? 'positiveX' : 'negativeX', frameCount: 4, description: `${id} face target` });
            }
            await hold(page, vehicle, index + 1, id);
          }
        }
      }
      const completed = await state(page);
      assert.equal(completed.mission.progress.current, completed.mission.progress.target);
      assert(['celebrating', 'freeRoam'].includes(completed.mission.phase));
      assert.equal(completed.vehicle.resetCount, initial.vehicle.resetCount, 'route must not teleport/reset');
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${output}/${id}-complete.png` });
      results.push({ id, seed, vehicle, completed: completed.mission, renderer: completed.renderer, resetCount: completed.vehicle.resetCount });
      console.log('[jobs] PASS', id);
    } catch (error) {
      fs.writeFileSync(`${output}/${id}-failed-state.json`, JSON.stringify(await state(page).catch(() => null), null, 2));
      await page.screenshot({ path: `${output}/${id}-failed.png` });
      throw error;
    } finally { await page.close(); }
  }
} finally {
  fs.writeFileSync(`${output}/report${process.env.JOB_FILTER ? `-${process.env.JOB_FILTER}` : ''}.json`, JSON.stringify(results, null, 2));
  await browser.close();
}

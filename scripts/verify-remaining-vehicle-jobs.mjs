import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createDomTouchStickDriver, createDriveHarness } from './voxel-game-e2e/drive-harness.mjs';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:4173';
const output = process.env.REMAINING_JOBS_OUTPUT ?? 'output/product-review/remaining-jobs';
const viewportName = process.env.REMAINING_JOBS_VIEWPORT ?? 'desktop';
assert(['desktop', 'mobile-landscape'].includes(viewportName), `Unknown job viewport: ${viewportName}`);
const touch = viewportName === 'mobile-landscape';
const viewport = touch ? { width: 844, height: 390 } : { width: 1280, height: 720 };
fs.mkdirSync(output, { recursive: true });
// 製品のJobDeck.draw()で各配列の2/3番目を引く最小seedを確認した値。
const cases = [
  ['ambulance', 5376, 'patient-playground'], ['ambulance', 10752, 'patient-picnic'],
  ['excavator', 5376, 'soil-south'], ['excavator', 10752, 'soil-west'],
  ['police', 5376, 'patrol-pools'], ['police', 10752, 'patrol-showers'],
  ['bulldozer', 5376, 'debris-south'],
  ['police', 1, 'patrol-main'],
  ['ambulance', 1, 'patient-pond'],
].filter(([, , id]) => process.env.JOB_FILTER
  ? process.env.JOB_FILTER.split(',').includes(id)
  : !['patrol-main', 'patient-pond'].includes(id));
const harness = createDriveHarness({ alignAttemptLimit: 45, brakeFrameLimit: 220, defaultMaxBursts: 480 });
const { readGameState: state, driveToCoordinate, driveAlongWorldAxis, brakeVehicle, pulseWorldAxis } = harness;
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const results = [];
let touchDriver = null;

/** DesktopのSpaceとMobileの主操作ボタンを押下・解除する。 */
async function primaryAction(page, pressed) {
  if (!touch) {
    if (pressed) await page.keyboard.down('Space');
    else await page.keyboard.up('Space');
    return;
  }
  const action = page.locator('.primary-action-button');
  const box = await action.boundingBox();
  assert(box, 'Primary action button is unavailable.');
  await action.dispatchEvent(pressed ? 'pointerdown' : 'pointerup', {
    button: 0, pointerId: 82, pointerType: 'touch',
    clientX: box.x + box.width / 2, clientY: box.y + box.height / 2,
  });
}

/** 通常の移動入力で道路上の指定X/Zへ停止する。門の精密な進入にはDOMスティックを使う。 */
async function move(page, coordinateIndex, target, description, tolerance = 0.5) {
  await driveToCoordinate(page, { coordinateIndex, target, description, tolerance, touchDriver });
}

/** 停止条件を満たして主操作を保持し、実ミッションの完了を待つ。 */
async function hold(page, vehicle, count, id) {
  await brakeVehicle(page);
  await page.screenshot({ path: `${output}/${id}-before-${count}.png` });
  await primaryAction(page, true);
  try {
    await page.waitForFunction(({ vehicle, count }) => JSON.parse(window.render_game_to_text())[vehicle].completedCount >= count,
      { vehicle, count }, { timeout: 15000 });
  } finally { await primaryAction(page, false); }
}

try {
  for (const [vehicle, seed, id] of cases) {
    const page = await browser.newPage({ viewport, hasTouch: touch });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      touchDriver = null;
      await page.goto(`${baseUrl}/?job-seed=${seed}`);
      await page.locator('.primary-action-button').waitFor();
      await page.locator(`.vehicle-selector__button[data-vehicle="${vehicle}"]`).click();
      await page.waitForFunction(vehicle => JSON.parse(window.render_game_to_text()).vehicle.id === vehicle, vehicle);
      const initial = await state(page);
      assert.equal(initial.mission.jobId, id);
      if (touch || vehicle === 'police') touchDriver = await createDomTouchStickDriver(page);
      console.log('[jobs] start', id, seed);
      const gateZ = 0; // 中央交差点を経由し、車庫の外壁を横切らない。
      await move(page, 2, gateZ, `${id} garage exit`);

      if (vehicle === 'ambulance') {
        const target = initial.mission.targetPositions[0];
        await move(page, 2, -12, `${id} park road`);
        if (id === 'patient-pond') {
          await move(page, 2, target[2], `${id} pond latitude`);
          await page.screenshot({ path: `${output}/${id}-approach.png` });
          await move(page, 0, target[0], `${id} pond patient approach`);
        } else if (id === 'patient-playground') {
          await move(page, 0, 10.5, `${id} east park lane`);
          await move(page, 2, target[2], `${id} north park lane`);
          await page.screenshot({ path: `${output}/${id}-approach.png` });
          await move(page, 0, target[0], `${id} patient approach`);
        } else {
          await move(page, 2, -13.5, `${id} picnic staging`);
          await move(page, 0, target[0], `${id} picnic longitude`);
          await page.screenshot({ path: `${output}/${id}-approach.png` });
          await move(page, 2, target[2] + 0.8, `${id} patient approach`);
        }
        await hold(page, vehicle, 1, id);
      } else if (vehicle === 'police') {
        const targets = initial.mission.targetPositions;
        // シャワー側は色源の外側から南側道路へ出る。
        if (id === 'patrol-pools') {
          await move(page, 0, -3.5, `${id} forecourt lane`, 0.25);
          await move(page, 2, 13, `${id} clear depot`, 0.25);
        }
        await move(page, 0, id === 'patrol-showers' ? 14 : targets[0][0], `${id} side road`);
        await move(page, 2, 17, `${id} gate staging`);
        for (const [index, target] of targets.entries()) {
          if (id === 'patrol-showers' && index === 2) {
            await move(page, 2, 30, `${id} clear shower posts`);
          }
          // 各門の直前で座標を整える。長距離の開ループ入力による横ずれを門の判定と混同しない。
          await move(page, 2, target[2] - 2, `${id} gate ${index + 1} staging`, 0.3);
          await move(page, 0, target[0], `${id} gate ${index + 1} longitude`, 0.25);
          await page.screenshot({ path: `${output}/${id}-before-${index + 1}.png` });
          await primaryAction(page, true);
          try {
            await driveAlongWorldAxis(page, { axis: 'positiveZ', touchDriver, description: `${id} gate ${index + 1}`,
              predicate: s => s.police.completedCount >= index + 1 });
          } finally { await primaryAction(page, false); }
        }
      } else {
        const targets = [...initial.mission.targetPositions].sort((a, b) => b[0] - a[0] || a[2] - b[2]);
        await move(page, 0, -16, `${id} west staging`);
        if (id === 'soil-west') {
          await move(page, 2, -3.7, `${id} north block approach`, 0.25);
          await move(page, 0, -37, `${id} west lane`);
        }
        for (const [index, target] of targets.entries()) {
          console.log('[jobs] target', id, index + 1, target);
          if (id === 'soil-west') await move(page, 0, -37, `${id} clear lane`);
          await move(page, 2, target[2], `${id} target latitude`, 0.3);
          if (vehicle === 'bulldozer') {
            await move(page, 0, target[0] + 4, `${id} blade staging`);
            await page.screenshot({ path: `${output}/${id}-before-${index + 1}.png` });
            await primaryAction(page, true);
            try {
              await driveAlongWorldAxis(page, { axis: 'negativeX', touchDriver, description: `${id} clear ${index + 1}`,
                predicate: s => s.bulldozer.clearedCount >= index + 1 });
            } finally { await primaryAction(page, false); }
          } else {
            const direction = id === 'soil-west' ? 1 : -1;
            await move(page, 0, target[0] - direction * 2.6, `${id} bucket staging`, 0.35);
            if ((await state(page)).vehicle.forward[0] * direction < 0.8) {
              await pulseWorldAxis(page, { axis: direction > 0 ? 'positiveX' : 'negativeX', touchDriver, frameCount: 4, description: `${id} face target` });
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
      const gameAsset = await page.evaluate(() => performance.getEntriesByType('resource')
        .map(entry => entry.name).find(name => /VoxelGameApp-.*\.js/.test(name)));
      results.push({ id, seed, vehicle, viewport: viewportName, gameAsset, input: touch ? 'DOM touch stick and action button' : vehicle === 'police' ? 'DOM touch stick and keyboard action' : 'keyboard', completed: completed.mission, renderer: completed.renderer, resetCount: completed.vehicle.resetCount });
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

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createDomTouchStickDriver, waitForFrames } from './voxel-game-e2e/drive-harness.mjs';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:5173';
const output = 'output/vehicle-tracks';
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const reports = [];

/** 実sceneから履帯を含むbatchの描画行列を採取する。 */
async function snapshot(page) {
  return page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/@react-three_fiber.js'))?.name;
    const { _roots } = await import(url);
    const scene = _roots.get(document.querySelector('canvas')).store.getState().scene;
    const meshes = [];
    scene.traverse(object => {
      if (typeof object.userData.trackLeft !== 'number') return;
      meshes.push({
        left: object.userData.trackLeft, right: object.userData.trackRight,
        matrices: Array.from(object.instanceMatrix.array),
      });
    });
    return { meshes, state: JSON.parse(window.render_game_to_text()) };
  });
}

/** 2枚の実描画行列を比較し、位置が変わったvoxel数を数える。 */
function changedCells(before, after) {
  let count = 0;
  before.meshes.forEach((mesh, batch) => {
    for (let index = 0; index < mesh.matrices.length; index += 16) {
      if ([12, 13, 14].some(axis => Math.abs(mesh.matrices[index + axis] - after.meshes[batch].matrices[index + axis]) > 0.00001)) count++;
    }
  });
  return count;
}

/** 2車種を走らせ、左右差、停止、作業道具、reset、壁押しを実入力で確認する。 */
async function verify(viewport, vehicle) {
  const page = await browser.newPage({ viewport });
  const name = `${viewport.width}-${vehicle}`;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const phases = [];
  try {
    await page.goto(`${baseUrl}/?job-seed=1`);
    await page.waitForFunction(() => window.render_game_to_text && JSON.parse(window.render_game_to_text()).renderer.renderedFrames > 8);
    await page.locator(`[data-vehicle="${vehicle}"].vehicle-selector__button`).click();
    await waitForFrames(page, 15);
    const initial = await snapshot(page);
    assert.equal(initial.meshes.length, 2);
    await page.keyboard.down('KeyA');
    await page.keyboard.down('KeyS');
    for (const [phase, frames] of [['drive-a', 20], ['drive-b', 12], ['stop', 120], ['still', 25], ['action', 15], ['release', 35], ['turn', 20]]) {
      if (phase === 'stop') {
        await page.keyboard.up('KeyA'); await page.keyboard.up('KeyS');
      }
      if (phase === 'action') {
        const box = await page.locator('.primary-action-button').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      }
      if (phase === 'release') await page.mouse.up();
      if (phase === 'turn') {
        await page.keyboard.down('KeyD'); await page.keyboard.down('KeyS');
      }
      await waitForFrames(page, frames);
      const data = await snapshot(page);
      phases.push({ phase, ...data });
      await page.screenshot({ path: `${output}/${name}-${phase}.png` });
    }
    const [first, second, stopped, still, action, release, turn] = phases;
    assert.equal(changedCells(first, second), vehicle === 'bulldozer' ? 64 : 72, 'only belt perimeter cells circulate');
    assert(Math.hypot(second.state.vehicle.position[0] - first.state.vehicle.position[0], second.state.vehicle.position[2] - first.state.vehicle.position[2]) > 0.1);
    for (const side of ['left', 'right']) assert(Math.abs(stopped.meshes[0][side] - still.meshes[0][side]) < 0.02);
    assert(Math.abs(turn.meshes[0].left - turn.meshes[0].right) > 0.05, 'turning uses different left/right travel');
    assert.equal(action.state.controls.primaryAction, true);
    assert(action.state.vehicleActionVfx.activeCubeCount > 0);
    assert.equal(release.state.controls.primaryAction, false);
    await page.keyboard.up('KeyD'); await page.keyboard.up('KeyS');
    await page.evaluate(() => window.reset_voxel_game_vehicle());
    await waitForFrames(page, 10);
    const reset = await snapshot(page);
    assert(reset.meshes.every(mesh => Math.abs(mesh.left) < 0.01 && Math.abs(mesh.right) < 0.01));
    let wall = null;
    if (viewport.width === 1280) {
      const driver = await createDomTouchStickDriver(page);
      await driver.setStick(-0.803, -0.595);
      await waitForFrames(page, 240);
      const blocked = await snapshot(page);
      await waitForFrames(page, 35);
      const held = await snapshot(page);
      assert(blocked.state.vehicle.position[0] < -7);
      for (const side of ['left', 'right']) assert(Math.abs(held.meshes[0][side] - blocked.meshes[0][side]) < 0.07, 'blocked track stops');
      await driver.releaseStick();
      wall = { blocked, held };
    }
    assert.deepEqual(errors, []);
    reports.push({ name, initial, phases, reset, wall, errors });
    console.log('[vehicle-tracks] PASS', name);
  } finally { await page.close(); }
}

try {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 844, height: 390 }]) {
    for (const vehicle of ['bulldozer', 'excavator']) await verify(viewport, vehicle);
  }
} finally {
  fs.writeFileSync(`${output}/report.json`, JSON.stringify(reports, null, 2));
  await browser.close();
}

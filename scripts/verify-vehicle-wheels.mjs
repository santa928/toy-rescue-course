import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createDomTouchStickDriver, readGameState, waitForFrames } from './voxel-game-e2e/drive-harness.mjs';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:5173';
const output = process.env.WHEEL_OUTPUT ?? 'output/vehicle-wheels';
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const reports = [];

/** Viteで稼働中の実sceneから車輪instanceの行列を読み、telemetryだけの成功を避ける。 */
async function readWheelMeshes(page) {
  return page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/@react-three_fiber.js'))?.name;
    if (!url) throw new Error('Vite R3F resource is required for the rendered wheel probe.');
    const { _roots } = await import(url);
    const scene = _roots.get(document.querySelector('canvas')).store.getState().scene;
    const meshes = [];
    scene.traverse(object => {
      if (!object.isInstancedMesh || typeof object.userData.wheelAngle !== 'number') return;
      const matrices = object.instanceMatrix.array;
      const rotating = [];
      for (let index = 0; index < object.count; index++) {
        const start = index * 16;
        if (Math.abs(matrices[start + 6]) > 0.00001 || Math.abs(matrices[start + 5] - 1) > 0.00001) {
          rotating.push(Array.from(matrices.slice(start, start + 16)));
        }
      }
      meshes.push({ angle: object.userData.wheelAngle, rotating });
    });
    return meshes;
  });
}

/** 実入力で発進・減速・停止・再発進を行い、3車種の描画行列と連続画像を照合する。 */
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
    await waitForFrames(page, 20);
    const initial = await readGameState(page);
    await page.keyboard.down('KeyA');
    await page.keyboard.down('KeyS');
    for (const [phase, frames] of [['drive-a', 20], ['drive-b', 12], ['drive-c', 12], ['stop', 120], ['still', 30], ['restart', 20]]) {
      if (phase === 'stop') {
        await page.keyboard.up('KeyA');
        await page.keyboard.up('KeyS');
      }
      if (phase === 'restart') {
        await page.keyboard.down('KeyD');
        await page.keyboard.down('KeyS');
      }
      await waitForFrames(page, frames);
      const state = await readGameState(page);
      const meshes = await readWheelMeshes(page);
      assert.equal(meshes.length, 2, 'tire and hub batches both receive the rolling angle');
      assert.equal(meshes.flatMap(mesh => mesh.rotating).length, 84, 'all four 21-voxel wheels rotate');
      for (const mesh of meshes) for (const matrix of mesh.rotating) {
        assert(Math.abs(matrix[5] - Math.cos(mesh.angle)) < 0.00001);
        assert(Math.abs(matrix[6] - Math.sin(mesh.angle)) < 0.00001);
      }
      await page.screenshot({ path: `${output}/${name}-${phase}.png` });
      phases.push({ phase, vehicle: state.vehicle, meshes });
    }
    const [driveA, driveB, , stopped, still, restarted] = phases;
    assert(Math.hypot(driveA.vehicle.position[0] - initial.vehicle.position[0], driveA.vehicle.position[2] - initial.vehicle.position[2]) > 0.2);
    assert(Math.abs(driveB.meshes[0].angle - driveA.meshes[0].angle) > 0.05);
    assert(Math.abs(still.meshes[0].angle - stopped.meshes[0].angle) < 0.02, 'stopped wheels stay stopped');
    assert(Math.abs(restarted.meshes[0].angle - still.meshes[0].angle) > 0.05, 'restart resumes rolling');
    assert.deepEqual(errors, []);
    reports.push({ name, initial: initial.vehicle, phases, errors });
    console.log('[vehicle-wheels] PASS', name);
  } finally { await page.close(); }
}

/** 車庫の実壁へ押し続けても空転せず、帰庫resetと乗換で角度を引き継がないことを確認する。 */
async function verifyWallAndReset() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await page.goto(`${baseUrl}/?job-seed=1`);
    await page.waitForFunction(() => window.render_game_to_text && JSON.parse(window.render_game_to_text()).renderer.renderedFrames > 8);
    const driver = await createDomTouchStickDriver(page);
    await driver.setStick(-0.803, -0.595);
    await waitForFrames(page, 240);
    const blocked = { vehicle: (await readGameState(page)).vehicle, meshes: await readWheelMeshes(page) };
    await waitForFrames(page, 35);
    const held = { vehicle: (await readGameState(page)).vehicle, meshes: await readWheelMeshes(page) };
    assert(blocked.vehicle.position[0] < -7, 'vehicle reached the actual garage wall');
    assert(Math.hypot(held.vehicle.position[0] - blocked.vehicle.position[0], held.vehicle.position[2] - blocked.vehicle.position[2]) < 0.04, 'wall blocks continued input');
    assert(Math.abs(held.meshes[0].angle - blocked.meshes[0].angle) < 0.07, 'blocked wheel does not spin');
    await page.screenshot({ path: `${output}/wall-held.png` });
    await driver.releaseStick();
    await page.evaluate(() => window.reset_voxel_game_vehicle());
    await waitForFrames(page, 10);
    const reset = { vehicle: (await readGameState(page)).vehicle, meshes: await readWheelMeshes(page) };
    assert.equal(reset.vehicle.resetCount, 1);
    assert(reset.meshes.every(mesh => Math.abs(mesh.angle) < 0.01));
    await page.locator('[data-vehicle="ambulance"].vehicle-selector__button').click();
    await waitForFrames(page, 10);
    const switched = { vehicle: (await readGameState(page)).vehicle, meshes: await readWheelMeshes(page) };
    assert.equal(switched.vehicle.id, 'ambulance');
    assert(switched.meshes.every(mesh => Math.abs(mesh.angle) < 0.01));
    reports.push({ name: 'wall-reset-switch', blocked, held, reset, switched });
    console.log('[vehicle-wheels] PASS wall-reset-switch');
  } finally { await page.close(); }
}

try {
  if (process.env.WHEEL_FOCUS !== 'wall') {
    for (const viewport of [{ width: 1280, height: 720 }, { width: 844, height: 390 }]) {
      for (const vehicle of ['fire-truck', 'ambulance', 'police']) await verify(viewport, vehicle);
    }
  }
  await verifyWallAndReset();
} finally {
  fs.writeFileSync(`${output}/report.json`, JSON.stringify(reports, null, 2));
  await browser.close();
}

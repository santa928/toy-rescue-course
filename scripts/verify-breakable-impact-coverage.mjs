import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import {
  createDomTouchStickDriver,
  createDriveHarness,
  WORLD_AXIS_INPUTS,
} from './voxel-game-e2e/drive-harness.mjs';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:4173';
const outputDirectory = process.env.VOXEL_GAME_BREAK_COVERAGE_OUTPUT
  ?? 'output/voxel-game-break-coverage';
const targetBlockId = 'plaza-yellow';
const configuredLateralOffsets = [-2.15, -1.05, 0, 1.05, 2.15];
const offsetFilter = process.env.VOXEL_GAME_BREAK_COVERAGE_OFFSET ?? '';
const lateralOffsets = offsetFilter.length === 0
  ? configuredLateralOffsets
  : configuredLateralOffsets.filter((offset) => String(offset) === offsetFilter);
assert(lateralOffsets.length > 0, `Unknown break coverage offset: ${offsetFilter}.`);

/** Vite previewが応答するまで最大30秒pollする。 */
async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return;
    } catch {
      // preview起動中は次のpollへ進む。
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Breakable impact preview did not become ready: ${baseUrl}`);
}

/** 指定IDのworld solidを公開telemetryから取得する。 */
function requireWorldSolid(state, id) {
  const solid = state.visualLayout.worldSolids.find((entry) => entry.id === id);
  assert(solid, `Missing world solid: ${id}.`);
  return solid;
}

/** 車庫から黄色い積み木の東側runwayへ、他の積み木へ触れず移動する。 */
async function stageAtYellowEastRunway(page, harness, touchDriver, lateralOffset) {
  const initial = await harness.readGameState(page);
  const block = initial.landmarks.breakableBlocks.find(({ id }) => id === targetBlockId);
  assert(block, `${targetBlockId} landmark is unavailable.`);
  const garage = initial.landmarks.garage;
  const hubGate = requireWorldSolid(initial, 'hub-gate-post');
  await harness.driveAlongWorldAxis(page, {
    axis: 'negativeZ',
    description: `${lateralOffset}: garage exit`,
    predicate: (state) => state.vehicle.position[2] <= garage[2] - 3,
    touchDriver,
  });
  const gateBypassZ = hubGate.position[2] - hubGate.scale[2] / 2 - 1.7 - 2;
  await harness.alignWorldCoordinate(page, {
    coordinateIndex: 2,
    description: `${lateralOffset}: hub gate bypass Z`,
    target: gateBypassZ,
    tolerance: 0.4,
    touchDriver,
  });
  // どの横位置でも同じ十分な助走を与え、接触面の傾きだけを比較する。
  const stageX = block.position[0] + 7;
  await harness.driveAlongWorldAxis(page, {
    axis: 'negativeX',
    description: `${lateralOffset}: east runway X`,
    predicate: (state) => state.vehicle.position[0] <= stageX,
    touchDriver,
  });
  await harness.alignWorldCoordinate(page, {
    coordinateIndex: 0,
    description: `${lateralOffset}: east runway precise X`,
    target: stageX,
    tolerance: 0.3,
    touchDriver,
  });
  await harness.alignWorldCoordinate(page, {
    coordinateIndex: 2,
    description: `${lateralOffset}: impact lane Z`,
    target: block.position[2] + lateralOffset,
    tolerance: 0.18,
    touchDriver,
  });
  const staged = await harness.readGameState(page);
  assert.equal(staged.runtime.blocks.find(({ id }) => id === targetBlockId)?.phase, 'intact');
  assert(staged.breakables.blocks.every(({ vehicleImpactCount }) => vehicleImpactCount === 0),
    `${lateralOffset}: staging touched a breakable block.`);
  return { block, staged };
}

/** 東からの実車衝突で指定blockが破壊されるまで最大240frame待つ。 */
async function collideFromEast(
  page,
  harness,
  touchDriver,
  beforeImpactCount,
  lateralOffset,
  block,
  staged,
) {
  let latest = await harness.readGameState(page);
  let nearest = {
    centerDistance: Number.POSITIVE_INFINITY,
    vehicle: latest.vehicle,
  };
  let firstVehicleContactFrame = null;
  const initialResetCount = latest.vehicle.resetCount;
  try {
    await touchDriver.setStick(...WORLD_AXIS_INPUTS.negativeX.stick);
    for (let frame = 0; frame < 240; frame += 1) {
      await harness.waitForFrames(page, 1);
      latest = await harness.readGameState(page);
      assert.equal(latest.vehicle.resetCount, initialResetCount,
        `${lateralOffset}: vehicle reset after missing the target: ${JSON.stringify({ nearest, staged })}.`);
      const centerDistance = Math.hypot(
        latest.vehicle.position[0] - block.position[0],
        latest.vehicle.position[2] - block.position[2],
      );
      if (centerDistance < nearest.centerDistance) {
        nearest = { centerDistance, vehicle: latest.vehicle };
      }
      if (latest.vehicle.position[0] <= block.position[0] - 4) break;
      const runtimeBlock = latest.runtime.blocks.find(({ id }) => id === targetBlockId);
      const telemetry = latest.breakables.blocks.find(({ id }) => id === targetBlockId);
      if (runtimeBlock?.phase === 'broken') return latest;
      if ((telemetry?.vehicleImpactCount ?? 0) > beforeImpactCount) {
        firstVehicleContactFrame ??= frame;
        if (frame - firstVehicleContactFrame >= 90) {
          throw new Error(`${lateralOffset}: sustained collision did not break the block: ${JSON.stringify({
            block: telemetry,
            vehicle: latest.vehicle,
          })}.`);
        }
      }
    }
  } finally {
    await touchDriver.releaseStick();
  }
  throw new Error(`${lateralOffset}: vehicle did not break the target: ${JSON.stringify({
    block: latest.breakables.blocks.find(({ id }) => id === targetBlockId),
    nearest,
    staged,
    vehicle: latest.vehicle,
  })}.`);
}

/** 1本の横位置について独立pageでrunway、衝突、破壊状態を検証する。 */
async function verifyLateralOffset(browser, lateralOffset, errors) {
  const context = await browser.newContext({ viewport: { height: 720, width: 1_280 } });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${lateralOffset}: console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`${lateralOffset}: pageerror: ${String(error)}`));
  page.on('requestfailed', (request) => errors.push(
    `${lateralOffset}: requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`,
  ));
  const harness = createDriveHarness({
    alignAttemptLimit: 32,
    requiredFields: ['breakables', 'runtime', 'vehicle', 'visualLayout'],
  });
  let touchDriver = null;
  try {
    await page.goto(`${baseUrl}/?break-coverage=${lateralOffset}&job-seed=1`, { waitUntil: 'networkidle' });
    await page.locator('.voxel-game-canvas canvas').waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => document.documentElement.dataset.voxelSceneReady === 'true'
        && typeof window.render_game_to_text === 'function',
      undefined,
      { timeout: 10_000 },
    );
    touchDriver = await createDomTouchStickDriver(page, { pointerId: 301 });
    const { block, staged } = await stageAtYellowEastRunway(
      page,
      harness,
      touchDriver,
      lateralOffset,
    );
    await page.screenshot({ path: `${outputDirectory}/yellow-offset-${lateralOffset}-staged.png` });
    const beforeImpactCount = staged.breakables.blocks
      .find(({ id }) => id === targetBlockId)?.vehicleImpactCount ?? 0;
    const broken = await collideFromEast(
      page,
      harness,
      touchDriver,
      beforeImpactCount,
      lateralOffset,
      block,
      staged,
    );
    const blockTelemetry = broken.breakables.blocks.find(({ id }) => id === targetBlockId);
    assert.equal(broken.runtime.blocks.find(({ id }) => id === targetBlockId)?.phase, 'broken');
    assert.equal(blockTelemetry?.vehicleImpactCount, beforeImpactCount + 1);
    assert((blockTelemetry?.maxImpactSpeed ?? 0) >= 4,
      `${lateralOffset}: effective impact speed is below threshold.`);
    const activeTargetFragmentCount = broken.breakables.activeFragments
      .filter(({ id }) => id.startsWith(`${targetBlockId}:`)).length;
    assert.equal(activeTargetFragmentCount, 6);
    await page.screenshot({ path: `${outputDirectory}/yellow-offset-${lateralOffset}.png` });
    return {
      blockPosition: block.position,
      impactSpeed: blockTelemetry?.maxImpactSpeed,
      lateralOffset,
      stagedVehiclePosition: staged.vehicle.position,
      vehicleImpactCount: blockTelemetry?.vehicleImpactCount,
    };
  } finally {
    await touchDriver?.releaseStick().catch(() => undefined);
    await context.close();
  }
}

/** 黄色い積み木の可視東面を端から端まで実車衝突で検証する。 */
async function verifyBreakableImpactCoverage() {
  fs.rmSync(outputDirectory, { force: true, recursive: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const results = [];
  try {
    for (const offset of lateralOffsets) {
      results.push(await verifyLateralOffset(browser, offset, errors));
    }
  } finally {
    await browser.close();
  }
  assert.deepEqual(errors, [], `Breakable impact browser errors: ${errors.join(' | ')}`);
  const report = { errors, generatedAt: new Date().toISOString(), results };
  fs.writeFileSync(`${outputDirectory}/results.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

await verifyBreakableImpactCoverage();

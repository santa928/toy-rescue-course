import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import {
  createDomTouchStickDriver,
  createDriveHarness,
} from './voxel-game-e2e/drive-harness.mjs';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:5173';
const outputDirectory = 'output/voxel-game-fleet';
const allViewports = [
  { height: 720, name: 'desktop', touch: false, width: 1_280 },
  { height: 768, name: 'tablet', touch: true, width: 1_024 },
  { height: 390, name: 'mobile-landscape', touch: true, width: 844 },
];
const viewportFilter = process.env.VOXEL_GAME_FLEET_VIEWPORT || null;
const viewports = viewportFilter === null
  ? allViewports
  : allViewports.filter(({ name }) => name === viewportFilter);
assert(viewports.length > 0, `Unknown VOXEL_GAME_FLEET_VIEWPORT: ${viewportFilter}.`);

const harness = createDriveHarness({
  alignAttemptLimit: 40,
  brakeFrameLimit: 200,
  defaultMaxBursts: 440,
  pulseDistanceMultiplier: 1.5,
  requiredFields: [
    'controls',
    'ambulance',
    'excavator',
    'landmarks',
    'mission',
    'renderer',
    'vehicle',
    'vehicleSelection',
    'visuals',
    'world',
  ],
});
const {
  alignWorldCoordinate,
  brakeVehicle,
  driveAlongWorldAxis,
  driveToCoordinate,
  readGameState,
  waitForFrames,
} = harness;

fs.mkdirSync(outputDirectory, { recursive: true });

/** Playwright矩形を右端・下端つきの比較しやすい値へ変換する。 */
function toEdges(box) {
  return {
    bottom: box.y + box.height,
    height: box.height,
    left: box.x,
    right: box.x + box.width,
    top: box.y,
    width: box.width,
  };
}

/** 交差していない2矩形間の最短距離を返す。 */
function rectDistance(left, right) {
  const horizontal = Math.max(left.left - right.right, right.left - left.right, 0);
  const vertical = Math.max(left.top - right.bottom, right.top - left.bottom, 0);
  return Math.hypot(horizontal, vertical);
}

/** 4台selectorと主要HUDが画面内・親内・安全余白内にあることを実寸で検証する。 */
async function measureFleetHud(page, viewport) {
  const selectors = {
    action: '.primary-action-button',
    fullscreen: '.fullscreen-button',
    joystick: '.touch-joystick',
    mission: '.mission-pill',
    selector: '.vehicle-selector',
  };
  const boxes = {};
  for (const [name, selector] of Object.entries(selectors)) {
    const box = await page.locator(selector).boundingBox();
    assert(box, `${viewport.name}: ${name} bounding box is unavailable.`);
    boxes[name] = toEdges(box);
  }
  for (const [name, box] of Object.entries(boxes)) {
    assert(box.left >= 0 && box.top >= 0 && box.right <= viewport.width && box.bottom <= viewport.height,
      `${viewport.name}: ${name} exceeds viewport: ${JSON.stringify(box)}.`);
  }
  for (const [leftName, rightName] of [
    ['selector', 'mission'],
    ['mission', 'fullscreen'],
    ['joystick', 'action'],
    ['mission', 'joystick'],
    ['mission', 'action'],
  ]) {
    assert(rectDistance(boxes[leftName], boxes[rightName]) >= 8,
      `${viewport.name}: ${leftName}/${rightName} lack 8px safety gap: ${JSON.stringify(boxes)}.`);
  }

  const selector = boxes.selector;
  const buttonBoxes = await page.locator('.vehicle-selector__button').evaluateAll((buttons) => (
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top };
    })
  ));
  assert.equal(buttonBoxes.length, 4, `${viewport.name}: selector must contain four vehicle buttons.`);
  for (const button of buttonBoxes) {
    assert(
      button.left >= selector.left && button.top >= selector.top
      && button.right <= selector.right && button.bottom <= selector.bottom,
      `${viewport.name}: vehicle button exceeds selector: ${JSON.stringify({ button, selector })}.`,
    );
  }
  return { boxes, buttonBoxes };
}

/** Spaceまたはtouch主操作buttonを同じcommandへ押下・解除する。 */
async function setPrimaryAction(page, touch, pressed) {
  if (!touch) {
    if (pressed) await page.keyboard.down('Space');
    else await page.keyboard.up('Space');
    return;
  }
  const action = page.locator('.primary-action-button');
  const box = await action.boundingBox();
  assert(box, 'primary action bounding box is unavailable.');
  await action.dispatchEvent(pressed ? 'pointerdown' : 'pointerup', {
    button: 0,
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
    pointerId: 82,
    pointerType: 'touch',
  });
}

/** 停止してバケットを保持し、指定土山が700ms後に1回だけ完了することを待つ。 */
async function digTarget(page, viewport, expectedCompletedCount) {
  await brakeVehicle(page, { frameLimit: 220 });
  const stopped = await readGameState(page);
  assert(stopped.vehicle.speed <= 0.45,
    `${viewport.name}: excavator is too fast to dig: ${stopped.vehicle.speed}.`);
  await setPrimaryAction(page, viewport.touch, true);
  let completed = null;
  let lastState = stopped;
  try {
    for (let frame = 0; frame < 150; frame += 1) {
      await waitForFrames(page, 1);
      const state = await readGameState(page);
      lastState = state;
      assert(state.vehicle.speed <= 0.45,
        `${viewport.name}: excavator exceeded work speed while holding: ${state.vehicle.speed}.`);
      if (state.excavator.completedCount >= expectedCompletedCount) {
        completed = state;
        break;
      }
    }
  } finally {
    await setPrimaryAction(page, viewport.touch, false);
  }
  assert(completed,
    `${viewport.name}: soil target ${expectedCompletedCount} did not complete within 150 frames: ${JSON.stringify({
      contactPoint: lastState.excavator.contactPoint,
      forward: lastState.vehicle.forward,
      holdMilliseconds: lastState.excavator.holdMilliseconds,
      position: lastState.vehicle.position,
      speed: lastState.vehicle.speed,
      targets: lastState.excavator.targets,
    })}.`);
  return completed;
}

/** 停止して手当てを保持し、患者1体が1200ms後に起き上がるまで待つ。 */
async function careForPatient(page, viewport) {
  await brakeVehicle(page, { frameLimit: 220 });
  const stopped = await readGameState(page);
  assert(stopped.vehicle.speed <= 0.35,
    `${viewport.name}: ambulance is too fast to provide care: ${stopped.vehicle.speed}.`);
  await setPrimaryAction(page, viewport.touch, true);
  let completed = null;
  try {
    for (let frame = 0; frame < 180; frame += 1) {
      await waitForFrames(page, 1);
      const state = await readGameState(page);
      assert(state.vehicle.speed <= 0.35,
        `${viewport.name}: ambulance exceeded care speed while holding: ${state.vehicle.speed}.`);
      if (state.ambulance.completedCount === 1) {
        completed = state;
        break;
      }
    }
  } finally {
    await setPrimaryAction(page, viewport.touch, false);
  }
  assert(completed, `${viewport.name}: patient did not complete within 180 frames.`);
  return completed;
}

/** 1 viewportでショベル選択、土3山、成功、帰庫、次仕事まで実走する。 */
async function verifyExcavatorViewport(browser, viewport, errors) {
  const context = await browser.newContext({
    hasTouch: viewport.touch,
    viewport: { height: viewport.height, width: viewport.width },
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${viewport.name}: console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`${viewport.name}: pageerror: ${String(error)}`));
  page.on('requestfailed', (request) => errors.push(
    `${viewport.name}: requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`,
  ));
  let touchDriver = null;
  try {
    await page.goto(`${baseUrl}/voxel-game.html?fleet=${viewport.name}-${Date.now()}&job-seed=1`, {
      waitUntil: 'networkidle',
    });
    await page.waitForFunction(() => document.documentElement.dataset.voxelSceneReady === 'true'
      && typeof window.render_game_to_text === 'function'
      && typeof window.select_voxel_game_vehicle === 'function', undefined, { timeout: 10_000 });
    touchDriver = viewport.touch
      ? await createDomTouchStickDriver(page, { pointerId: 81 })
      : null;

    const initial = await readGameState(page);
    assert.deepEqual(initial.vehicleSelection.available, [
      'fire-truck',
      'bulldozer',
      'excavator',
      'ambulance',
    ]);
    assert.equal(initial.vehicleSelection.canSwitch, true);
    const excavatorButton = page.getByRole('button', { name: 'ショベルカーをえらぶ' });
    if (viewport.touch) await excavatorButton.tap();
    else await excavatorButton.click();
    await waitForFrames(page, 4);

    const selected = await readGameState(page);
    assert.equal(selected.vehicle.id, 'excavator', `${viewport.name}: excavator switch failed.`);
    assert.equal(selected.mission.id, 'soil-digging');
    assert.equal(selected.mission.jobId, 'soil-north');
    assert.equal(selected.mission.jobCycle, 1);
    assert.equal(selected.mission.jobSeed, 1);
    assert.equal(selected.mission.progress.current, 0);
    assert.equal(selected.mission.progress.target, 3);
    assert.equal(selected.renderer.vehicleDrawCalls <= 7, true,
      `${viewport.name}: excavator exceeded seven body draw calls.`);
    assert.equal(selected.excavator.targetBodyVoxelCount, 18);
    assert.equal(selected.excavator.targetAccentVoxelCount, 9);
    assert.equal(selected.visuals.actionTargetTargetCubeCount, 27);
    assert.equal(selected.visuals.bulldozerDebrisCubeCount, 0,
      `${viewport.name}: bulldozer debris remained visible for excavator.`);
    assert.deepEqual(
      selected.mission.targetPositions,
      selected.landmarks.excavatorTargets.map(({ position }) => position),
    );
    assert.equal(await excavatorButton.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.primary-action-button').getAttribute('aria-label'),
      'バケットを動かす');
    const layout = await measureFleetHud(page, viewport);
    await page.screenshot({ path: `${outputDirectory}/${viewport.name}-excavator-garage.png` });

    const hubGate = selected.visualLayout.worldSolids.find(({ id }) => id === 'hub-gate-post');
    assert(hubGate, `${viewport.name}: hub gate telemetry is unavailable.`);
    const gateBypassZ = hubGate.position[2] - hubGate.scale[2] / 2 - 4;
    await driveToCoordinate(page, {
      coordinateIndex: 2,
      description: `${viewport.name}: garage gate bypass`,
      target: gateBypassZ,
      tolerance: 0.5,
      touchDriver,
    });

    const targets = [...selected.landmarks.excavatorTargets]
      .sort((left, right) => right.position[0] - left.position[0]);
    assert.equal(targets.length, 3, `${viewport.name}: excavator needs three soil targets.`);
    await driveToCoordinate(page, {
      coordinateIndex: 0,
      description: `${viewport.name}: west road staging`,
      target: targets[0].position[0] + 3.5,
      tolerance: 0.4,
      touchDriver,
    });
    let completed = selected;
    for (const [index, target] of targets.entries()) {
      await driveToCoordinate(page, {
        coordinateIndex: 2,
        description: `${viewport.name}: soil ${index + 1} latitude`,
        target: target.position[2],
        tolerance: 0.24,
        touchDriver,
      });
      const vehicleCenterX = target.position[0] + 1.55;
      await driveAlongWorldAxis(page, {
        axis: 'negativeX',
        description: `${viewport.name}: soil ${index + 1} bucket approach`,
        predicate: (state) => state.vehicle.position[0] <= vehicleCenterX,
        touchDriver,
      });
      completed = await digTarget(page, viewport, index + 1);
      assert.equal(
        completed.excavator.targets.find(({ id }) => id === target.id)?.completed,
        true,
        `${viewport.name}: completed target ${target.id} was not recorded.`,
      );
      if (index === 0) {
        assert(completed.excavator.activeParticleCount > 0,
          `${viewport.name}: first soil completion emitted no voxel particles.`);
        await page.screenshot({ path: `${outputDirectory}/${viewport.name}-excavator-worksite.png` });
      }
    }
    assert.equal(completed.excavator.completedCount, 3);
    assert.equal(completed.excavator.targetBodyVoxelCount, 0);
    assert(['celebrating', 'freeRoam'].includes(completed.mission.phase),
      `${viewport.name}: excavator completion phase is ${completed.mission.phase}.`);
    assert.equal(completed.fire.intensity, 1,
      `${viewport.name}: excavator action changed fire intensity.`);
    assert.equal(completed.visuals.waterCubeCount, 0,
      `${viewport.name}: excavator action emitted water.`);

    await page.evaluate(() => window.advanceTime?.(1_800));
    await waitForFrames(page, 2);
    assert.equal((await readGameState(page)).mission.phase, 'freeRoam');
    await driveToCoordinate(page, {
      coordinateIndex: 2,
      description: `${viewport.name}: return south block road`,
      target: 17.5,
      tolerance: 0.5,
      touchDriver,
    });
    await driveToCoordinate(page, {
      coordinateIndex: 0,
      description: `${viewport.name}: return west staging`,
      target: -14,
      tolerance: 0.6,
      touchDriver,
    });
    await driveToCoordinate(page, {
      coordinateIndex: 2,
      description: `${viewport.name}: return gate bypass`,
      target: gateBypassZ,
      tolerance: 0.5,
      touchDriver,
    });
    await driveToCoordinate(page, {
      coordinateIndex: 0,
      description: `${viewport.name}: return hub`,
      target: 0,
      tolerance: 0.6,
      touchDriver,
    });
    await driveToCoordinate(page, {
      coordinateIndex: 2,
      description: `${viewport.name}: return garage`,
      target: 6,
      tolerance: 0.6,
      touchDriver,
    });
    await waitForFrames(page, 5);
    const restarted = await readGameState(page);
    assert.equal(restarted.mission.phase, 'assigned');
    assert.equal(restarted.mission.jobCycle, 2);
    assert.notEqual(restarted.mission.jobId, selected.mission.jobId);
    assert.equal(restarted.excavator.completedCount, 0);
    assert.equal(restarted.vehicleSelection.canSwitch, true);

    const ambulanceButton = page.getByRole('button', { name: 'きゅうきゅうしゃをえらぶ' });
    if (viewport.touch) await ambulanceButton.tap();
    else await ambulanceButton.click();
    await waitForFrames(page, 4);

    const ambulanceSelected = await readGameState(page);
    assert.equal(ambulanceSelected.vehicle.id, 'ambulance',
      `${viewport.name}: ambulance switch failed.`);
    assert.equal(ambulanceSelected.mission.id, 'patient-care');
    assert.equal(ambulanceSelected.mission.jobId, 'patient-pond');
    assert.equal(ambulanceSelected.mission.jobCycle, 1);
    assert.equal(ambulanceSelected.mission.progress.current, 0);
    assert.equal(ambulanceSelected.mission.progress.target, 1);
    assert.equal(ambulanceSelected.renderer.vehicleDrawCalls <= 7, true,
      `${viewport.name}: ambulance exceeded seven body draw calls.`);
    assert.equal(ambulanceSelected.ambulance.targetBodyVoxelCount, 6);
    assert.equal(ambulanceSelected.ambulance.targetAccentVoxelCount, 3);
    assert.equal(ambulanceSelected.excavator.targetBodyVoxelCount, 0);
    assert.equal(ambulanceSelected.visuals.actionTargetTargetCubeCount, 9);
    assert.deepEqual(
      ambulanceSelected.mission.targetPositions,
      ambulanceSelected.landmarks.ambulanceTargets.map(({ position }) => position),
    );
    assert.equal(await ambulanceButton.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.primary-action-button').getAttribute('aria-label'),
      '手当てをする');
    const ambulanceLayout = await measureFleetHud(page, viewport);
    await page.screenshot({ path: `${outputDirectory}/${viewport.name}-ambulance-garage.png` });

    const [patient] = ambulanceSelected.landmarks.ambulanceTargets;
    assert(patient, `${viewport.name}: ambulance patient target is unavailable.`);
    await driveToCoordinate(page, {
      coordinateIndex: 2,
      description: `${viewport.name}: ambulance park entrance`,
      target: -18,
      tolerance: 0.4,
      touchDriver,
    });
    await page.screenshot({ path: `${outputDirectory}/${viewport.name}-ambulance-patient-before.png` });
    await driveToCoordinate(page, {
      coordinateIndex: 0,
      description: `${viewport.name}: ambulance patient lane`,
      target: patient.position[0],
      tolerance: 0.28,
      touchDriver,
    });
    await driveToCoordinate(page, {
      coordinateIndex: 2,
      description: `${viewport.name}: ambulance patient approach`,
      target: patient.position[2],
      tolerance: 0.28,
      touchDriver,
    });
    await driveToCoordinate(page, {
      coordinateIndex: 0,
      description: `${viewport.name}: ambulance park beside patient`,
      target: patient.position[0] + 2.1,
      tolerance: 0.15,
      touchDriver,
    });
    const patientCompleted = await careForPatient(page, viewport);
    assert.equal(patientCompleted.ambulance.targets[0]?.completed, true);
    assert.equal(patientCompleted.ambulance.targetBodyVoxelCount, 6,
      `${viewport.name}: cared patient should remain visible.`);
    assert(patientCompleted.ambulance.activeParticleCount > 0,
      `${viewport.name}: patient completion emitted no care particles.`);
    assert(['celebrating', 'freeRoam'].includes(patientCompleted.mission.phase),
      `${viewport.name}: ambulance completion phase is ${patientCompleted.mission.phase}.`);
    await driveToCoordinate(page, {
      coordinateIndex: 0,
      description: `${viewport.name}: reveal cared patient`,
      target: -6,
      tolerance: 0.4,
      touchDriver,
    });
    const patientRevealed = await readGameState(page);
    assert.equal(patientRevealed.ambulance.targetBodyVoxelCount, 6,
      `${viewport.name}: cared patient disappeared after ambulance moved away.`);
    await page.screenshot({ path: `${outputDirectory}/${viewport.name}-ambulance-worksite.png` });

    await page.evaluate(() => window.advanceTime?.(1_800));
    await waitForFrames(page, 2);
    assert.equal((await readGameState(page)).mission.phase, 'freeRoam');
    await driveToCoordinate(page, {
      coordinateIndex: 0,
      description: `${viewport.name}: ambulance enter west return road`,
      target: -10,
      tolerance: 0.5,
      touchDriver,
    });
    await driveToCoordinate(page, {
      coordinateIndex: 2,
      description: `${viewport.name}: ambulance reverse patient lane`,
      target: -16,
      tolerance: 0.5,
      touchDriver,
    });
    await driveToCoordinate(page, {
      coordinateIndex: 0,
      description: `${viewport.name}: ambulance leave park lane`,
      target: 0,
      tolerance: 0.5,
      touchDriver,
    });
    for (const returnZ of [-12, -6, 0]) {
      await driveToCoordinate(page, {
        coordinateIndex: 2,
        description: `${viewport.name}: ambulance return marker ${returnZ}`,
        target: returnZ,
        tolerance: 0.5,
        touchDriver,
      });
      await driveToCoordinate(page, {
        coordinateIndex: 0,
        description: `${viewport.name}: ambulance recenter at ${returnZ}`,
        target: 0,
        tolerance: 0.5,
        touchDriver,
      });
    }
    await driveToCoordinate(page, {
      coordinateIndex: 2,
      description: `${viewport.name}: ambulance return garage entrance`,
      target: 3,
      tolerance: 0.4,
      touchDriver,
    });
    await driveToCoordinate(page, {
      coordinateIndex: 0,
      description: `${viewport.name}: ambulance center garage entrance`,
      target: 0,
      tolerance: 0.4,
      touchDriver,
    });
    await driveToCoordinate(page, {
      coordinateIndex: 2,
      description: `${viewport.name}: ambulance enter garage`,
      target: 6,
      tolerance: 0.5,
      touchDriver,
    });
    await waitForFrames(page, 5);
    const ambulanceRestarted = await readGameState(page);
    assert.equal(ambulanceRestarted.mission.phase, 'assigned');
    assert.equal(ambulanceRestarted.mission.jobCycle, 2);
    assert.notEqual(ambulanceRestarted.mission.jobId, ambulanceSelected.mission.jobId);
    assert.equal(ambulanceRestarted.ambulance.completedCount, 0);
    assert.equal(ambulanceRestarted.vehicleSelection.canSwitch, true);

    return {
      ambulance: {
        completedJobId: patientCompleted.mission.jobId,
        layout: ambulanceLayout,
        nextJobId: ambulanceRestarted.mission.jobId,
      },
      completedJobId: completed.mission.jobId,
      layout,
      nextJobId: restarted.mission.jobId,
      rendererCalls: restarted.renderer.rendererCalls,
      vehicleDrawCalls: restarted.renderer.vehicleDrawCalls,
      viewport: viewport.name,
    };
  } finally {
    if (touchDriver) await touchDriver.releaseStick();
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
const errors = [];
const results = [];
try {
  for (const viewport of viewports) {
    results.push(await verifyExcavatorViewport(browser, viewport, errors));
  }
  assert.deepEqual(errors, [], `browser errors: ${JSON.stringify(errors, null, 2)}`);
  const manifest = {
    generatedAt: new Date().toISOString(),
    note: 'Docker renderer measurements are diagnostic only and are not physical GPU certification.',
    results,
    screenshots: viewports.flatMap(({ name }) => [
      `${name}-excavator-garage.png`,
      `${name}-excavator-worksite.png`,
      `${name}-ambulance-garage.png`,
      `${name}-ambulance-patient-before.png`,
      `${name}-ambulance-worksite.png`,
    ]),
    viewports,
  };
  fs.writeFileSync(`${outputDirectory}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  await browser.close();
}

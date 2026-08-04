import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import {
  createDomTouchStickDriver,
  readGameState,
  waitForFrames,
} from './voxel-game-e2e/drive-harness.mjs';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:4173';
const outputDirectory = process.env.VOXEL_GAME_AUDIO_OUTPUT_DIRECTORY
  ?? 'output/voxel-game-audio';
const viewports = [
  { height: 720, name: 'desktop', touch: false, width: 1_280 },
  { height: 768, name: 'tablet', touch: true, width: 1_024 },
  { height: 390, name: 'mobile-landscape', touch: true, width: 844 },
];
const actionKinds = [
  ['fire-truck', 'water'],
  ['bulldozer', 'blade'],
  ['excavator', 'bucket'],
  ['ambulance', 'care'],
  ['police', 'siren'],
];

fs.mkdirSync(outputDirectory, { recursive: true });

/** Playwright矩形を右端・下端つきへ変換する。 */
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

/** 非交差矩形間の最短距離を返す。 */
function rectDistance(left, right) {
  const horizontal = Math.max(left.left - right.right, right.left - left.right, 0);
  const vertical = Math.max(left.top - right.bottom, right.top - left.bottom, 0);
  return Math.hypot(horizontal, vertical);
}

/** 右上音ボタンと既存HUDのanchor、安全余白、内部収まりを実寸検証する。 */
async function measureAudioHud(page, viewport) {
  const selectors = {
    action: '.primary-action-button',
    audio: '.audio-toggle-button',
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
    assert(
      box.left >= 0 && box.top >= 0
      && box.right <= viewport.width && box.bottom <= viewport.height,
      `${viewport.name}: ${name} exceeds viewport: ${JSON.stringify(box)}.`,
    );
  }
  for (const [leftName, rightName] of [
    ['fullscreen', 'audio'],
    ['audio', 'mission'],
    ['audio', 'selector'],
    ['audio', 'action'],
    ['audio', 'joystick'],
    ['selector', 'mission'],
    ['joystick', 'action'],
  ]) {
    assert(
      rectDistance(boxes[leftName], boxes[rightName]) >= 8,
      `${viewport.name}: ${leftName}/${rightName} lack 8px safety gap: ${JSON.stringify(boxes)}.`,
    );
  }
  assert.equal(boxes.audio.right, boxes.fullscreen.right,
    `${viewport.name}: audio/fullscreen right anchors differ.`);
  assert(boxes.audio.top - boxes.fullscreen.bottom >= 8,
    `${viewport.name}: audio is less than 8px below fullscreen.`);

  const audioChildren = await page.locator('.audio-toggle-button > span').evaluateAll((children) => (
    children.map((child) => {
      const rect = child.getBoundingClientRect();
      return { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top };
    })
  ));
  assert.equal(audioChildren.length, 2, `${viewport.name}: audio button must have two children.`);
  for (const child of audioChildren) {
    assert(
      child.left >= boxes.audio.left && child.top >= boxes.audio.top
      && child.right <= boxes.audio.right && child.bottom <= boxes.audio.bottom,
      `${viewport.name}: audio child exceeds button: ${JSON.stringify({ child, parent: boxes.audio })}.`,
    );
  }
  return { audioChildren, boxes };
}

/** keyboardまたはtouch主操作を同じcommandへ同期する。 */
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
    pointerId: 91,
    pointerType: 'touch',
  });
}

/** 指定viewportでactual AudioContext、5車種mix、HUD配置を検証する。 */
async function verifyViewport(browser, viewport, errors) {
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
    await page.goto(`${baseUrl}/?audio=${viewport.name}-${Date.now()}&job-seed=1`, {
      waitUntil: 'networkidle',
    });
    await page.waitForFunction(() => document.documentElement.dataset.voxelSceneReady === 'true'
      && typeof window.render_game_to_text === 'function', undefined, { timeout: 12_000 });
    const initial = await readGameState(page, ['audio', 'controls', 'vehicle', 'vehicleSelection']);
    assert.deepEqual(initial.audio, {
      actionAttackGain: 0,
      actionGain: 0,
      actionKind: 'water',
      activeVehicleId: 'fire-truck',
      available: true,
      bgmGain: 0,
      bgmStep: initial.audio.bgmStep,
      contextState: 'locked',
      cueCount: 0,
      enabled: false,
      engineGain: 0,
      lastCue: null,
      noiseGain: 0,
      targetActionGain: 0,
      vibrationCount: 0,
    });
    assert(Number.isInteger(initial.audio.bgmStep));
    const button = page.getByRole('button', { name: 'おとと振動をオンにする' });
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    assert.equal(await button.isEnabled(), true);
    const layout = await measureAudioHud(page, viewport);
    await page.screenshot({ path: `${outputDirectory}/${viewport.name}-audio-off.png` });

    if (viewport.touch) await button.tap();
    else await button.click();
    await page.waitForFunction(() => {
      const rendered = window.render_game_to_text?.();
      if (!rendered) return false;
      const { audio } = JSON.parse(rendered);
      return audio.enabled === true && audio.contextState === 'running';
    }, undefined, { timeout: 5_000 });
    const enabled = await readGameState(page);
    assert(enabled.audio.bgmGain > 0, `${viewport.name}: BGM gain remained zero.`);
    assert(enabled.audio.engineGain > 0, `${viewport.name}: idle engine gain remained zero.`);
    assert.equal(enabled.audio.actionGain, 0);
    assert.equal(enabled.audio.actionAttackGain, 0);
    assert.equal(enabled.audio.noiseGain, 0);
    assert.equal(enabled.audio.targetActionGain, 0);
    assert.equal(await page.locator('.audio-toggle-button').getAttribute('data-enabled'), 'true');
    assert.equal(await page.getByRole('button', { name: 'おとと振動をオフにする' })
      .getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: `${outputDirectory}/${viewport.name}-audio-on.png` });

    const actionSamples = [];
    for (const [vehicleId, actionKind] of actionKinds) {
      if ((await readGameState(page)).vehicle.id !== vehicleId) {
        const vehicleButton = page.locator(`.vehicle-selector__button[data-vehicle="${vehicleId}"]`);
        if (viewport.touch) await vehicleButton.tap();
        else await vehicleButton.click();
        await waitForFrames(page, 4);
      }
      await setPrimaryAction(page, viewport.touch, true);
      let active = null;
      for (let frame = 0; frame < 8; frame += 1) {
        await waitForFrames(page, 1);
        const sample = await readGameState(page);
        if (sample.audio.actionAttackGain > 0) {
          active = sample;
          break;
        }
      }
      assert(active, `${viewport.name}: ${vehicleId} press attack frame was not observed.`);
      assert.equal(active.audio.activeVehicleId, vehicleId);
      assert.equal(active.audio.actionKind, actionKind);
      assert(active.audio.actionAttackGain > 0,
        `${viewport.name}: ${vehicleId} emitted no press attack.`);
      assert.equal(active.audio.targetActionGain, 0,
        `${viewport.name}: ${vehicleId} emitted target gain away from a target.`);
      assert(active.audio.actionGain + active.audio.noiseGain > 0,
        `${viewport.name}: ${vehicleId} emitted no action mix.`);
      actionSamples.push({
        actionAttackGain: active.audio.actionAttackGain,
        actionGain: active.audio.actionGain,
        actionKind: active.audio.actionKind,
        noiseGain: active.audio.noiseGain,
        vehicleId,
      });
      await setPrimaryAction(page, viewport.touch, false);
      await waitForFrames(page, 12);
      const released = await readGameState(page);
      assert.equal(released.audio.actionGain + released.audio.noiseGain, 0,
        `${viewport.name}: ${vehicleId} action mix remained active after release.`);
      assert.equal(released.audio.actionAttackGain, 0,
        `${viewport.name}: ${vehicleId} press attack exceeded 140ms.`);
    }
    const afterVehicles = await readGameState(page);
    assert.equal(afterVehicles.audio.cueCount, 4,
      `${viewport.name}: four vehicle switch cues were not emitted.`);
    assert.equal(afterVehicles.audio.lastCue, 'vehicle-switch');

    const idleEngineGain = afterVehicles.audio.engineGain;
    if (viewport.touch) {
      touchDriver = await createDomTouchStickDriver(page, { pointerId: 92 });
      await touchDriver.setStick(0, -1);
    } else {
      await page.keyboard.down('KeyW');
    }
    await waitForFrames(page, 36);
    const moving = await readGameState(page);
    if (touchDriver) await touchDriver.releaseStick();
    else await page.keyboard.up('KeyW');
    assert(moving.vehicle.speed > 1,
      `${viewport.name}: vehicle did not reach audible driving speed: ${moving.vehicle.speed}.`);
    assert(moving.audio.engineGain > idleEngineGain,
      `${viewport.name}: engine gain did not increase with speed.`);

    const offButton = page.getByRole('button', { name: 'おとと振動をオフにする' });
    if (viewport.touch) await offButton.tap();
    else await offButton.click();
    await page.waitForFunction(() => {
      const rendered = window.render_game_to_text?.();
      if (!rendered) return false;
      const { audio } = JSON.parse(rendered);
      return audio.enabled === false && audio.contextState === 'suspended';
    }, undefined, { timeout: 5_000 });
    const disabled = await readGameState(page);
    assert.equal(disabled.audio.bgmGain, 0);
    assert.equal(disabled.audio.engineGain, 0);
    assert.equal(disabled.audio.actionGain, 0);
    assert.equal(disabled.audio.actionAttackGain, 0);
    assert.equal(disabled.audio.noiseGain, 0);
    assert.equal(disabled.audio.targetActionGain, 0);

    return {
      actionSamples,
      cueCount: afterVehicles.audio.cueCount,
      idleEngineGain,
      layout,
      movingEngineGain: moving.audio.engineGain,
      movingSpeed: moving.vehicle.speed,
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
  for (const viewport of viewports) results.push(await verifyViewport(browser, viewport, errors));
  assert.deepEqual(errors, [], `browser errors: ${JSON.stringify(errors, null, 2)}`);
  const manifest = {
    baseUrl,
    generatedAt: new Date().toISOString(),
    note: 'Audio is verified through actual AudioContext lifecycle and deterministic telemetry; screenshots do not prove audible output.',
    results,
    screenshots: viewports.flatMap(({ name }) => [
      `${name}-audio-off.png`,
      `${name}-audio-on.png`,
    ]),
    viewports,
  };
  fs.writeFileSync(`${outputDirectory}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  await browser.close();
}

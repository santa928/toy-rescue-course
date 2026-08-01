import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WORLD_AXIS_INPUTS,
  calculatePulseFrameCount,
  createDomTouchStickDriver,
  createDriveHarness,
  readGameState,
  releaseKeyboardKeys,
  syncKeyboardKeys,
} from './drive-harness.mjs';

/** keyboard event列だけを記録する最小fake pageを作る。 */
function createKeyboardPage() {
  const events = [];
  return {
    events,
    keyboard: {
      async down(key) { events.push(['down', key]); },
      async up(key) { events.push(['up', key]); },
    },
  };
}

test('world cardinal方向を既存keyboardとstick入力へ固定する', () => {
  assert.deepEqual(WORLD_AXIS_INPUTS, {
    negativeX: { keys: ['KeyA', 'KeyW'], stick: [-0.803, -0.595] },
    negativeZ: { keys: ['KeyD', 'KeyW'], stick: [0.595, -0.803] },
    positiveX: { keys: ['KeyD', 'KeyS'], stick: [0.803, 0.595] },
    positiveZ: { keys: ['KeyA', 'KeyS'], stick: [-0.595, 0.803] },
  });
});

test('距離を1〜7 frameの既存pulse式へ変換する', () => {
  assert.equal(calculatePulseFrameCount(0.1, 1.4), 1);
  assert.equal(calculatePulseFrameCount(3, 1.4), 5);
  assert.equal(calculatePulseFrameCount(-20, 1.5), 7);
  assert.throws(() => calculatePulseFrameCount(Number.NaN, 1.4), /finite/);
});

test('公開text hookをparseしrequired fields欠落を拒否する', async () => {
  const completePage = {
    async evaluate() { return JSON.stringify({ controls: {}, vehicle: {}, world: {} }); },
  };
  assert.deepEqual(
    await readGameState(completePage, ['controls', 'vehicle', 'world']),
    { controls: {}, vehicle: {}, world: {} },
  );

  const incompletePage = {
    async evaluate() { return JSON.stringify({ vehicle: {}, world: {} }); },
  };
  await assert.rejects(
    readGameState(incompletePage, ['controls', 'vehicle', 'world']),
    /controls/,
  );
});

test('keyboard集合の差分同期と全解除を保証する', async () => {
  const page = createKeyboardPage();
  const heldKeys = new Set(['KeyA', 'KeyW']);
  await syncKeyboardKeys(page, heldKeys, ['KeyD', 'KeyW']);
  assert.deepEqual(page.events, [['up', 'KeyA'], ['down', 'KeyD']]);
  assert.deepEqual([...heldKeys].sort(), ['KeyD', 'KeyW']);

  await releaseKeyboardKeys(page, heldKeys);
  assert.deepEqual(page.events.slice(2), [['up', 'KeyD'], ['up', 'KeyW']]);
  assert.equal(heldKeys.size, 0);
});

test('DOM touch stickをdown、move、upしpointer identityを維持する', async () => {
  const events = [];
  const joystick = {
    async boundingBox() { return { height: 100, width: 120, x: 10, y: 20 }; },
    async dispatchEvent(type, init) { events.push({ init, type }); },
  };
  const page = { locator: () => joystick };
  const driver = await createDomTouchStickDriver(page, { pointerId: 81 });
  await driver.setStick(1, 0);
  await driver.releaseStick();

  assert.deepEqual(events.map(({ type }) => type), ['pointerdown', 'pointermove', 'pointerup']);
  assert(events.every(({ init }) => init.pointerId === 81 && init.pointerType === 'touch'));
  assert.equal(events[1].init.clientX, 10 + 60 + 38);
});

test('走行中resetを伝播しtouch入力をfinallyで解除する', async () => {
  const states = [
    { vehicle: { position: [0, 0, 0], resetCount: 2, speed: 0 } },
    { vehicle: { position: [0, 0, -1], resetCount: 3, speed: 1 } },
  ];
  const touchEvents = [];
  const harness = createDriveHarness({
    frameWaiter: async () => {},
    requiredFields: ['vehicle'],
    sampleBeforeBurst: false,
    stateReader: async () => states.shift(),
  });
  const touchDriver = {
    async releaseStick() { touchEvents.push('release'); },
    async setStick(...stick) { touchEvents.push(['set', ...stick]); },
  };

  await assert.rejects(
    harness.driveAlongWorldAxis({}, {
      axis: 'negativeZ',
      description: 'reset propagation',
      maxBursts: 1,
      predicate: () => false,
      touchDriver,
    }),
    /reset unexpectedly/,
  );
  assert.deepEqual(touchEvents, [['set', 0.595, -0.803], 'release']);
});

test('座標合わせはX/Z以外と非finite targetを入力前に拒否する', async () => {
  const harness = createDriveHarness({
    frameWaiter: async () => {},
    requiredFields: ['vehicle'],
    stateReader: async () => ({ vehicle: { position: [0, 0, 0], resetCount: 0, speed: 0 } }),
  });
  await assert.rejects(
    harness.alignWorldCoordinate({}, { coordinateIndex: 1, description: 'Y', target: 0 }),
    /X\/Z/,
  );
  await assert.rejects(
    harness.alignWorldCoordinate({}, { coordinateIndex: 0, description: 'NaN', target: Number.NaN }),
    /finite/,
  );
});

test('精密座標合わせは正方向1frame後に逆入力で能動制動する', async () => {
  const states = [
    { vehicle: { position: [0, 0, 0], resetCount: 0, speed: 0 } },
    { vehicle: { position: [0, 0, 0], resetCount: 0, speed: 0 } },
    { vehicle: { position: [0.5, 0, 0], resetCount: 0, speed: 0 } },
    { vehicle: { position: [0.5, 0, 0], resetCount: 0, speed: 0 } },
  ];
  const touchEvents = [];
  const harness = createDriveHarness({
    frameWaiter: async () => {},
    requiredFields: ['vehicle'],
    stateReader: async () => states.shift(),
  });
  const touchDriver = {
    async releaseStick() { touchEvents.push('release'); },
    async setStick(...stick) { touchEvents.push(['set', ...stick]); },
  };

  const aligned = await harness.alignWorldCoordinate({}, {
    coordinateIndex: 0,
    description: 'precision X',
    precisionCounterPulse: true,
    target: 0.5,
    tolerance: 0.1,
    touchDriver,
  });

  assert.equal(aligned.vehicle.position[0], 0.5);
  assert.deepEqual(touchEvents, [
    ['set', ...WORLD_AXIS_INPUTS.positiveX.stick],
    'release',
    ['set', ...WORLD_AXIS_INPUTS.negativeX.stick],
    'release',
  ]);
});

import assert from 'node:assert/strict';

export const WORLD_AXIS_INPUTS = Object.freeze({
  negativeX: Object.freeze({ keys: Object.freeze(['KeyA', 'KeyW']), stick: Object.freeze([-0.803, -0.595]) }),
  negativeZ: Object.freeze({ keys: Object.freeze(['KeyD', 'KeyW']), stick: Object.freeze([0.595, -0.803]) }),
  positiveX: Object.freeze({ keys: Object.freeze(['KeyD', 'KeyS']), stick: Object.freeze([0.803, 0.595]) }),
  positiveZ: Object.freeze({ keys: Object.freeze(['KeyA', 'KeyS']), stick: Object.freeze([-0.595, 0.803]) }),
});
const OPPOSITE_WORLD_AXIS = Object.freeze({
  negativeX: 'positiveX',
  negativeZ: 'positiveZ',
  positiveX: 'negativeX',
  positiveZ: 'negativeZ',
});

/** 距離と既存係数を1〜7 frameの安全なcardinal pulseへ変換する。 */
export function calculatePulseFrameCount(delta, multiplier) {
  assert(Number.isFinite(delta), 'pulse delta must be finite.');
  assert(Number.isFinite(multiplier) && multiplier > 0, 'pulse multiplier must be finite and positive.');
  return Math.max(1, Math.min(7, Math.ceil(Math.abs(delta) * multiplier)));
}

/** R3F/Rapierを通常clockで指定frame数進める。 */
export async function waitForFrames(page, frameCount) {
  assert(Number.isInteger(frameCount) && frameCount > 0, 'frameCount must be a positive integer.');
  await page.evaluate((count) => new Promise((resolve) => {
    let remaining = count;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), frameCount);
}

/** 公開text hookをparseし、scenarioが要求するtop-level telemetryを検証する。 */
export async function readGameState(page, requiredFields = []) {
  const rendered = await page.evaluate(() => window.render_game_to_text?.());
  assert(rendered, 'render_game_to_text is unavailable.');
  const state = JSON.parse(rendered);
  for (const field of requiredFields) {
    assert(Object.hasOwn(state, field), `text state lacks ${field}.`);
  }
  return state;
}

/** 押下中keyboard集合を次のscreen方向へ差分同期する。 */
export async function syncKeyboardKeys(page, heldKeys, nextKeys) {
  const next = new Set(nextKeys);
  for (const key of heldKeys) {
    if (!next.has(key)) await page.keyboard.up(key);
  }
  for (const key of next) {
    if (!heldKeys.has(key)) await page.keyboard.down(key);
  }
  heldKeys.clear();
  for (const key of next) heldKeys.add(key);
}

/** keyboard集合を必ず全解除する。 */
export async function releaseKeyboardKeys(page, heldKeys) {
  for (const key of heldKeys) await page.keyboard.up(key);
  heldKeys.clear();
}

/** Playwright DOM pointer eventでstickを操作するtouch driverを作る。 */
export async function createDomTouchStickDriver(page, options = {}) {
  const {
    pointerId = 71,
    radiusRatio = 0.38,
    selector = '.touch-joystick',
  } = options;
  assert(Number.isInteger(pointerId) && pointerId > 0, 'touch pointerId must be a positive integer.');
  assert(Number.isFinite(radiusRatio) && radiusRatio > 0 && radiusRatio <= 0.5,
    'touch radiusRatio must be within (0, 0.5].');
  const joystick = page.locator(selector);
  const box = await joystick.boundingBox();
  assert(box, 'touch joystick bounding box is unavailable.');
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const radius = Math.min(box.width, box.height) * radiusRatio;
  let active = false;

  return {
    async releaseStick() {
      if (!active) return;
      await joystick.dispatchEvent('pointerup', {
        button: 0,
        clientX: center.x,
        clientY: center.y,
        pointerId,
        pointerType: 'touch',
      });
      active = false;
    },
    async setStick(x, y) {
      assert(Number.isFinite(x) && Number.isFinite(y), 'touch stick coordinates must be finite.');
      const length = Math.hypot(x, y) || 1;
      if (!active) {
        await joystick.dispatchEvent('pointerdown', {
          button: 0,
          clientX: center.x,
          clientY: center.y,
          pointerId,
          pointerType: 'touch',
        });
        active = true;
      }
      await joystick.dispatchEvent('pointermove', {
        button: 0,
        clientX: center.x + x / length * radius,
        clientY: center.y + y / length * radius,
        pointerId,
        pointerType: 'touch',
      });
    },
  };
}

/** E2Eごとの既存閾値を束ね、共通走行APIへ依存注入する。 */
export function createDriveHarness(options = {}) {
  const {
    alignAttemptLimit = 28,
    brakeFrameLimit = 180,
    brakeSpeedThreshold = 0.24,
    defaultMaxBursts = 360,
    frameWaiter = waitForFrames,
    pulseDistanceMultiplier = 1.4,
    requiredFields = [],
    resetContext: defaultResetContext = null,
    sampleBeforeBurst = false,
    stateReader = (page) => readGameState(page, requiredFields),
  } = options;
  assert(Number.isInteger(alignAttemptLimit) && alignAttemptLimit > 0,
    'alignAttemptLimit must be a positive integer.');
  assert(Number.isInteger(brakeFrameLimit) && brakeFrameLimit > 0,
    'brakeFrameLimit must be a positive integer.');
  assert(Number.isInteger(defaultMaxBursts) && defaultMaxBursts > 0,
    'defaultMaxBursts must be a positive integer.');

  /** factoryへ束縛したstate readerで現在snapshotを読む。 */
  async function readState(page) {
    const state = await stateReader(page);
    assert(state && typeof state === 'object', 'stateReader returned no state.');
    return state;
  }

  /** 入力を離した自然減速を既存speed閾値まで待つ。 */
  async function brakeVehicle(page, brakeOptions = {}) {
    const frameLimit = brakeOptions.frameLimit ?? brakeFrameLimit;
    for (let frame = 0; frame < frameLimit; frame += 1) {
      await frameWaiter(page, 1);
      if ((await readState(page)).vehicle.speed < brakeSpeedThreshold) return;
    }
    throw new Error(`vehicle did not stop within ${frameLimit} frames.`);
  }

  /** keyboardまたはtouchのworld cardinal入力を開始する。 */
  async function startAxisInput(page, axis, heldKeys, touchDriver, description) {
    const input = WORLD_AXIS_INPUTS[axis];
    assert(input, `${description}: unknown world axis ${axis}.`);
    if (touchDriver) await touchDriver.setStick(...input.stick);
    else await syncKeyboardKeys(page, heldKeys, input.keys);
    return input;
  }

  /** keyboardまたはtouchの現在入力を一度だけ解除する。 */
  async function stopAxisInput(page, heldKeys, touchDriver) {
    if (touchDriver) await touchDriver.releaseStick();
    await releaseKeyboardKeys(page, heldKeys);
  }

  /** world cardinal入力でtelemetry predicateまで走り、resetとcleanupを監視する。 */
  async function driveAlongWorldAxis(page, driveOptions) {
    const {
      axis,
      brakeAfterArrival = true,
      description,
      maxBursts = defaultMaxBursts,
      predicate,
      resetContext = defaultResetContext,
      touchDriver = null,
    } = driveOptions;
    assert(typeof predicate === 'function', `${description}: predicate must be a function.`);
    assert(Number.isInteger(maxBursts) && maxBursts > 0,
      `${description}: maxBursts must be a positive integer.`);
    const initialState = await readState(page);
    const initialResetCount = initialState.vehicle.resetCount;
    const heldKeys = new Set();
    let arrived = null;
    let latest = null;
    let previous = null;
    try {
      await startAxisInput(page, axis, heldKeys, touchDriver, description);
      for (let burst = 0; burst < maxBursts; burst += 1) {
        if (!sampleBeforeBurst) await frameWaiter(page, 2);
        latest = await readState(page);
        if (predicate(latest)) {
          arrived = latest;
          break;
        }
        const diagnostic = resetContext
          ? resetContext(latest, previous)
          : { current: latest.vehicle, previous: previous?.vehicle };
        assert.equal(
          latest.vehicle.resetCount,
          initialResetCount,
          `${description}: vehicle reset unexpectedly: ${JSON.stringify(diagnostic)}.`,
        );
        previous = latest;
        if (sampleBeforeBurst) await frameWaiter(page, 2);
      }
    } finally {
      await stopAxisInput(page, heldKeys, touchDriver);
    }
    if (!arrived) {
      throw new Error(`${description}: destination was not reached: ${JSON.stringify({
        controls: latest?.controls,
        vehicle: latest?.vehicle,
      })}.`);
    }
    if (brakeAfterArrival) await brakeVehicle(page);
    return readState(page);
  }

  /** world cardinal方向へ短いpulseを入れ、入力cleanup後に停止する。 */
  async function pulseWorldAxis(page, pulseOptions) {
    const {
      axis,
      brakeAfterPulse = true,
      description = 'world-axis pulse',
      frameCount,
      touchDriver = null,
    } = pulseOptions;
    assert(Number.isInteger(frameCount) && frameCount > 0,
      `${description}: frameCount must be a positive integer.`);
    const heldKeys = new Set();
    try {
      await startAxisInput(page, axis, heldKeys, touchDriver, description);
      await frameWaiter(page, frameCount);
    } finally {
      await stopAxisInput(page, heldKeys, touchDriver);
    }
    if (brakeAfterPulse) await brakeVehicle(page);
  }

  /** 短いcardinal pulseを反復し、目標を跨いだ後は1frameへ縮めてworld X/Zを揃える。 */
  async function alignWorldCoordinate(page, alignOptions) {
    const {
      attempts = alignAttemptLimit,
      coordinateIndex,
      description,
      multiplier = pulseDistanceMultiplier,
      precisionCounterPulse = false,
      precisionCounterPulseThreshold = 0.6,
      precisionNudgeFrameCount = 1,
      target,
      tolerance = 0.4,
      touchDriver = null,
    } = alignOptions;
    assert(coordinateIndex === 0 || coordinateIndex === 2,
      `${description}: only X/Z coordinates can be aligned.`);
    assert(Number.isFinite(target), `${description}: target must be finite.`);
    assert(Number.isFinite(tolerance) && tolerance >= 0,
      `${description}: tolerance must be finite and non-negative.`);
    assert(Number.isFinite(precisionCounterPulseThreshold) && precisionCounterPulseThreshold > 0,
      `${description}: precision counter-pulse threshold must be finite and positive.`);
    assert(Number.isInteger(precisionNudgeFrameCount) && precisionNudgeFrameCount > 0,
      `${description}: precision nudge frame count must be a positive integer.`);
    const positiveAxis = coordinateIndex === 0 ? 'positiveX' : 'positiveZ';
    const negativeAxis = coordinateIndex === 0 ? 'negativeX' : 'negativeZ';
    const initialResetCount = (await readState(page)).vehicle.resetCount;
    let latest = null;
    let previousDelta = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      latest = await readState(page);
      const actual = latest.vehicle.position[coordinateIndex];
      assert(Number.isFinite(actual), `${description}: actual coordinate must be finite.`);
      const delta = target - actual;
      if (Math.abs(delta) <= tolerance) return latest;
      assert.equal(latest.vehicle.resetCount, initialResetCount,
        `${description}: vehicle reset unexpectedly.`);
      const correctionAxis = delta > 0 ? positiveAxis : negativeAxis;
      const crossedTarget = previousDelta !== null && delta * previousDelta < 0;
      if (precisionCounterPulse && Math.abs(delta) <= precisionCounterPulseThreshold) {
        await pulseWorldAxis(page, {
          axis: correctionAxis,
          brakeAfterPulse: false,
          description: `${description} precision nudge`,
          frameCount: precisionNudgeFrameCount,
          touchDriver,
        });
        await pulseWorldAxis(page, {
          axis: OPPOSITE_WORLD_AXIS[correctionAxis],
          description: `${description} precision counter-brake`,
          frameCount: 1,
          touchDriver,
        });
      } else {
        await pulseWorldAxis(page, {
          axis: correctionAxis,
          description,
          frameCount: crossedTarget ? 1 : calculatePulseFrameCount(delta, multiplier),
          touchDriver,
        });
      }
      previousDelta = delta;
    }
    throw new Error(`${description}: coordinate did not align: ${JSON.stringify({
      actual: latest?.vehicle.position[coordinateIndex],
      target,
    })}.`);
  }

  /** 粗いcardinal走行後に座標をpulseで正確に揃える。 */
  async function driveToCoordinate(page, driveOptions) {
    const {
      coordinateIndex,
      description,
      target,
      tolerance = 0.4,
      touchDriver = null,
    } = driveOptions;
    const state = await readState(page);
    const delta = target - state.vehicle.position[coordinateIndex];
    if (Math.abs(delta) > tolerance) {
      const positiveAxis = coordinateIndex === 0 ? 'positiveX' : 'positiveZ';
      const negativeAxis = coordinateIndex === 0 ? 'negativeX' : 'negativeZ';
      await driveAlongWorldAxis(page, {
        axis: delta > 0 ? positiveAxis : negativeAxis,
        description,
        predicate: (current) => delta > 0
          ? current.vehicle.position[coordinateIndex] >= target
          : current.vehicle.position[coordinateIndex] <= target,
        touchDriver,
      });
    }
    return alignWorldCoordinate(page, {
      coordinateIndex,
      description: `${description} precise`,
      target,
      tolerance,
      touchDriver,
    });
  }

  /** X/Zを交互に揃え、digital斜め入力の横滑りを吸収する。 */
  async function alignWorldPoint(page, alignOptions) {
    const {
      description,
      pointAttemptLimit = 6,
      target,
      tolerance = 0.35,
      touchDriver = null,
    } = alignOptions;
    assert(Array.isArray(target) && Number.isFinite(target[0]) && Number.isFinite(target[2]),
      `${description}: target point must contain finite X/Z.`);
    let latest = null;
    for (let attempt = 0; attempt < pointAttemptLimit; attempt += 1) {
      await alignWorldCoordinate(page, {
        coordinateIndex: 0,
        description: `${description} X`,
        target: target[0],
        tolerance,
        touchDriver,
      });
      latest = await alignWorldCoordinate(page, {
        coordinateIndex: 2,
        description: `${description} Z`,
        target: target[2],
        tolerance,
        touchDriver,
      });
      if (
        Math.abs(latest.vehicle.position[0] - target[0]) <= tolerance
        && Math.abs(latest.vehicle.position[2] - target[2]) <= tolerance
      ) return latest;
    }
    throw new Error(`${description}: point alignment failed: ${JSON.stringify({
      actual: latest?.vehicle.position,
      target,
    })}.`);
  }

  return Object.freeze({
    alignWorldCoordinate,
    alignWorldPoint,
    brakeVehicle,
    driveAlongWorldAxis,
    driveToCoordinate,
    pulseWorldAxis,
    readGameState: readState,
    waitForFrames: frameWaiter,
  });
}

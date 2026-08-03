import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createFireRoutePlan } from './fire-route-plan.mjs';

describe('fire route plan', () => {
  test('側面火災は東道路から西向きに照準する', () => {
    const plan = createFireRoutePlan(
      'fire-side',
      [26.9, 1.45, -16.1],
      [[30, 0.26, -4], [32.7, 0.26, -13]],
    );
    assert.deepEqual({ ...plan, approachStartZ: 0, latitudeZ: 0, stagingX: 0 }, {
      acquisitionAxis: 'negativeX',
      arrivalDistrict: 'fire',
      approachFace: 'east',
      approachStartZ: 0,
      latitudeZ: 0,
      requiresEastLaneBeforeReturn: false,
      stagingX: 0,
      trunkX: 30,
    });
    assert(Math.abs(plan.approachStartZ - -13) < 1e-9);
    assert(Math.abs(plan.latitudeZ - -13) < 1e-9);
    assert(Math.abs(plan.stagingX - 32.7) < 1e-9);
  });

  test('消火栓そばの屋外火災は東側から西向きに照準する', () => {
    const plan = createFireRoutePlan(
      'fire-hydrant',
      [18.5, 1.45, -10.5],
      [[32, 0.26, -10.5], [24.3, 0.26, -10.5]],
    );
    assert.deepEqual(plan, {
      acquisitionAxis: 'negativeX',
      arrivalDistrict: 'fire',
      approachFace: 'open-east',
      approachStartZ: -10.5,
      latitudeZ: -10.5,
      requiresEastLaneBeforeReturn: false,
      stagingX: 24.3,
      trunkX: 30,
    });
  });

  test('花壇そばの屋外火災も東側から西向きに照準する', () => {
    const plan = createFireRoutePlan(
      'fire-planter',
      [25.5, 1.45, -8],
      [[32, 0.26, -8], [31.3, 0.26, -8]],
    );
    assert.deepEqual(plan, {
      acquisitionAxis: 'negativeX',
      arrivalDistrict: 'fire',
      approachFace: 'open-east',
      approachStartZ: -8,
      latitudeZ: -8,
      requiresEastLaneBeforeReturn: false,
      stagingX: 31.3,
      trunkX: 30,
    });
  });

  test('屋外火災を背にするか対象を通り越す描画ルートを拒否する', () => {
    assert.throws(
      () => createFireRoutePlan(
        'fire-hydrant',
        [18.5, 1.45, -10.5],
        [[24.3, 0.26, -10.5], [30, 0.26, -10.5]],
      ),
      /finish facing west/,
    );
    assert.throws(
      () => createFireRoutePlan(
        'fire-planter',
        [25.5, 1.45, -8],
        [[32, 0.26, -8], [25, 0.26, -8]],
      ),
      /east of target/,
    );
  });

  test('未知の仕事や壊れた座標を拒否する', () => {
    const route = [[30, 0.26, -4], [32.7, 0.26, -13]];
    assert.throws(() => createFireRoutePlan('unknown', [0, 0, 0], route), /unsupported fire job/);
    assert.throws(
      () => createFireRoutePlan('fire-side', [0, Number.NaN, 0], route),
      /finite 3D point/,
    );
    assert.throws(
      () => createFireRoutePlan('fire-side', [0, 0, 0], [[30, 0.26, Number.NaN]]),
      /route markers/,
    );
  });
});

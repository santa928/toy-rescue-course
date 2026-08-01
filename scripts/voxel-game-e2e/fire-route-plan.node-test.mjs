import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createFireRoutePlan } from './fire-route-plan.mjs';

describe('fire route plan', () => {
  test('側面火災は東道路から西向きに照準する', () => {
    const plan = createFireRoutePlan('fire-side', [26.9, 1.45, -16.1]);
    assert.deepEqual({ ...plan, latitudeZ: 0, stagingX: 0 }, {
      acquisitionAxis: 'negativeX',
      arrivalDistrict: 'fire',
      approachFace: 'east',
      latitudeZ: 0,
      requiresEastLaneBeforeReturn: false,
      stagingX: 0,
      trunkX: 30,
    });
    assert(Math.abs(plan.latitudeZ - -13) < 1e-9);
    assert(Math.abs(plan.stagingX - 32.7) < 1e-9);
  });

  test('窓火災は北道路から南向きに照準し、帰りは東道路へ迂回する', () => {
    const plan = createFireRoutePlan('fire-window-left', [22.2, 1.45, -19.6]);
    assert.deepEqual({ ...plan, latitudeZ: 0 }, {
      acquisitionAxis: 'positiveZ',
      arrivalDistrict: 'road',
      approachFace: 'north',
      latitudeZ: 0,
      requiresEastLaneBeforeReturn: true,
      stagingX: 22.2,
      trunkX: 30,
    });
    assert(Math.abs(plan.latitudeZ - -25.4) < 1e-9);
  });

  test('未知の仕事や壊れた座標を拒否する', () => {
    assert.throws(() => createFireRoutePlan('unknown', [0, 0, 0]), /unsupported fire job/);
    assert.throws(() => createFireRoutePlan('fire-side', [0, Number.NaN, 0]), /finite 3D point/);
  });
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  conservativeFirstObservedAxisOverflowAllowance,
  evaluateConservativeFirstObservedAxisOverflow,
} from './voxel-game-break-physics-contract.mjs';

describe('Voxel Game conservative first-observed AABB axis-overflow contract', () => {
  test('16.7msのobserved delayと未観測1 fixed stepで既知の正常overflowを受理する', () => {
    assert.deepEqual(
      evaluateConservativeFirstObservedAxisOverflow({
        delayMilliseconds: 16.7,
        maximumOverflow: 0.117696,
      }),
      {
        accepted: true,
        allowedOverflow: 0.20685334333333333,
      },
    );
  });

  test('observed delayと未観測1 fixed stepから算出した保守AABB軸overflow envelopeの超過を拒否する', () => {
    assert.equal(
      evaluateConservativeFirstObservedAxisOverflow({
        delayMilliseconds: 16.7,
        maximumOverflow: 0.20685334333333336,
      }).accepted,
      false,
    );
  });

  test('不正なdelayとoverflowを有限な物理観測として受理しない', () => {
    assert.throws(
      () => conservativeFirstObservedAxisOverflowAllowance(-0.001),
      /Activation transition delay is invalid/,
    );
    assert.throws(
      () => evaluateConservativeFirstObservedAxisOverflow({
        delayMilliseconds: 16.7,
        maximumOverflow: Number.NaN,
      }),
      /First-observed overflow is invalid/,
    );
  });
});

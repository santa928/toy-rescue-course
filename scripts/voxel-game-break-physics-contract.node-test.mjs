import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  evaluateFirstObservedPositionContract,
  firstObservedPositionAllowance,
} from './voxel-game-break-physics-contract.mjs';

describe('Voxel Game first-observed fragment physics contract', () => {
  test('16.7msのobserver遅延でも2 fixed steps相当の正常overflowを受理する', () => {
    assert.deepEqual(
      evaluateFirstObservedPositionContract({
        delayMilliseconds: 16.7,
        maximumOverflow: 0.117696,
      }),
      {
        accepted: true,
        allowedOverflow: 0.20685334333333333,
      },
    );
  });

  test('1 stepのscheduler allowanceを越える3-step相当または速度逸脱を拒否する', () => {
    assert.equal(
      evaluateFirstObservedPositionContract({
        delayMilliseconds: 16.7,
        maximumOverflow: 0.30269667666666666,
      }).accepted,
      false,
    );
    assert.equal(
      evaluateFirstObservedPositionContract({
        delayMilliseconds: 16.7,
        maximumOverflow: 0.20685334333333336,
      }).accepted,
      false,
    );
  });

  test('不正なdelayとoverflowを有限な物理観測として受理しない', () => {
    assert.throws(
      () => firstObservedPositionAllowance(-0.001),
      /Activation transition delay is invalid/,
    );
    assert.throws(
      () => evaluateFirstObservedPositionContract({
        delayMilliseconds: 16.7,
        maximumOverflow: Number.NaN,
      }),
      /First-observed overflow is invalid/,
    );
  });
});

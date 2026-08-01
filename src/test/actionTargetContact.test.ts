import { describe, expect, it } from 'vitest';
import {
  advanceActionTargetHold,
  getActionTargetContactPoint,
  isActionTargetContact,
  type ActionTargetInteraction,
} from '../voxel-game/domain/actionTargetContact';

const STOPPED_INTERACTION: ActionTargetInteraction = {
  contactRadius: 1.1,
  forwardOffset: 1.5,
  holdDurationMs: 700,
  maximumSpeed: 0.45,
  minimumSpeed: 0,
};

describe('action target contact', () => {
  it('車両位置と正規化済み前方からworld接触中心を求める', () => {
    expect(getActionTargetContactPoint({
      forward: [0.6, 0, 0.8],
      position: [10, 0.8, -4],
    }, 1.5)).toEqual([10.9, 1.15, -2.8]);
  });

  it('主操作、距離、最小速度、最大速度をすべて満たすときだけ接触にする', () => {
    const base = {
      actionActive: true,
      contactPoint: [0, 0.35, 0] as const,
      interaction: STOPPED_INTERACTION,
      speed: 0.45,
      targetPosition: [1.1, 0.5, 0] as const,
      targetRadius: 0.4,
    };

    expect(isActionTargetContact(base)).toBe(true);
    expect(isActionTargetContact({ ...base, actionActive: false })).toBe(false);
    expect(isActionTargetContact({ ...base, speed: 0.451 })).toBe(false);
    expect(isActionTargetContact({ ...base, targetPosition: [1.51, 0.5, 0] })).toBe(false);
    expect(isActionTargetContact({
      ...base,
      interaction: { ...STOPPED_INTERACTION, minimumSpeed: 0.35 },
      speed: 0.349,
    })).toBe(false);
  });

  it('接触中だけ最大50msずつ必要時間まで累積し、離れると0へ戻す', () => {
    expect(advanceActionTargetHold(680, true, 50, 700)).toBe(700);
    expect(advanceActionTargetHold(100, true, 500, 700)).toBe(150);
    expect(advanceActionTargetHold(100, false, 16, 700)).toBe(0);
  });

  it.each([
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [-1, 0],
  ] as const)('不正な現在値=%sを安全な%sへ正規化する', (current, expected) => {
    expect(advanceActionTargetHold(current, true, 16, 700)).toBe(expected + 16);
  });

  it('非finite座標、半径、速度、interactionを接触として受理しない', () => {
    expect(isActionTargetContact({
      actionActive: true,
      contactPoint: [Number.NaN, 0, 0],
      interaction: STOPPED_INTERACTION,
      speed: 0,
      targetPosition: [0, 0, 0],
      targetRadius: 1,
    })).toBe(false);
    expect(() => getActionTargetContactPoint({
      forward: [0, 0, 0],
      position: [0, 0, 0],
    }, 1)).toThrowError('Action contact requires a finite horizontal forward vector');
  });
});

import { describe, expect, it } from 'vitest';
import { resolveSprayTarget } from '../voxel-game/domain/sprayTargeting';

describe('resolveSprayTarget', () => {
  it('高低差を除いた水平7unit以内だけを照準対象にする', () => {
    const boundary = resolveSprayTarget([0, 3, 0], [0, 0, -1], [0, 1, -7]);
    const outside = resolveSprayTarget([0, 3, 0], [0, 0, -1], [0, 1, -7.001]);

    expect(boundary.targeted).toBe(true);
    expect(boundary.distance).toBeCloseTo(Math.hypot(0, -2, -7), 9);
    expect(outside.targeted).toBe(false);
  });

  it('前方60度を含み、60度を超える火・真横・背後を対象外にする', () => {
    const radius = 6;
    const at60 = Math.PI / 3;
    const beyond60 = at60 + 0.01;

    expect(resolveSprayTarget(
      [0, 1, 0],
      [0, 0, -1],
      [Math.sin(at60) * radius, 1, -Math.cos(at60) * radius],
    ).targeted).toBe(true);
    expect(resolveSprayTarget(
      [0, 1, 0],
      [0, 0, -1],
      [Math.sin(beyond60) * radius, 1, -Math.cos(beyond60) * radius],
    ).targeted).toBe(false);
    expect(resolveSprayTarget([0, 1, 0], [0, 0, -1], [6, 1, 0]).targeted).toBe(false);
    expect(resolveSprayTarget([0, 1, 0], [0, 0, -1], [0, 1, 4]).targeted).toBe(false);
  });

  it('同じXZ条件ならノズルと炎の高低差で対象結果を変えない', () => {
    const level = resolveSprayTarget([0, 1, 0], [0, 0, -1], [2, 1, -5]);
    const lower = resolveSprayTarget([0, 4, 0], [0, 0, -1], [2, 0.5, -5]);

    expect(level.targeted).toBe(true);
    expect(lower.targeted).toBe(level.targeted);
  });

  it('対象の火へ方向を55%補正し、3次元vectorを長さ1へ正規化する', () => {
    const result = resolveSprayTarget([0, 0, 0], [0, 0, -1], [3, 0, -4]);
    const expectedMixed = [0.6 * 0.55, 0, -0.45 - 0.8 * 0.55] as const;
    const expectedLength = Math.hypot(...expectedMixed);

    expect(result.distance).toBe(5);
    expect(result.direction).toEqual([
      expectedMixed[0] / expectedLength,
      0,
      expectedMixed[2] / expectedLength,
    ]);
    expect(Math.hypot(...result.direction)).toBeCloseTo(1, 9);
  });

  it('対象外では有限な元の前方方向を維持する', () => {
    const forward = [0, 0, -1] as const;

    expect(resolveSprayTarget([0, 0, 0], forward, [0, 0, 8])).toEqual({
      direction: forward,
      distance: 8,
      targeted: false,
    });
  });

  it.each([
    [[Number.NaN, 0, 0], [0, 0, -1], [0, 0, -3]],
    [[0, 0, 0], [0, 0, 0], [0, 0, -3]],
    [[0, 0, 0], [0, 0, -1], [Number.POSITIVE_INFINITY, 0, -3]],
  ] as const)('非有限座標またはゼロ長前方を安全に対象外へ倒す', (origin, forward, target) => {
    const result = resolveSprayTarget(origin, forward, target);

    expect(result.targeted).toBe(false);
    expect(result.direction.every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(result.distance)).toBe(true);
  });
});

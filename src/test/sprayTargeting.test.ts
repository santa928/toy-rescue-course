import { describe, expect, it } from 'vitest';
import { resolveSprayTarget } from '../voxel-game/domain/sprayTargeting';

describe('resolveSprayTarget', () => {
  it('前方かつ6unit以内の火だけをtargetにする', () => {
    expect(resolveSprayTarget([0, 1, 0], [0, 0, -1], [0.8, 1, -4])).toMatchObject({ targeted: true });
    expect(resolveSprayTarget([0, 1, 0], [0, 0, -1], [0, 1, 4])).toMatchObject({ targeted: false });
    expect(resolveSprayTarget([0, 1, 0], [0, 0, -1], [0, 1, -6.01])).toMatchObject({ targeted: false });
  });

  it('対象の火へ前方方向を35%補正して正規化する', () => {
    const result = resolveSprayTarget([0, 0, 0], [0, 0, -1], [3, 0, -4]);

    expect(result.distance).toBe(5);
    expect(result.direction[0]).toBeGreaterThan(0);
    expect(Math.hypot(...result.direction)).toBeCloseTo(1);
  });

  it('照準対象外では元の前方方向を維持する', () => {
    const forward = [0, 0, -1] as const;

    expect(resolveSprayTarget([0, 0, 0], forward, [0, 0, 3])).toEqual({
      direction: forward,
      distance: 3,
      targeted: false,
    });
  });
});

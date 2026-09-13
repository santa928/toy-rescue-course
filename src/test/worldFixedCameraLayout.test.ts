import { describe, expect, it } from 'vitest';
import { resolveWorldFixedCameraZoom } from '../voxel-game/scene/WorldFixedCameraLayout';

describe('resolveWorldFixedCameraZoom', () => {
  it('desktopで街の導線と前庭を見渡す倍率に収める', () => {
    expect(resolveWorldFixedCameraZoom(1_280, 720)).toBeCloseTo(32, 6);
  });

  it('低高さのmobile横画面だけ主要対象とHUDの安全余白を取るzoom上限を適用する', () => {
    expect(resolveWorldFixedCameraZoom(1_024, 768)).toBeCloseTo(32, 6);
    expect(resolveWorldFixedCameraZoom(844, 390)).toBe(38);
    expect(resolveWorldFixedCameraZoom(667, 375)).toBeCloseTo(24.70370, 4);
    expect(resolveWorldFixedCameraZoom(390, 844)).toBeCloseTo(38, 4);
    expect(resolveWorldFixedCameraZoom(360, 800)).toBeCloseTo(37.5, 4);
  });

  it('HUDの高さ・幅の境界を1px跨いでも車体を急拡大しない', () => {
    for (const width of [640, 667, 700, 701, 844]) {
      expect(Math.abs(resolveWorldFixedCameraZoom(width, 481)
        - resolveWorldFixedCameraZoom(width, 480))).toBeLessThan(0.2);
    }
    for (const height of [375, 480, 481, 600, 720]) {
      expect(Math.abs(resolveWorldFixedCameraZoom(701, height)
        - resolveWorldFixedCameraZoom(700, height))).toBeLessThan(0.2);
    }
  });
});

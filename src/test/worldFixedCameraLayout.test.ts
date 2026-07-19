import { describe, expect, it } from 'vitest';
import { resolveWorldFixedCameraZoom } from '../voxel-game/scene/WorldFixedCameraLayout';

describe('resolveWorldFixedCameraZoom', () => {
  it('desktopの既存zoom計算を維持する', () => {
    expect(resolveWorldFixedCameraZoom(1_280, 720)).toBeCloseTo(68.444444, 6);
  });

  it('低高さのmobile横画面だけ主要対象とHUDの安全余白を取るzoom上限を適用する', () => {
    expect(resolveWorldFixedCameraZoom(1_024, 768)).toBeCloseTo(61.333333, 6);
    expect(resolveWorldFixedCameraZoom(844, 390)).toBe(52);
  });
});

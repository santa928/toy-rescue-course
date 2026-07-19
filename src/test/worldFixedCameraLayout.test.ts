import { describe, expect, it } from 'vitest';
import { resolveWorldFixedCameraZoom } from '../voxel-game/scene/WorldFixedCameraLayout';

describe('resolveWorldFixedCameraZoom', () => {
  it('desktopの既存zoom計算を維持する', () => {
    expect(resolveWorldFixedCameraZoom(1_280, 720)).toBeCloseTo(68.444444, 6);
  });

  it('低高さのmobile横画面だけ安全zoom上限を適用する', () => {
    expect(resolveWorldFixedCameraZoom(844, 390)).toBe(56);
  });
});

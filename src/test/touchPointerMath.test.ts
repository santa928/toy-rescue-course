import { describe, expect, it } from 'vitest';
import { resolveJoystickPointer } from '../voxel-game/ui/touchPointerMath';

describe('resolveJoystickPointer', () => {
  it('要素中心を0,0として正規化する', () => {
    expect(resolveJoystickPointer(
      { height: 120, left: 20, top: 40, width: 120 },
      80,
      100,
    )).toEqual({ x: 0, y: 0 });
  });

  it('円の内側を-1から1の相対座標へ変換する', () => {
    expect(resolveJoystickPointer(
      { height: 120, left: 20, top: 40, width: 120 },
      110,
      70,
    )).toEqual({ x: 0.5, y: -0.5 });
  });

  it('半径外の斜め入力を方向を保ったまま円周へclampする', () => {
    const point = resolveJoystickPointer(
      { height: 100, left: 0, top: 0, width: 140 },
      120,
      100,
    );

    expect(Math.hypot(point.x, point.y)).toBeCloseTo(1, 8);
    expect(point.x).toBeCloseTo(Math.SQRT1_2, 8);
    expect(point.y).toBeCloseTo(Math.SQRT1_2, 8);
  });

  it('寸法0では有限な中央位置を返す', () => {
    expect(resolveJoystickPointer(
      { height: 0, left: 12, top: 34, width: 0 },
      500,
      -500,
    )).toEqual({ x: 0, y: 0 });
  });
});

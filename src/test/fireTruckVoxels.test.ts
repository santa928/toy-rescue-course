import { describe, expect, it } from 'vitest';
import {
  FIRE_TRUCK_PALETTE_IDS,
  FIRE_TRUCK_VOXELS,
} from '../vehicle-lab/model/fireTruckVoxels';
import {
  assertValidVoxelModel,
  calculateVoxelBounds,
  groupVoxelsByPalette,
} from '../vehicle-lab/model/voxelModel';

function paletteAt(x: number, y: number, z: number): string | undefined {
  return FIRE_TRUCK_VOXELS.find((cell) => cell.x === x && cell.y === y && cell.z === z)?.paletteId;
}

describe('FIRE_TRUCK_VOXELS', () => {
  it('有効かつ800セル以下の消防車である', () => {
    expect(() => assertValidVoxelModel(FIRE_TRUCK_VOXELS, FIRE_TRUCK_PALETTE_IDS)).not.toThrow();
    expect(FIRE_TRUCK_VOXELS.length).toBeGreaterThan(500);
    expect(FIRE_TRUCK_VOXELS.length).toBeLessThanOrEqual(800);
  });

  it('幼児玩具らしい短く太い外形を持つ', () => {
    expect(calculateVoxelBounds(FIRE_TRUCK_VOXELS)).toEqual({
      min: { x: -6, y: 0, z: -7 },
      max: { x: 5, y: 7, z: 6 },
      size: { x: 12, y: 8, z: 14 },
      center: { x: -0.5, y: 3.5, z: -0.5 },
    });
  });

  it('正面窓、タイヤ、梯子、警光灯を持つ', () => {
    expect(paletteAt(0, 4, -6)).toBe('black');
    expect(paletteAt(-6, 0, -4)).toBe('black');
    expect(paletteAt(-3, 7, 5)).toBe('silver');
    expect(paletteAt(-3, 7, -5)).toBe('blue');
  });

  it('車両本体の色別バッチ数が10以下である', () => {
    const groups = groupVoxelsByPalette(FIRE_TRUCK_VOXELS, FIRE_TRUCK_PALETTE_IDS);
    expect(groups.size).toBeLessThanOrEqual(10);
  });
});

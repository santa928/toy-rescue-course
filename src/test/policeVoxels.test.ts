import { describe, expect, it } from 'vitest';
import {
  POLICE_PALETTE_IDS,
  POLICE_VOXELS,
} from '../vehicle-lab/model/policeVoxels';
import {
  assertValidVoxelModel,
  calculateVoxelBounds,
  groupVoxelsByPalette,
} from '../vehicle-lab/model/voxelModel';
import {
  POLICE_RENDER_PLAN,
  getPoliceBeaconScales,
} from '../vehicle-lab/scene/VoxelPolice';

/** 指定model座標にあるパトカーvoxelのpalette IDを返す。 */
function paletteAt(x: number, y: number, z: number): string | undefined {
  return POLICE_VOXELS.find((cell) => (
    cell.x === x && cell.y === y && cell.z === z
  ))?.paletteId;
}

describe('POLICE_VOXELS', () => {
  it('有効な800 voxel・7 batch以下の働く車である', () => {
    expect(() => assertValidVoxelModel(POLICE_VOXELS, POLICE_PALETTE_IDS)).not.toThrow();
    expect(POLICE_VOXELS.length).toBeGreaterThan(220);
    expect(POLICE_VOXELS.length).toBeLessThanOrEqual(800);
    expect(groupVoxelsByPalette(POLICE_VOXELS, POLICE_PALETTE_IDS).size)
      .toBeLessThanOrEqual(7);
    expect(POLICE_RENDER_PLAN.drawCalls).toBeLessThanOrEqual(7);
  });

  it('救急車より低い白黒パトカーの外形を持つ', () => {
    expect(calculateVoxelBounds(POLICE_VOXELS)).toEqual({
      center: { x: 0, y: 3, z: 0 },
      max: { x: 5, y: 6, z: 6 },
      min: { x: -5, y: 0, z: -6 },
      size: { x: 11, y: 7, z: 13 },
    });
  });

  it('左右車輪、青緑窓、黒帯、赤青灯を実データに持つ', () => {
    expect(paletteAt(-5, 0, -4)).toBe('wheel');
    expect(paletteAt(-5, 1, -4)).toBe('darkGray');
    expect(paletteAt(-3, 4, -5)).toBe('window');
    expect(paletteAt(-4, 3, 0)).toBe('black');
    expect(paletteAt(-1, 6, 0)).toBe('redBeacon');
    expect(paletteAt(1, 6, 0)).toBe('blueBeacon');
  });

  it('サイレン中だけ赤青灯を交互に明滅させる', () => {
    expect(getPoliceBeaconScales(false, 0.1)).toEqual({ blue: 1, red: 1 });
    const first = getPoliceBeaconScales(true, 0.1);
    const second = getPoliceBeaconScales(true, 0.6);
    expect(first.red).not.toBe(first.blue);
    expect(second.red).toBeCloseTo(first.blue, 5);
    expect(second.blue).toBeCloseTo(first.red, 5);
  });
});

import { describe, expect, it } from 'vitest';
import {
  AMBULANCE_PALETTE_IDS,
  AMBULANCE_VOXELS,
} from '../vehicle-lab/model/ambulanceVoxels';
import {
  assertValidVoxelModel,
  calculateVoxelBounds,
  groupVoxelsByPalette,
} from '../vehicle-lab/model/voxelModel';
import {
  AMBULANCE_RENDER_PLAN,
  getAmbulanceCarePulseScale,
} from '../vehicle-lab/scene/VoxelAmbulance';

/** 指定model座標にある救急車voxelのpalette IDを返す。 */
function paletteAt(x: number, y: number, z: number): string | undefined {
  return AMBULANCE_VOXELS.find((cell) => (
    cell.x === x && cell.y === y && cell.z === z
  ))?.paletteId;
}

describe('AMBULANCE_VOXELS', () => {
  it('有効な800 voxel・7 batch以下の働く車である', () => {
    expect(() => assertValidVoxelModel(AMBULANCE_VOXELS, AMBULANCE_PALETTE_IDS)).not.toThrow();
    expect(AMBULANCE_VOXELS.length).toBeGreaterThan(250);
    expect(AMBULANCE_VOXELS.length).toBeLessThanOrEqual(800);
    expect(groupVoxelsByPalette(AMBULANCE_VOXELS, AMBULANCE_PALETTE_IDS).size)
      .toBeLessThanOrEqual(7);
    expect(AMBULANCE_RENDER_PLAN.drawCalls).toBeLessThanOrEqual(7);
  });

  it('背の高い箱形救急車の外形を持つ', () => {
    expect(calculateVoxelBounds(AMBULANCE_VOXELS)).toEqual({
      center: { x: 0, y: 3.5, z: 0 },
      max: { x: 5, y: 7, z: 6 },
      min: { x: -5, y: 0, z: -6 },
      size: { x: 11, y: 8, z: 13 },
    });
  });

  it('左右車輪、青緑窓、赤帯、赤十字、赤色灯を実データに持つ', () => {
    expect(paletteAt(-5, 0, -4)).toBe('wheel');
    expect(paletteAt(-5, 1, -4)).toBe('darkGray');
    expect(paletteAt(-3, 5, -5)).toBe('window');
    expect(paletteAt(-4, 3, 0)).toBe('red');
    expect(paletteAt(-4, 5, 2)).toBe('cross');
    expect(paletteAt(-1, 7, 1)).toBe('beacon');
  });

  it('主操作中だけ赤十字と灯火をやさしく脈動させる', () => {
    expect(getAmbulanceCarePulseScale(false, 0.25)).toBe(1);
    expect(getAmbulanceCarePulseScale(true, 0)).toBeCloseTo(1, 5);
    expect(getAmbulanceCarePulseScale(true, 0.25)).toBeGreaterThan(1);
    expect(getAmbulanceCarePulseScale(true, 0.25)).toBeLessThanOrEqual(1.07);
  });
});

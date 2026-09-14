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
  getPoliceActionPose,
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

  it('大きなタイヤに対して肩と車室の高さを確保した外形を持つ', () => {
    expect(calculateVoxelBounds(POLICE_VOXELS)).toEqual({
      center: { x: 0, y: 4, z: 0 },
      max: { x: 5, y: 8, z: 6 },
      min: { x: -5, y: 0, z: -6 },
      size: { x: 11, y: 9, z: 13 },
    });
  });

  it('左右車輪、青緑窓、黒帯、赤青灯を実データに持つ', () => {
    expect(paletteAt(-5, 0, -4)).toBe('wheel');
    expect(paletteAt(-5, 2, -4)).toBe('darkGray');
    expect(paletteAt(-2, 5, -2)).toBe('window');
    expect(paletteAt(-2, 6, -2)).toBe('window');
    expect(paletteAt(-4, 4, 0)).toBe('white');
    expect(paletteAt(-4, 3, 0)).toBe('black');
    expect(paletteAt(-1, 8, 0)).toBe('redBeacon');
    expect(paletteAt(1, 8, 0)).toBe('blueBeacon');
  });

  it('サイレン中も灯火の形と位置を変えない', () => {
    expect(getPoliceBeaconScales(false, 0.1)).toEqual({ blue: 1, red: 1 });
    const first = getPoliceBeaconScales(true, 0.1);
    const second = getPoliceBeaconScales(true, 0.6);
    expect(first).toEqual({ blue: 1, red: 1 });
    expect(second).toEqual(first);
  });

  it('押下直後から明るさで応答し、hold中は0.5秒ごとに赤青が交互点灯する', () => {
    const press = getPoliceActionPose(true, 0.08);
    const firstHold = getPoliceActionPose(true, 0.3);
    const secondHold = getPoliceActionPose(true, 0.8);

    expect(press.phase).toBe('press');
    expect(press.redGlow).toBeGreaterThan(press.blueGlow);
    expect(press.redScale).toBe(1);
    expect(press.blueScale).toBe(1);
    expect(firstHold.phase).toBe('hold');
    expect(firstHold.flashHz).toBeLessThanOrEqual(2);
    expect(secondHold.redGlow).toBeCloseTo(firstHold.blueGlow, 5);
    expect(secondHold.blueGlow).toBeCloseTo(firstHold.redGlow, 5);
  });

  it('非押下と不正時刻ではneutral poseへ戻る', () => {
    const neutral = {
      blueGlow: 0.38,
      redGlow: 0.34,
      blueScale: 1,
      flashHz: 0,
      phase: 'idle',
      redScale: 1,
    };
    expect(getPoliceActionPose(false, 0.1)).toEqual(neutral);
    expect(getPoliceActionPose(true, Number.NaN)).toEqual(neutral);
  });
});

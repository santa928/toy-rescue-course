import { describe, expect, it } from 'vitest';
import {
  EXCAVATOR_PALETTE_IDS,
  EXCAVATOR_VOXELS,
} from '../vehicle-lab/model/excavatorVoxels';
import {
  assertValidVoxelModel,
  calculateVoxelBounds,
  groupVoxelsByPalette,
} from '../vehicle-lab/model/voxelModel';
import {
  EXCAVATOR_RENDER_PLAN,
  advanceExcavatorArmOffset,
  getExcavatorActionPose,
} from '../vehicle-lab/scene/VoxelExcavator';

/** 指定model座標にあるショベルカーvoxelのpalette IDを返す。 */
function paletteAt(x: number, y: number, z: number): string | undefined {
  return EXCAVATOR_VOXELS.find((cell) => (
    cell.x === x && cell.y === y && cell.z === z
  ))?.paletteId;
}

describe('EXCAVATOR_VOXELS', () => {
  it('有効な800 voxel・7 batch以下の働く車である', () => {
    expect(() => assertValidVoxelModel(EXCAVATOR_VOXELS, EXCAVATOR_PALETTE_IDS)).not.toThrow();
    expect(EXCAVATOR_VOXELS.length).toBeGreaterThan(250);
    expect(EXCAVATOR_VOXELS.length).toBeLessThanOrEqual(800);
    expect(groupVoxelsByPalette(EXCAVATOR_VOXELS, EXCAVATOR_PALETTE_IDS).size)
      .toBeLessThanOrEqual(7);
    expect(EXCAVATOR_RENDER_PLAN.drawCalls).toBeLessThanOrEqual(7);
  });

  it('長い前方アームを持つ低い履帯車の外形である', () => {
    expect(calculateVoxelBounds(EXCAVATOR_VOXELS)).toEqual({
      center: { x: 0.5, y: 3.5, z: -2 },
      max: { x: 6, y: 7, z: 5 },
      min: { x: -5, y: 0, z: -9 },
      size: { x: 12, y: 8, z: 15 },
    });
  });

  it('左右履帯、青い窓、段付きアーム、灰色bucket、回転灯を実データに持つ', () => {
    expect(paletteAt(-5, 0, 0)).toBe('track');
    expect(paletteAt(-5, 1, 0)).toBe('darkGray');
    expect(paletteAt(-3, 5, 2)).toBe('window');
    expect(paletteAt(0, 6, -5)).toBe('arm');
    expect(paletteAt(0, 2, -9)).toBe('bucket');
    expect(paletteAt(-1, 7, 3)).toBe('beacon');
  });

  it('主操作中だけarmとbucketを下げ、解除後は元位置へ戻す', () => {
    const lowered = advanceExcavatorArmOffset(0, true, 1 / 60);
    const returning = advanceExcavatorArmOffset(lowered, false, 1 / 60);

    expect(lowered).toBeLessThan(0);
    expect(lowered).toBeGreaterThanOrEqual(-0.2);
    expect(returning).toBeGreaterThan(lowered);
    expect(returning).toBeLessThanOrEqual(0);
  });

  it('押下中は0.9秒でlower・curl・lift・returnの4相を繰り返す', () => {
    const lower = getExcavatorActionPose(true, 0.1);
    const curl = getExcavatorActionPose(true, 0.48);
    const lift = getExcavatorActionPose(true, 0.7);
    const returning = getExcavatorActionPose(true, 0.82);

    expect(lower.phase).toBe('lower');
    expect(lower.armY).toBeLessThan(0);
    expect(curl.phase).toBe('curl');
    expect(curl.bucketRotationX).toBeGreaterThan(0.5);
    expect(lift.phase).toBe('lift');
    expect(lift.armY).toBeGreaterThan(-0.2);
    expect(returning.phase).toBe('return');
    expect(returning.bucketRotationX).toBeLessThan(lift.bucketRotationX);
  });

  it('非押下と不正時刻ではneutral poseを返す', () => {
    const neutral = { armY: 0, bucketRotationX: 0, phase: 'idle' };
    expect(getExcavatorActionPose(false, 0.4)).toEqual(neutral);
    expect(getExcavatorActionPose(true, Number.NaN)).toEqual(neutral);
  });
});

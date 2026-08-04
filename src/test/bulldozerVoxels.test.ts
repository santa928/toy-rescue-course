import { describe, expect, it } from 'vitest';
import {
  BULLDOZER_PALETTE_IDS,
  BULLDOZER_VOXELS,
} from '../vehicle-lab/model/bulldozerVoxels';
import {
  assertValidVoxelModel,
  calculateVoxelBounds,
  groupVoxelsByPalette,
} from '../vehicle-lab/model/voxelModel';
import {
  BULLDOZER_RENDER_PLAN,
  advanceBulldozerBladeOffset,
  getBulldozerActionPose,
} from '../vehicle-lab/scene/VoxelBulldozer';

/** 指定model座標にあるブルドーザーvoxelのpalette IDを返す。 */
function paletteAt(x: number, y: number, z: number): string | undefined {
  return BULLDOZER_VOXELS.find((cell) => (
    cell.x === x && cell.y === y && cell.z === z
  ))?.paletteId;
}

describe('BULLDOZER_VOXELS', () => {
  it('有効な800 voxel・7 batch以下の働く車である', () => {
    expect(() => assertValidVoxelModel(BULLDOZER_VOXELS, BULLDOZER_PALETTE_IDS)).not.toThrow();
    expect(BULLDOZER_VOXELS.length).toBeGreaterThan(300);
    expect(BULLDOZER_VOXELS.length).toBeLessThanOrEqual(800);
    expect(groupVoxelsByPalette(BULLDOZER_VOXELS, BULLDOZER_PALETTE_IDS).size)
      .toBeLessThanOrEqual(7);
    expect(BULLDOZER_RENDER_PLAN.drawCalls).toBeLessThanOrEqual(7);
  });

  it('幅広く短いブルドーザーの外形を持つ', () => {
    expect(calculateVoxelBounds(BULLDOZER_VOXELS)).toEqual({
      center: { x: 0.5, y: 3.5, z: -1 },
      max: { x: 7, y: 7, z: 5 },
      min: { x: -6, y: 0, z: -7 },
      size: { x: 14, y: 8, z: 13 },
    });
  });

  it('前面blade、左右履帯、窓、回転灯をmodel実データに持つ', () => {
    expect(paletteAt(-6, 1, -7)).toBe('blade');
    expect(paletteAt(-5, 0, 0)).toBe('track');
    expect(paletteAt(0, 5, 0)).toBe('window');
    expect(paletteAt(0, 7, 2)).toBe('beacon');
  });

  it('車体中心X=0.5に対して左右の履帯cellが鏡像になる', () => {
    const trackCoordinates = new Set(
      BULLDOZER_VOXELS
        .filter(({ paletteId }) => paletteId === 'track')
        .map(({ x, y, z }) => `${x}:${y}:${z}`),
    );

    for (const cell of BULLDOZER_VOXELS.filter(({ paletteId }) => paletteId === 'track')) {
      expect(trackCoordinates.has(`${1 - cell.x}:${cell.y}:${cell.z}`)).toBe(true);
    }
  });

  it('primary action中だけbladeを下げ、解除後は元位置へ戻す', () => {
    const lowered = advanceBulldozerBladeOffset(0, true, 1 / 60);
    const returning = advanceBulldozerBladeOffset(lowered, false, 1 / 60);

    expect(lowered).toBeLessThan(0);
    expect(lowered).toBeGreaterThanOrEqual(-0.12);
    expect(returning).toBeGreaterThan(lowered);
    expect(returning).toBeLessThanOrEqual(0);
  });

  it('押下中は0.55秒でslam・bounce・hold・resetの4相を繰り返す', () => {
    const slam = getBulldozerActionPose(true, 0.04);
    const impact = getBulldozerActionPose(true, 0.12);
    const bounce = getBulldozerActionPose(true, 0.2);
    const reset = getBulldozerActionPose(true, 0.5);

    expect(slam.bladeY).toBeLessThan(0);
    expect(slam.bodyScaleY).toBeLessThan(1);
    expect(impact.phase).toBe('impact');
    expect(impact.bladeY).toBeLessThanOrEqual(slam.bladeY);
    expect(bounce.phase).toBe('bounce');
    expect(bounce.bladeY).toBeGreaterThan(impact.bladeY);
    expect(reset.phase).toBe('reset');
    expect(reset.bladeY).toBeGreaterThan(bounce.bladeY);
  });

  it('非押下と不正時刻ではcolliderを動かさないneutral poseへ戻す', () => {
    expect(getBulldozerActionPose(false, 0.12)).toEqual({
      bladeY: 0,
      bodyScaleY: 1,
      phase: 'idle',
    });
    expect(getBulldozerActionPose(true, Number.NaN)).toEqual({
      bladeY: 0,
      bodyScaleY: 1,
      phase: 'idle',
    });
  });
});

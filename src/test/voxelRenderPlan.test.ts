import { describe, expect, it } from 'vitest';
import {
  FIRE_TRUCK_PALETTE_IDS,
  FIRE_TRUCK_VOXELS,
} from '../vehicle-lab/model/fireTruckVoxels';
import { calculateVoxelBounds } from '../vehicle-lab/model/voxelModel';
import { createVoxelRenderPlan } from '../vehicle-lab/model/voxelRenderPlan';

describe('createVoxelRenderPlan', () => {
  it('消防車を色別10バッチ以下へまとめる', () => {
    const plan = createVoxelRenderPlan(
      FIRE_TRUCK_VOXELS,
      FIRE_TRUCK_PALETTE_IDS,
      calculateVoxelBounds(FIRE_TRUCK_VOXELS),
      0.24,
    );

    expect(plan.voxelCount).toBe(FIRE_TRUCK_VOXELS.length);
    expect(plan.drawCalls).toBe(plan.batches.length);
    expect(plan.drawCalls).toBeLessThanOrEqual(10);
    expect(plan.batches.flatMap((batch) => batch.positions)).toHaveLength(FIRE_TRUCK_VOXELS.length);
  });

  it('X/Z中央かつ地面Y=0へ配置する', () => {
    const plan = createVoxelRenderPlan(
      FIRE_TRUCK_VOXELS,
      FIRE_TRUCK_PALETTE_IDS,
      calculateVoxelBounds(FIRE_TRUCK_VOXELS),
      0.24,
    );

    expect(plan.offset).toEqual([0.12, -0, 0.12]);
  });
});

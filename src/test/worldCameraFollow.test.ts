import { describe, expect, it } from 'vitest';
import {
  CAMERA_FOLLOW_DEAD_ZONE,
  resolveCameraFollowAxis,
} from '../voxel-game/scene/worldCameraFollow';
import { WORLD_FRAME_UPDATE_PRIORITIES } from '../voxel-game/scene/worldFrameUpdatePriorities';

describe('resolveCameraFollowAxis', () => {
  it('接触補正によるdead zone内の微振動ではcamera anchorを動かさない', () => {
    expect(resolveCameraFollowAxis(10, 10 + CAMERA_FOLLOW_DEAD_ZONE * 0.9)).toBe(10);
    expect(resolveCameraFollowAxis(10, 10 - CAMERA_FOLLOW_DEAD_ZONE * 0.9)).toBe(10);
  });

  it('意図した移動だけdead zone外の距離ぶん追従する', () => {
    expect(resolveCameraFollowAxis(10, 10.5)).toBeCloseTo(10.5 - CAMERA_FOLLOW_DEAD_ZONE, 8);
    expect(resolveCameraFollowAxis(10, 9.5)).toBeCloseTo(9.5 + CAMERA_FOLLOW_DEAD_ZONE, 8);
  });
});

describe('WORLD_FRAME_UPDATE_PRIORITIES', () => {
  it('Rapier描画補間、車体visual同期、camera追従の順で自動render前に更新する', () => {
    expect(WORLD_FRAME_UPDATE_PRIORITIES.physics).toBeLessThan(
      WORLD_FRAME_UPDATE_PRIORITIES.vehicleVisualSync,
    );
    expect(WORLD_FRAME_UPDATE_PRIORITIES.vehicleVisualSync).toBeLessThan(
      WORLD_FRAME_UPDATE_PRIORITIES.camera,
    );
    expect(WORLD_FRAME_UPDATE_PRIORITIES.camera).toBeLessThan(0);
  });
});

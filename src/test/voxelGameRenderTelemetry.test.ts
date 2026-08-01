import { describe, expect, it } from 'vitest';
import { buildWorldTelemetry } from '../voxel-game/VoxelGameApp';
import {
  advanceRenderTelemetry,
  syncVehicleMissionSpatialSignals,
} from '../voxel-game/scene/VoxelGameScene';
import { VehicleMissionCoordinator } from '../voxel-game/domain/VehicleMissionCoordinator';
import {
  createInitialVehicleTelemetry,
  resolveVehicleControllerConfig,
} from '../voxel-game/scene/VehicleController';

describe('vehicle controller config', () => {
  it('消防車の既存controller値をregistryから解決する', () => {
    expect(resolveVehicleControllerConfig('fire-truck')).toMatchObject({
      collider: { halfExtents: [1.45, 0.95, 1.7], offset: [0, 0.95, 0] },
      physics: { idleResponse: 4.8, mass: 1.4, movingResponse: 7.5, yawClamp: 5.2 },
      vehicleId: 'fire-truck',
    });
  });

  it('ブルドーザーのcontroller値と車種付き初期telemetryを解決する', () => {
    expect(resolveVehicleControllerConfig('bulldozer')).toMatchObject({
      collider: { halfExtents: [1.68, 0.95, 1.56], offset: [0, 0.9, 0] },
      physics: { idleResponse: 4.4, mass: 1.9, movingResponse: 6.8, yawClamp: 4.8 },
      vehicleId: 'bulldozer',
    });
    expect(createInitialVehicleTelemetry('bulldozer')).toEqual({
      forward: [0, 0, 1],
      id: 'bulldozer',
      mass: 1.9,
      position: [0, 0.8, 6],
      resetCount: 0,
      speed: 0,
    });
  });
});

describe('advanceRenderTelemetry', () => {
  it('実描画frame数を単調増加させ、最新draw call数を保持する', () => {
    expect(advanceRenderTelemetry({ renderedFrames: 9, rendererCalls: 31 }, 34)).toEqual({
      renderedFrames: 10,
      rendererCalls: 34,
    });
  });
});

describe('buildWorldTelemetry', () => {
  it('現在地区、目的地区、bounds、地区一覧を公開する', () => {
    expect(buildWorldTelemetry([0, 0.8, 6])).toEqual({
      bounds: { maxX: 36, maxZ: 36, minX: -36, minZ: -36 },
      currentDistrict: 'hub',
      destinationDistrict: 'fire',
      districts: [
        { id: 'hub', label: 'ちゅうおうしゃこ' },
        { id: 'park', label: 'こうえん' },
        { id: 'fire', label: 'かさいげんば' },
        { id: 'blocks', label: 'つみきひろば' },
        { id: 'south', label: 'じゆうそうこう' },
      ],
    });
  });

  it('選択中仕事に応じて工事地区を目的地へ公開する', () => {
    expect(buildWorldTelemetry([0, 0.8, 6], 'blocks').destinationDistrict).toBe('blocks');
  });
});

describe('syncVehicleMissionSpatialSignals', () => {
  it('ブルドーザーで工事地区へ着くと工事仕事を開始する', () => {
    const coordinator = new VehicleMissionCoordinator([], ['debris-a']);
    coordinator.selectVehicle('bulldozer', { atGarage: true, speed: 0 });

    syncVehicleMissionSpatialSignals(coordinator, [-24, 0.8, 13]);
    coordinator.advance(1);

    expect(coordinator.getSnapshot().mission.phase).toBe('active');
  });
});

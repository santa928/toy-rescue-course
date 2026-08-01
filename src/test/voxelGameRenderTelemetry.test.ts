import { describe, expect, it } from 'vitest';
import {
  buildWorldTelemetry,
  selectVehicleWithColorEffect,
} from '../voxel-game/VoxelGameApp';
import {
  advanceVehicleColorEffectFrame,
  advanceRenderTelemetry,
  syncVehicleMissionSpatialSignals,
} from '../voxel-game/scene/VoxelGameScene';
import { VehicleMissionCoordinator } from '../voxel-game/domain/VehicleMissionCoordinator';
import { VehicleColorEffectRuntime } from '../voxel-game/domain/VehicleColorEffectRuntime';
import {
  createInitialVehicleTelemetry,
  resolveVehicleControllerConfig,
} from '../voxel-game/scene/VehicleController';
import { COLOR_PLAY_SOURCES } from '../voxel-game/scene/worldLayout';

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
  it('実描画frame数、最新draw call数、物理renderer、車体batch数を保持する', () => {
    expect(advanceRenderTelemetry({
      renderedFrames: 9,
      rendererCalls: 31,
      rendererName: 'unknown',
      rendererVendor: 'unknown',
      vehicleDrawCalls: 7,
    }, 34, {
      rendererName: 'ANGLE Metal Renderer: Apple M4',
      rendererVendor: 'Apple',
      vehicleDrawCalls: 7,
    })).toEqual({
      renderedFrames: 10,
      rendererCalls: 34,
      rendererName: 'ANGLE Metal Renderer: Apple M4',
      rendererVendor: 'Apple',
      vehicleDrawCalls: 7,
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
    const coordinator = new VehicleMissionCoordinator([], { jobSeed: 1 });
    coordinator.selectVehicle('bulldozer', { atGarage: true, speed: 0 });

    syncVehicleMissionSpatialSignals(coordinator, [-24, 0.8, 13]);
    coordinator.advance(1);

    expect(coordinator.getSnapshot().mission.phase).toBe('active');
  });
});

describe('vehicle color integration', () => {
  it('手動clock直後frameは位置だけ同期して二重減算せず、次frameを50ms上限で進める', () => {
    const runtime = new VehicleColorEffectRuntime(COLOR_PLAY_SOURCES);
    runtime.syncVehiclePosition('fire-truck', COLOR_PLAY_SOURCES[0].position);
    runtime.syncVehiclePosition('fire-truck', [0, 0.8, 6]);

    advanceVehicleColorEffectFrame(runtime, 'fire-truck', [0, 0.8, 6], 0.2, true);
    expect(runtime.getSnapshot().remainingMilliseconds).toBe(12_000);

    advanceVehicleColorEffectFrame(runtime, 'fire-truck', [0, 0.8, 6], 0.2, false);
    expect(runtime.getSnapshot().remainingMilliseconds).toBe(11_950);
  });

  it('拒否切替では色を維持し、成功した別車種切替だけ解除する', () => {
    const coordinator = new VehicleMissionCoordinator([], { jobSeed: 1 });
    const runtime = new VehicleColorEffectRuntime(COLOR_PLAY_SOURCES);
    runtime.syncVehiclePosition('fire-truck', COLOR_PLAY_SOURCES[1].position);

    expect(selectVehicleWithColorEffect(
      coordinator,
      runtime,
      'bulldozer',
      { atGarage: false, speed: 0 },
    )).toBe(false);
    expect(runtime.getSnapshot()).toMatchObject({ active: true, colorId: 'blue' });

    expect(selectVehicleWithColorEffect(
      coordinator,
      runtime,
      'bulldozer',
      { atGarage: true, speed: 0 },
    )).toBe(true);
    expect(runtime.getSnapshot()).toMatchObject({ active: false, colorId: null });
  });
});

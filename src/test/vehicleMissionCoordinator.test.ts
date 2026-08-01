import { describe, expect, it } from 'vitest';
import {
  advanceVehicleMissionFrame,
  advanceVehicleMissionManualClock,
  VehicleMissionCoordinator,
} from '../voxel-game/domain/VehicleMissionCoordinator';

const BLOCK_IDS = ['block-a'] as const;
const DEBRIS_IDS = ['debris-a', 'debris-b', 'debris-c'] as const;

describe('VehicleMissionCoordinator', () => {
  it('消防車と消火仕事を初期選択する', () => {
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, DEBRIS_IDS);

    expect(coordinator.getSnapshot()).toMatchObject({
      mission: {
        destinationDistrict: 'fire',
        id: 'fire-rescue',
        objectiveLabel: '火のところへいこう',
        phase: 'assigned',
        progress: { current: 0, target: 1 },
        vehicleId: 'fire-truck',
      },
      selectedVehicleId: 'fire-truck',
    });
  });

  it.each([
    [{ atGarage: true, speed: 0 }, true],
    [{ atGarage: true, speed: 0.351 }, false],
    [{ atGarage: false, speed: 0 }, false],
  ] as const)('切替context=%jの結果を%sにする', (context, expected) => {
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, DEBRIS_IDS);

    expect(coordinator.selectVehicle('bulldozer', context)).toBe(expected);
    expect(coordinator.getSnapshot().selectedVehicleId)
      .toBe(expected ? 'bulldozer' : 'fire-truck');
  });

  it('選択先仕事だけを初期化し、共有積み木状態を乗り換え後も保持する', () => {
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, DEBRIS_IDS);
    coordinator.fireRuntime.registerBlockImpact('block-a', 4);
    coordinator.selectVehicle('bulldozer', { atGarage: true, speed: 0 });
    coordinator.registerDebrisClear('debris-a');
    coordinator.selectVehicle('fire-truck', { atGarage: true, speed: 0 });
    coordinator.selectVehicle('bulldozer', { atGarage: true, speed: 0 });

    expect(coordinator.getSnapshot().fire.blocks[0].phase).toBe('broken');
    expect(coordinator.getSnapshot().bulldozer.clearedCount).toBe(0);
  });

  it('ブルドーザー選択中は放水signalを消防runtimeへ渡さない', () => {
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, DEBRIS_IDS);
    coordinator.selectVehicle('bulldozer', { atGarage: true, speed: 0 });
    coordinator.setFireSignals({ sprayActive: true, sprayOnFire: true });
    coordinator.advance(2_500);

    expect(coordinator.getSnapshot().fire).toMatchObject({
      fireIntensity: 1,
      missionPhase: 'assigned',
    });
  });

  it('ブルドーザー進捗を共通仕事snapshotへ変換する', () => {
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, DEBRIS_IDS);
    coordinator.selectVehicle('bulldozer', { atGarage: true, speed: 0 });
    coordinator.registerDebrisClear('debris-a');

    expect(coordinator.getSnapshot().mission).toEqual({
      destinationDistrict: 'blocks',
      id: 'debris-clearance',
      objectiveLabel: 'がれき あと2こ',
      phase: 'active',
      progress: { current: 1, target: 3 },
      routeVisible: true,
      vehicleId: 'bulldozer',
    });
  });

  it('observable状態が変わったときだけ購読者へ通知する', () => {
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, DEBRIS_IDS);
    const snapshots: string[] = [];
    const unsubscribe = coordinator.subscribe((snapshot) => {
      snapshots.push(`${snapshot.selectedVehicleId}:${snapshot.mission.phase}`);
    });

    coordinator.advance(16);
    coordinator.selectVehicle('bulldozer', { atGarage: true, speed: 0 });
    coordinator.advance(16);
    coordinator.setSpatialSignals({ atGarage: false, atBulldozerWorksite: true });
    coordinator.advance(16);
    unsubscribe();
    coordinator.registerDebrisClear('debris-a');

    expect(snapshots).toEqual(['bulldozer:assigned', 'bulldozer:active']);
  });

  it('手動clock直後だけ通常frameをskipし、次frameを50ms上限で進める', () => {
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, DEBRIS_IDS);
    const manualClockFlag = { current: false };

    advanceVehicleMissionManualClock(coordinator, manualClockFlag, 20);
    expect(coordinator.getSnapshot().fire.elapsedMs).toBe(20);
    advanceVehicleMissionFrame(coordinator, manualClockFlag, 0.2);
    expect(coordinator.getSnapshot().fire.elapsedMs).toBe(20);
    advanceVehicleMissionFrame(coordinator, manualClockFlag, 0.2);
    expect(coordinator.getSnapshot().fire.elapsedMs).toBe(70);
  });
});

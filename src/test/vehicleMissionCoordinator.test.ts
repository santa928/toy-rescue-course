import { describe, expect, it } from 'vitest';
import {
  advanceVehicleMissionFrame,
  advanceVehicleMissionManualClock,
  VehicleMissionCoordinator,
} from '../voxel-game/domain/VehicleMissionCoordinator';
import { VEHICLE_JOBS } from '../voxel-game/domain/vehicleJobs';

const BLOCK_IDS = ['block-a'] as const;
const DEBRIS_IDS = VEHICLE_JOBS.bulldozer[0].debris.map(({ id }) => id);
const SOIL_IDS = VEHICLE_JOBS.excavator[0].targets.map(({ id }) => id);

/** 消防仕事を完了して車庫へ戻し、次のassigned仕事まで進める。 */
function completeFireJobAndReturn(coordinator: VehicleMissionCoordinator): void {
  coordinator.setFireSignals({ sprayActive: true, sprayOnFire: true });
  coordinator.advance(2_500);
  coordinator.setFireSignals({ sprayActive: false, sprayOnFire: false });
  coordinator.advance(1_800);
  coordinator.setSpatialSignals({ atBulldozerWorksite: false, atGarage: true });
  coordinator.advance(1);
}

describe('VehicleMissionCoordinator', () => {
  it('消防車と消火仕事を初期選択する', () => {
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, { jobSeed: 1 });

    expect(coordinator.getSnapshot()).toMatchObject({
      currentJobs: {
        bulldozer: { id: 'debris-north' },
        fire: { id: 'fire-side' },
      },
      jobSeed: 1,
      mission: {
        destinationDistrict: 'fire',
        id: 'fire-rescue',
        jobCycle: 1,
        jobId: 'fire-side',
        jobLabel: 'よこの火をけそう',
        objectiveLabel: 'よこの火をけそう',
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
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, { jobSeed: 1 });

    expect(coordinator.selectVehicle('bulldozer', context)).toBe(expected);
    expect(coordinator.getSnapshot().selectedVehicleId)
      .toBe(expected ? 'bulldozer' : 'fire-truck');
  });

  it('選択先仕事だけを初期化し、共有積み木状態を乗り換え後も保持する', () => {
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, { jobSeed: 1 });
    coordinator.fireRuntime.registerBlockImpact('block-a', 4);
    coordinator.selectVehicle('bulldozer', { atGarage: true, speed: 0 });
    coordinator.registerDebrisClear(DEBRIS_IDS[0]);
    coordinator.selectVehicle('fire-truck', { atGarage: true, speed: 0 });
    coordinator.selectVehicle('bulldozer', { atGarage: true, speed: 0 });

    expect(coordinator.getSnapshot().fire.blocks[0].phase).toBe('broken');
    expect(coordinator.getSnapshot().bulldozer.clearedCount).toBe(0);
  });

  it('ブルドーザー選択中は放水signalを消防runtimeへ渡さない', () => {
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, { jobSeed: 1 });
    coordinator.selectVehicle('bulldozer', { atGarage: true, speed: 0 });
    coordinator.setFireSignals({ sprayActive: true, sprayOnFire: true });
    coordinator.advance(2_500);

    expect(coordinator.getSnapshot().fire).toMatchObject({
      fireIntensity: 1,
      missionPhase: 'assigned',
    });
  });

  it('ブルドーザー進捗を共通仕事snapshotへ変換する', () => {
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, { jobSeed: 1 });
    coordinator.selectVehicle('bulldozer', { atGarage: true, speed: 0 });
    coordinator.registerDebrisClear(DEBRIS_IDS[0]);

    expect(coordinator.getSnapshot().mission).toEqual({
      destinationDistrict: 'blocks',
      id: 'debris-clearance',
      jobCycle: 1,
      jobId: 'debris-north',
      jobLabel: 'きたのがれきをかたづけよう',
      objectiveLabel: 'がれき あと2こ',
      phase: 'active',
      progress: { current: 1, target: 3 },
      routeVisible: true,
      vehicleId: 'bulldozer',
    });
  });

  it('ショベルカーの土山進捗を共通仕事snapshotへ変換する', () => {
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, { jobSeed: 1 });
    coordinator.selectVehicle('excavator', { atGarage: true, speed: 0 });
    coordinator.registerActionTargetCompletion(SOIL_IDS[0]);

    expect(coordinator.getSnapshot()).toMatchObject({
      excavator: {
        completedCount: 1,
        missionPhase: 'active',
        targetCount: 3,
      },
      mission: {
        destinationDistrict: 'blocks',
        id: 'soil-digging',
        jobCycle: 1,
        objectiveLabel: 'つち あと2こ',
        phase: 'active',
        progress: { current: 1, target: 3 },
        vehicleId: 'excavator',
      },
      selectedVehicleId: 'excavator',
    });
  });

  it('observable状態が変わったときだけ購読者へ通知する', () => {
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, { jobSeed: 1 });
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
    coordinator.registerDebrisClear(DEBRIS_IDS[0]);

    expect(snapshots).toEqual(['bulldozer:assigned', 'bulldozer:active']);
  });

  it('手動clock直後だけ通常frameをskipし、次frameを50ms上限で進める', () => {
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, { jobSeed: 1 });
    const manualClockFlag = { current: false };

    advanceVehicleMissionManualClock(coordinator, manualClockFlag, 20);
    expect(coordinator.getSnapshot().fire.elapsedMs).toBe(20);
    advanceVehicleMissionFrame(coordinator, manualClockFlag, 0.2);
    expect(coordinator.getSnapshot().fire.elapsedMs).toBe(20);
    advanceVehicleMissionFrame(coordinator, manualClockFlag, 0.2);
    expect(coordinator.getSnapshot().fire.elapsedMs).toBe(70);
  });

  it('同じseedで同じ仕事順を再現し、3件を使い切るまで重複と連続を作らない', () => {
    const first = new VehicleMissionCoordinator(BLOCK_IDS, {
      jobSeed: 42,
      rotateJobsOnCompletion: true,
    });
    const second = new VehicleMissionCoordinator(BLOCK_IDS, {
      jobSeed: 42,
      rotateJobsOnCompletion: true,
    });
    const firstSequence: string[] = [];
    const secondSequence: string[] = [];

    for (let index = 0; index < 6; index += 1) {
      firstSequence.push(first.getSnapshot().mission.jobId);
      secondSequence.push(second.getSnapshot().mission.jobId);
      completeFireJobAndReturn(first);
      completeFireJobAndReturn(second);
    }

    expect(firstSequence).toEqual(secondSequence);
    expect(new Set(firstSequence.slice(0, 3)).size).toBe(3);
    expect(new Set(firstSequence.slice(3, 6)).size).toBe(3);
    expect(firstSequence.every((jobId, index) => (
      index === 0 || jobId !== firstSequence[index - 1]
    ))).toBe(true);
  });

  it('scene接続前の既定設定では完了帰庫しても同じ仕事を維持する', () => {
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, { jobSeed: 42 });
    const before = coordinator.getSnapshot().mission;

    completeFireJobAndReturn(coordinator);

    expect(coordinator.getSnapshot().mission).toMatchObject({
      jobCycle: before.jobCycle,
      jobId: before.jobId,
      phase: 'assigned',
    });
  });

  it('未完了帰庫と乗り換えでは現在仕事と巡回番号を変えない', () => {
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, { jobSeed: 77 });
    const initial = coordinator.getSnapshot();

    coordinator.setSpatialSignals({ atBulldozerWorksite: false, atGarage: true });
    coordinator.advance(16);
    coordinator.selectVehicle('bulldozer', { atGarage: true, speed: 0 });
    coordinator.selectVehicle('fire-truck', { atGarage: true, speed: 0 });

    expect(coordinator.getSnapshot()).toMatchObject({
      currentJobs: {
        bulldozer: { id: initial.currentJobs.bulldozer.id },
        fire: { id: initial.currentJobs.fire.id },
      },
      mission: {
        jobCycle: 1,
        jobId: initial.currentJobs.fire.id,
      },
    });
  });

  it('ブルドーザー完了帰庫で次仕事へ進み、runtime対象IDも同時に入れ替える', () => {
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, {
      jobSeed: 123,
      rotateJobsOnCompletion: true,
    });
    coordinator.selectVehicle('bulldozer', { atGarage: true, speed: 0 });
    const before = coordinator.getSnapshot();

    for (const { id } of before.currentJobs.bulldozer.debris) {
      expect(coordinator.registerDebrisClear(id)).toBe(true);
    }
    coordinator.advance(1_800);
    coordinator.setSpatialSignals({ atBulldozerWorksite: false, atGarage: true });
    coordinator.advance(1);

    const after = coordinator.getSnapshot();
    expect(after.currentJobs.bulldozer.id).not.toBe(before.currentJobs.bulldozer.id);
    expect(after.mission).toMatchObject({
      jobCycle: 2,
      jobId: after.currentJobs.bulldozer.id,
      phase: 'assigned',
      progress: { current: 0, target: 3 },
    });
    expect(after.bulldozer.debris.map(({ id }) => id)).toEqual(
      after.currentJobs.bulldozer.debris.map(({ id }) => id),
    );
  });
});

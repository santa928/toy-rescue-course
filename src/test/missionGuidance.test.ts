import { describe, expect, it } from 'vitest';
import { VehicleMissionCoordinator } from '../voxel-game/domain/VehicleMissionCoordinator';
import { buildMissionGuidance } from '../voxel-game/domain/missionGuidance';
import { projectWorldToMissionMap } from '../voxel-game/ui/missionMap';

const BLOCK_IDS = ['block-a'] as const;

describe('buildMissionGuidance', () => {
  it.each([
    {
      instructionLabel: 'がれきへ ブレードでぶつかる',
      targetLabel: 'つぎの がれき',
      targetPosition: [-29.5, 0.8, 12.5],
      vehicleId: 'bulldozer',
    },
    {
      instructionLabel: 'つちのまえで とまり バケットをおす',
      targetLabel: 'つぎの つち',
      targetPosition: [-29.5, 0.65, 12.5],
      vehicleId: 'excavator',
    },
    {
      instructionLabel: 'あおいゲートを サイレンでとおる',
      targetLabel: 'つぎの ゲート',
      targetPosition: [0, 0.7, 17],
      vehicleId: 'police',
    },
  ] as const)('$vehicleIdへ対象・操作・次の位置を具体的に案内する', ({
    instructionLabel,
    targetLabel,
    targetPosition,
    vehicleId,
  }) => {
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, { jobSeed: 1 });
    coordinator.selectVehicle(vehicleId, { atGarage: true, speed: 0 });

    expect(buildMissionGuidance(coordinator.getSnapshot())).toMatchObject({
      completionLabel: 'クリア 0/3',
      instructionLabel,
      targetLabel,
      targetPosition,
    });
  });

  it('完了した対象を飛ばして未完了の次ターゲットを案内する', () => {
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, { jobSeed: 1 });
    coordinator.selectVehicle('bulldozer', { atGarage: true, speed: 0 });
    coordinator.registerDebrisClear('debris-timber');

    expect(buildMissionGuidance(coordinator.getSnapshot())).toMatchObject({
      completionLabel: 'クリア 1/3',
      targetPosition: [-24, 0.8, 13],
    });
  });

  it('消防仕事の完了後は次の仕事を出す車庫を案内する', () => {
    const coordinator = new VehicleMissionCoordinator(BLOCK_IDS, {
      jobSeed: 1,
      rotateJobsOnCompletion: true,
    });
    coordinator.setFireSignals({ sprayActive: true, sprayOnFire: true });
    coordinator.advance(2_500);
    coordinator.setFireSignals({ sprayActive: false, sprayOnFire: false });
    coordinator.advance(1_800);

    expect(buildMissionGuidance(coordinator.getSnapshot())).toEqual({
      completionLabel: 'クリア 1/1',
      instructionLabel: 'しゃこへもどると つぎのおしごと',
      targetLabel: 'ちゅうおうしゃこ',
      targetPosition: [0, 0.8, 6],
    });
  });
});

describe('projectWorldToMissionMap', () => {
  it.each([
    { position: [-48, 0, -48], result: { leftPercent: 0, topPercent: 0 } },
    { position: [0, 0, 0], result: { leftPercent: 50, topPercent: 50 } },
    { position: [48, 0, 48], result: { leftPercent: 100, topPercent: 100 } },
    { position: [80, 0, -80], result: { leftPercent: 100, topPercent: 0 } },
  ] as const)('$positionを96×96マップ内の$resultへ投影する', ({ position, result }) => {
    expect(projectWorldToMissionMap(position, {
      maxX: 48,
      maxZ: 48,
      minX: -48,
      minZ: -48,
    })).toEqual(result);
  });
});

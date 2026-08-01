import { describe, expect, it } from 'vitest';
import {
  VEHICLE_DEFINITIONS,
  canSwitchVehicle,
  getVehicleDefinition,
  validateVehicleDefinitions,
  type VehicleDefinition,
} from '../voxel-game/domain/vehicleDefinitions';

describe('vehicle definitions', () => {
  it('消防車、ブルドーザー、ショベルカー、救急車、パトカーを一意な利用可能車種として公開する', () => {
    expect(VEHICLE_DEFINITIONS.map(({ id }) => id)).toEqual([
      'fire-truck',
      'bulldozer',
      'excavator',
      'ambulance',
      'police',
    ]);
    expect(validateVehicleDefinitions(VEHICLE_DEFINITIONS)).toEqual([]);
  });

  it('未知の車種IDを初期消防車へ安全に戻す', () => {
    expect(getVehicleDefinition('invalid-vehicle')).toBe(VEHICLE_DEFINITIONS[0]);
    expect(getVehicleDefinition(null)).toBe(VEHICLE_DEFINITIONS[0]);
  });

  it('消防車の受け入れ済み物理値と外接寸法を維持する', () => {
    expect(getVehicleDefinition('fire-truck')).toMatchObject({
      collider: {
        halfExtents: [1.45, 0.95, 1.7],
        offset: [0, 0.95, 0],
      },
      physics: {
        idleResponse: 4.8,
        mass: 1.4,
        movingResponse: 7.5,
        yawClamp: 5.2,
      },
      visualBounds: {
        offset: [0, 0.84, 0],
        scale: [2.88, 1.92, 3.36],
      },
    });
  });

  it('ショベルカーへ遅めで小回りの利く物理と長い前方外接を割り当てる', () => {
    expect(getVehicleDefinition('excavator')).toMatchObject({
      action: { ariaLabel: 'バケットを動かす', label: 'バケット' },
      collider: {
        halfExtents: [1.6, 0.95, 1.75],
        offset: [0, 0.95, 0],
      },
      label: 'ショベルカー',
      missionId: 'soil-digging',
      physics: {
        idleResponse: 4.3,
        mass: 2,
        movingResponse: 6.4,
        yawClamp: 4.9,
      },
      visualBounds: {
        offset: [0, 0.84, -0.18],
        scale: [3.12, 2.08, 3.72],
      },
    });
  });

  it('救急車へ停止手当て向けの物理、箱形外接、主操作を割り当てる', () => {
    expect(getVehicleDefinition('ambulance')).toMatchObject({
      action: { ariaLabel: '手当てをする', label: 'てあて' },
      collider: { halfExtents: [1.5, 0.98, 1.68], offset: [0, 0.98, 0] },
      label: 'きゅうきゅうしゃ',
      missionId: 'patient-care',
      physics: { idleResponse: 4.7, mass: 1.6, movingResponse: 7.2, yawClamp: 5.1 },
      visualBounds: { offset: [0, 0.84, 0], scale: [2.64, 1.92, 3.12] },
    });
  });

  it('パトカーへ巡回向けの軽快な物理、低い外接、サイレン操作を割り当てる', () => {
    expect(getVehicleDefinition('police')).toMatchObject({
      action: { ariaLabel: 'サイレンを鳴らす', label: 'サイレン' },
      collider: { halfExtents: [1.48, 0.92, 1.62], offset: [0, 0.92, 0] },
      label: 'パトカー',
      missionId: 'patrol',
      physics: { idleResponse: 4.9, mass: 1.45, movingResponse: 7.6, yawClamp: 5.4 },
      visualBounds: { offset: [0, 0.78, 0], scale: [2.64, 1.76, 3.12] },
    });
  });

  it.each([
    [true, 0, true],
    [true, 0.35, true],
    [true, 0.351, false],
    [true, -0.01, false],
    [false, 0, false],
    [true, Number.NaN, false],
    [true, Number.POSITIVE_INFINITY, false],
  ] as const)(
    '車庫内=%s、速度=%sの乗り換え可否を%sにする',
    (atGarage, speed, expected) => {
      expect(canSwitchVehicle({ atGarage, speed })).toBe(expected);
    },
  );

  it('重複ID、空文言、非正値の物理値を不正定義として列挙する', () => {
    const valid = VEHICLE_DEFINITIONS[0];
    const invalid = {
      ...VEHICLE_DEFINITIONS[1],
      action: { ariaLabel: '', label: '' },
      id: 'fire-truck',
      label: '',
      physics: { ...VEHICLE_DEFINITIONS[1].physics, mass: 0 },
    } as unknown as VehicleDefinition;

    expect(validateVehicleDefinitions([valid, invalid])).toEqual([
      'Duplicate vehicle id: fire-truck',
      'Vehicle fire-truck must have non-empty labels',
      'Vehicle fire-truck has invalid physics value: mass',
    ]);
  });
});

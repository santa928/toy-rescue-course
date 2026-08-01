import { describe, expect, it } from 'vitest';
import {
  VEHICLE_DEFINITIONS,
  canSwitchVehicle,
  getVehicleDefinition,
  validateVehicleDefinitions,
  type VehicleDefinition,
} from '../voxel-game/domain/vehicleDefinitions';

describe('vehicle definitions', () => {
  it('消防車とブルドーザーを一意な利用可能車種として公開する', () => {
    expect(VEHICLE_DEFINITIONS.map(({ id }) => id)).toEqual(['fire-truck', 'bulldozer']);
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

import { describe, expect, it } from 'vitest';
import {
  createBulldozerMissionTelemetry,
  getBladeCenter,
  isBladeTouchingDebris,
  shouldClearDebris,
} from '../voxel-game/scene/BulldozerDebrisMission';

const VALID_CONTACT = {
  actionActive: true,
  bladeCenter: [-28, 0.7, 12] as const,
  debrisPosition: [-28, 0.8, 12] as const,
  debrisRadius: 1.15,
  speed: 0.6,
  vehicleId: 'bulldozer' as const,
};

describe('bulldozer debris mission', () => {
  it('routeと次対象markerを別々に数える初期telemetryを持つ', () => {
    expect(createBulldozerMissionTelemetry()).toMatchObject({
      routeMarkerCount: 0,
      targetMarkerCenter: [0, -40, 0],
      targetMarkerCount: 0,
    });
  });

  it('車体前方1.75unitをblade中心として返す', () => {
    expect(getBladeCenter({
      forward: [0.6, 0, 0.8],
      position: [-24, 0.8, 10],
    })).toEqual([-22.95, 1.15, 11.4]);
  });

  it('ブルドーザーの作動中blade接触だけを片付けとして扱う', () => {
    expect(shouldClearDebris(VALID_CONTACT)).toBe(true);
    expect(shouldClearDebris({ ...VALID_CONTACT, vehicleId: 'fire-truck' })).toBe(false);
    expect(shouldClearDebris({ ...VALID_CONTACT, actionActive: false })).toBe(false);
    expect(shouldClearDebris({ ...VALID_CONTACT, speed: 0.599 })).toBe(false);
    expect(shouldClearDebris({ ...VALID_CONTACT, speed: Number.NaN })).toBe(false);
    expect(shouldClearDebris({ ...VALID_CONTACT, bladeCenter: [-20, 0.7, 12] })).toBe(false);
  });

  it('片付け速度未満でも作動中のblade接触を亀裂演出へ渡す', () => {
    expect(isBladeTouchingDebris({ ...VALID_CONTACT, speed: 0 })).toBe(true);
    expect(isBladeTouchingDebris({ ...VALID_CONTACT, actionActive: false, speed: 0 })).toBe(false);
    expect(isBladeTouchingDebris({ ...VALID_CONTACT, vehicleId: 'excavator', speed: 0 })).toBe(false);
    expect(isBladeTouchingDebris({
      ...VALID_CONTACT,
      bladeCenter: [-20, 0.7, 12],
      speed: 0,
    })).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  getBladeCenter,
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
});

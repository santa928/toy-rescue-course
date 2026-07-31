import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_WORLD_MAP,
  resolveWorldDistrict,
  validateProductionWorldMap,
} from '../voxel-game/scene/productionWorldMap';

describe('PRODUCTION_WORLD_MAP', () => {
  it('72×72の境界と中央ハブ＋4地区を公開する', () => {
    expect(PRODUCTION_WORLD_MAP.bounds).toEqual({
      maxX: 36, maxZ: 36, minX: -36, minZ: -36,
    });
    expect(PRODUCTION_WORLD_MAP.districts.map(({ id }) => id)).toEqual([
      'hub', 'park', 'fire', 'blocks', 'south',
    ]);
  });

  it('道路12本が中央ハブから4地区を接続する', () => {
    expect(PRODUCTION_WORLD_MAP.roads).toHaveLength(12);
    expect(new Set(PRODUCTION_WORLD_MAP.roads.flatMap(({ connects }) => connects))).toEqual(
      new Set(['hub', 'park', 'fire', 'blocks', 'south']),
    );
    expect(PRODUCTION_WORLD_MAP.roads.every(({ scale }) => (
      Math.max(scale[0], scale[2]) >= 16 && Math.min(scale[0], scale[2]) >= 4
    ))).toBe(true);
  });

  it('visualとsolidを同じbox定義で共有する', () => {
    expect(PRODUCTION_WORLD_MAP.visualBoxes).toHaveLength(25);
    expect(PRODUCTION_WORLD_MAP.visualBoxes.filter(({ solid }) => solid)).toHaveLength(12);
    expect(PRODUCTION_WORLD_MAP.visualBoxes.every(({ id }) => id.length > 0)).toBe(true);
  });

  it('地区、道路、boxのIDと数値契約を検証する', () => {
    expect(validateProductionWorldMap(PRODUCTION_WORLD_MAP)).toEqual([]);
    const duplicate = {
      ...PRODUCTION_WORLD_MAP,
      roads: [...PRODUCTION_WORLD_MAP.roads, PRODUCTION_WORLD_MAP.roads[0]],
    };
    expect(validateProductionWorldMap(duplicate)).toContain('duplicate id: road-hub-east-west');
  });

  it('地区と全boxをworld境界内へ収める', () => {
    expect(PRODUCTION_WORLD_MAP.districts.every(({ bounds }) => (
      bounds.minX >= -36 && bounds.maxX <= 36
      && bounds.minZ >= -36 && bounds.maxZ <= 36
    ))).toBe(true);
    expect(PRODUCTION_WORLD_MAP.visualBoxes.every(({ position, scale }) => (
      position[0] - scale[0] / 2 >= -36
      && position[0] + scale[0] / 2 <= 36
      && position[2] - scale[2] / 2 >= -36
      && position[2] + scale[2] / 2 <= 36
    ))).toBe(true);
  });

  it.each([
    [[0, 0.8, 6], 'hub'],
    [[0, 0, -24], 'park'],
    [[26, 1.2, -18], 'fire'],
    [[-24, 0.18, 6], 'blocks'],
    [[0, 0, 24], 'south'],
    [[12, 0, 0], 'road'],
    [[40, 0, 0], 'outside'],
    [[Number.NaN, 0, 0], 'outside'],
    [[0, Number.NaN, 0], 'outside'],
    [[0, Number.POSITIVE_INFINITY, 0], 'outside'],
  ] as const)('%jを%s地区として解決する', (position, expected) => {
    expect(resolveWorldDistrict(position)).toBe(expected);
  });
});

import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_WORLD_MAP,
  resolveWorldDistrict,
  validateProductionWorldMap,
} from '../voxel-game/scene/productionWorldMap';

const EXPECTED_LANDMARKS = {
  blockPlaza: {
    position: [-24, 0.18, 6] as const,
    scale: [14, 0.34, 16] as const,
  },
  breakableBlocks: [
    { color: '#ef4444', id: 'plaza-red', position: [-26.7, 0.75, 9.5] as const },
    { color: '#facc15', id: 'plaza-yellow', position: [-21.5, 0.75, 0] as const },
    { color: '#3b82f6', id: 'plaza-blue', position: [-21.3, 0.75, 4.6] as const },
    { color: '#65a30d', id: 'plaza-green', position: [-26.7, 0.75, 2.5] as const },
  ],
  fire: [26, 1.2, -18] as const,
  fireSprayTarget: [26.9, 1.45, -16.1] as const,
  garage: [0, 0.8, 6] as const,
  park: [0, 0, -24] as const,
} as const;

const MAP_WITH_LANDMARK_FIXTURE = {
  ...PRODUCTION_WORLD_MAP,
  landmarks: EXPECTED_LANDMARKS,
} as const;

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

  it('ゲームプレイ座標を型付きlandmarksとして一意に公開する', () => {
    const map = PRODUCTION_WORLD_MAP as typeof PRODUCTION_WORLD_MAP & {
      readonly landmarks?: typeof EXPECTED_LANDMARKS;
    };

    expect(map.landmarks).toEqual(EXPECTED_LANDMARKS);
  });

  it('地区、道路、boxのIDと数値契約を検証する', () => {
    expect(validateProductionWorldMap(PRODUCTION_WORLD_MAP)).toEqual([]);
    const duplicate = {
      ...PRODUCTION_WORLD_MAP,
      roads: [...PRODUCTION_WORLD_MAP.roads, PRODUCTION_WORLD_MAP.roads[0]],
    };
    expect(validateProductionWorldMap(duplicate)).toContain('duplicate id: road-hub-east-west');
  });

  it.each([
    [
      'world boundsの非有限値',
      { ...MAP_WITH_LANDMARK_FIXTURE, bounds: { maxX: Number.NaN, maxZ: 36, minX: -36, minZ: -36 } },
      'non-finite world bounds',
    ],
    [
      'world boundsの逆転',
      { ...MAP_WITH_LANDMARK_FIXTURE, bounds: { maxX: -36, maxZ: 36, minX: 36, minZ: -36 } },
      'invalid world bounds',
    ],
    [
      'district boundsの非有限値',
      {
        ...MAP_WITH_LANDMARK_FIXTURE,
        districts: MAP_WITH_LANDMARK_FIXTURE.districts.map((district) => (
          district.id === 'hub'
            ? { ...district, bounds: { ...district.bounds, minX: Number.NaN } }
            : district
        )),
      },
      'non-finite district bounds: hub',
    ],
    [
      'district boundsの逆転',
      {
        ...MAP_WITH_LANDMARK_FIXTURE,
        districts: MAP_WITH_LANDMARK_FIXTURE.districts.map((district) => (
          district.id === 'hub'
            ? { ...district, bounds: { ...district.bounds, minX: 11 } }
            : district
        )),
      },
      'invalid district bounds: hub',
    ],
    [
      'district boundsのworld外配置',
      {
        ...MAP_WITH_LANDMARK_FIXTURE,
        districts: MAP_WITH_LANDMARK_FIXTURE.districts.map((district) => (
          district.id === 'hub'
            ? { ...district, bounds: { ...district.bounds, maxX: 37 } }
            : district
        )),
      },
      'district outside world bounds: hub',
    ],
  ])('%sを拒否する', (_description, map, expectedError) => {
    expect(validateProductionWorldMap(map)).toContain(expectedError);
  });

  it.each([
    [
      'road',
      {
        ...MAP_WITH_LANDMARK_FIXTURE,
        roads: MAP_WITH_LANDMARK_FIXTURE.roads.map((road, index) => (
          index === 0 ? { ...road, rotation: [0, Number.NaN, 0] as const } : road
        )),
      },
      'non-finite rotation: road-hub-east-west',
    ],
    [
      'visual box',
      {
        ...MAP_WITH_LANDMARK_FIXTURE,
        visualBoxes: MAP_WITH_LANDMARK_FIXTURE.visualBoxes.map((box, index) => (
          index === 0 ? { ...box, rotation: [0, 0, Number.POSITIVE_INFINITY] as const } : box
        )),
      },
      'non-finite rotation: park-ground',
    ],
  ])('%sの非有限rotationを拒否する', (_description, map, expectedError) => {
    expect(validateProductionWorldMap(map)).toContain(expectedError);
  });

  it('breakable blockを含む全IDの重複を拒否する', () => {
    const duplicate = {
      ...MAP_WITH_LANDMARK_FIXTURE,
      landmarks: {
        ...EXPECTED_LANDMARKS,
        breakableBlocks: EXPECTED_LANDMARKS.breakableBlocks.map((block, index) => (
          index === 0 ? { ...block, id: 'road-hub-east-west' } : block
        )),
      },
    };

    expect(validateProductionWorldMap(duplicate)).toContain('duplicate id: road-hub-east-west');
  });

  it.each([
    [
      '非有限landmark',
      {
        ...MAP_WITH_LANDMARK_FIXTURE,
        landmarks: { ...EXPECTED_LANDMARKS, garage: [0, Number.NaN, 6] as const },
      },
      'non-finite landmark: garage',
    ],
    [
      'world外landmark',
      {
        ...MAP_WITH_LANDMARK_FIXTURE,
        landmarks: { ...EXPECTED_LANDMARKS, park: [40, 0, -24] as const },
      },
      'landmark outside world bounds: park',
    ],
    [
      '非有限breakable block landmark',
      {
        ...MAP_WITH_LANDMARK_FIXTURE,
        landmarks: {
          ...EXPECTED_LANDMARKS,
          breakableBlocks: EXPECTED_LANDMARKS.breakableBlocks.map((block, index) => (
            index === 0 ? { ...block, position: [Number.NaN, 0.75, 9.5] as const } : block
          )),
        },
      },
      'non-finite landmark: breakableBlock:plaza-red',
    ],
    [
      'world外breakable block landmark',
      {
        ...MAP_WITH_LANDMARK_FIXTURE,
        landmarks: {
          ...EXPECTED_LANDMARKS,
          breakableBlocks: EXPECTED_LANDMARKS.breakableBlocks.map((block, index) => (
            index === 0 ? { ...block, position: [-40, 0.75, 9.5] as const } : block
          )),
        },
      },
      'landmark outside world bounds: breakableBlock:plaza-red',
    ],
    [
      'block plazaの非正scale',
      {
        ...MAP_WITH_LANDMARK_FIXTURE,
        landmarks: {
          ...EXPECTED_LANDMARKS,
          blockPlaza: { ...EXPECTED_LANDMARKS.blockPlaza, scale: [14, 0, 16] as const },
        },
      },
      'invalid landmark scale: blockPlaza',
    ],
    [
      'plaza外breakable block',
      {
        ...MAP_WITH_LANDMARK_FIXTURE,
        landmarks: {
          ...EXPECTED_LANDMARKS,
          breakableBlocks: EXPECTED_LANDMARKS.breakableBlocks.map((block, index) => (
            index === 0 ? { ...block, position: [-10, 0.75, 9.5] as const } : block
          )),
        },
      },
      'breakable outside block plaza: plaza-red',
    ],
  ])('%sを拒否する', (_description, map, expectedError) => {
    expect(validateProductionWorldMap(map)).toContain(expectedError);
  });

  it.each([
    ['garage', { ...EXPECTED_LANDMARKS, garage: EXPECTED_LANDMARKS.park }, 'landmark garage expected hub, received park'],
    ['park', { ...EXPECTED_LANDMARKS, park: EXPECTED_LANDMARKS.fire }, 'landmark park expected park, received fire'],
    ['fire', { ...EXPECTED_LANDMARKS, fire: EXPECTED_LANDMARKS.garage }, 'landmark fire expected fire, received hub'],
    [
      'fireSprayTarget',
      { ...EXPECTED_LANDMARKS, fireSprayTarget: EXPECTED_LANDMARKS.garage },
      'landmark fireSprayTarget expected fire, received hub',
    ],
    [
      'blockPlaza',
      {
        ...EXPECTED_LANDMARKS,
        blockPlaza: { ...EXPECTED_LANDMARKS.blockPlaza, position: EXPECTED_LANDMARKS.garage },
      },
      'landmark blockPlaza expected blocks, received hub',
    ],
  ])('%sを期待地区外へ置いたmapを拒否する', (_description, landmarks, expectedError) => {
    expect(validateProductionWorldMap({ ...MAP_WITH_LANDMARK_FIXTURE, landmarks })).toContain(
      expectedError,
    );
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

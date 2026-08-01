import { describe, expect, it } from 'vitest';
import * as ProductionWorldMapModule from '../voxel-game/scene/productionWorldMap';
import {
  PRODUCTION_WORLD_MAP,
  resolveWorldDistrict,
  type ProductionWorldMapDefinition,
  validateProductionWorldMap,
} from '../voxel-game/scene/productionWorldMap';

const EXPECTED_LANDMARKS = {
  blockPlaza: {
    position: [-24, 0.18, 6] as const,
    scale: [14, 0.34, 16] as const,
  },
  colorPlaySources: [
    {
      color: '#ef4444',
      colorId: 'red',
      id: 'pool-red',
      kind: 'pool',
      position: [-9.4, 0.24, 18.5] as const,
      triggerBounds: { maxX: -7.1, maxZ: 20.3, minX: -11.7, minZ: 16.7 },
    },
    {
      color: '#3b82f6',
      colorId: 'blue',
      id: 'pool-blue',
      kind: 'pool',
      position: [-9.4, 0.24, 24] as const,
      triggerBounds: { maxX: -7.1, maxZ: 25.8, minX: -11.7, minZ: 22.2 },
    },
    {
      color: '#facc15',
      colorId: 'yellow',
      id: 'pool-yellow',
      kind: 'pool',
      position: [-9.4, 0.24, 29.5] as const,
      triggerBounds: { maxX: -7.1, maxZ: 31.3, minX: -11.7, minZ: 27.7 },
    },
    {
      color: '#ef4444',
      colorId: 'red',
      id: 'shower-red',
      kind: 'shower',
      position: [9.4, 1.6, 18.5] as const,
      triggerBounds: { maxX: 11.7, maxZ: 20.3, minX: 7.1, minZ: 16.7 },
    },
    {
      color: '#3b82f6',
      colorId: 'blue',
      id: 'shower-blue',
      kind: 'shower',
      position: [9.4, 1.6, 24] as const,
      triggerBounds: { maxX: 11.7, maxZ: 25.8, minX: 7.1, minZ: 22.2 },
    },
    {
      color: '#facc15',
      colorId: 'yellow',
      id: 'shower-yellow',
      kind: 'shower',
      position: [9.4, 1.6, 29.5] as const,
      triggerBounds: { maxX: 11.7, maxZ: 31.3, minX: 7.1, minZ: 27.7 },
    },
  ],
  breakableBlocks: [
    { color: '#ef4444', id: 'plaza-red', position: [-26.7, 0.75, 9.5] as const },
    { color: '#facc15', id: 'plaza-yellow', position: [-21.5, 0.75, 0] as const },
    { color: '#3b82f6', id: 'plaza-blue', position: [-21.3, 0.75, 4.6] as const },
    { color: '#65a30d', id: 'plaza-green', position: [-26.7, 0.75, 2.5] as const },
  ],
  bulldozerDebris: [
    {
      id: 'debris-timber',
      palette: 'timber',
      position: [-29.5, 0.8, 12.5] as const,
      radius: 1.15,
    },
    {
      id: 'debris-stone',
      palette: 'stone',
      position: [-24, 0.8, 13] as const,
      radius: 1.15,
    },
    {
      id: 'debris-crate',
      palette: 'crate',
      position: [-18.2, 0.8, 12] as const,
      radius: 1.15,
    },
  ],
  bulldozerRouteMarkers: [
    [-3, 0.26, 0] as const,
    [-7, 0.26, 0] as const,
    [-11, 0.26, 0] as const,
    [-15, 0.26, 0] as const,
    [-19, 0.26, 2] as const,
    [-22, 0.26, 6] as const,
    [-24, 0.26, 9] as const,
  ],
  celebrationStarCenters: [
    [24.8, 1, -11] as const,
    [22.5, 1.2, -11.4] as const,
    [31, 1, -11.8] as const,
    [24, 1.8, -12.2] as const,
    [31.25, 3, -15] as const,
    [28.8, 1.7, -13] as const,
  ],
  fire: [26, 1.2, -18] as const,
  fireRouteMarkers: [
    [0, 0.26, 3] as const,
    [0, 0.26, 0] as const,
    [4, 0.26, 0] as const,
    [8, 0.26, 0] as const,
    [12, 0.26, 0] as const,
    [16, 0.26, 0] as const,
    [20, 0.26, 0] as const,
    [24, 0.26, 0] as const,
    [28, 0.26, 0] as const,
    [30, 0.26, -4] as const,
    [30, 0.26, -8] as const,
    [28, 0.26, -13] as const,
  ],
  fireSprayTarget: [26.9, 1.45, -16.1] as const,
  garage: [0, 0.8, 6] as const,
  park: [0, 0, -24] as const,
} as const;

const MAP_WITH_LANDMARK_FIXTURE = {
  ...PRODUCTION_WORLD_MAP,
  landmarks: EXPECTED_LANDMARKS,
} as const;

describe('PRODUCTION_WORLD_MAP', () => {
  it('canonical mapをmodule初期化guardへ接続し、不正定義を明確なErrorで拒否する', () => {
    type ProductionWorldMapStartupGuard = <MapDefinition extends ProductionWorldMapDefinition>(
      map: MapDefinition,
    ) => MapDefinition;
    const requireValidMap = (
      ProductionWorldMapModule as typeof ProductionWorldMapModule & {
        readonly requireValidProductionWorldMap?: ProductionWorldMapStartupGuard;
      }
    ).requireValidProductionWorldMap;
    const invalidMap = {
      ...MAP_WITH_LANDMARK_FIXTURE,
      bounds: { maxX: -36, maxZ: 36, minX: 36, minZ: -36 },
    } as const;

    expect(requireValidMap).toBeTypeOf('function');
    if (!requireValidMap) return;
    expect(requireValidMap(PRODUCTION_WORLD_MAP)).toBe(PRODUCTION_WORLD_MAP);
    expect(() => requireValidMap(invalidMap)).toThrowError(
      'Invalid production world map:\n- invalid world bounds',
    );
  });

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
    expect(PRODUCTION_WORLD_MAP.visualBoxes).toHaveLength(27);
    expect(PRODUCTION_WORLD_MAP.visualBoxes.filter(({ solid }) => solid)).toHaveLength(12);
    expect(PRODUCTION_WORLD_MAP.visualBoxes.every(({ id }) => id.length > 0)).toBe(true);
  });

  it('車庫屋根は中央の車体確認用開口を残す3辺フレームである', () => {
    const roofFrames = PRODUCTION_WORLD_MAP.visualBoxes.filter(({ id }) => (
      id.startsWith('garage-roof-')
    ));
    expect(roofFrames.map(({ id }) => id)).toEqual([
      'garage-roof-left',
      'garage-roof-right',
      'garage-roof-back',
    ]);
    expect(roofFrames.every(({ solid }) => !solid)).toBe(true);
    expect(roofFrames.some(({ position, scale }) => (
      Math.abs(position[0]) <= scale[0] / 2
      && Math.abs(7.2 - position[2]) <= scale[2] / 2
    ))).toBe(false);
  });

  it('ゲームプレイ座標を型付きlandmarksとして一意に公開する', () => {
    const map = PRODUCTION_WORLD_MAP as typeof PRODUCTION_WORLD_MAP & {
      readonly landmarks?: typeof EXPECTED_LANDMARKS;
    };

    expect(map.landmarks).toEqual(EXPECTED_LANDMARKS);
  });

  it('西地区へ3個の非重複がれきと7個の道しるべを公開する', () => {
    const { bulldozerDebris, bulldozerRouteMarkers } = PRODUCTION_WORLD_MAP.landmarks;

    expect(bulldozerDebris.map(({ id }) => id)).toEqual([
      'debris-timber',
      'debris-stone',
      'debris-crate',
    ]);
    expect(bulldozerDebris.every(({ position }) => resolveWorldDistrict(position) === 'blocks'))
      .toBe(true);
    expect(bulldozerRouteMarkers).toHaveLength(7);
  });

  it('南地区へ赤青黄のpoolとshowerを非重複sourceとして公開する', () => {
    const sources = PRODUCTION_WORLD_MAP.landmarks.colorPlaySources;
    const southBounds = PRODUCTION_WORLD_MAP.districts.find(({ id }) => id === 'south')?.bounds;

    expect(southBounds).toBeDefined();
    expect(sources).toHaveLength(6);
    expect(sources.map(({ id }) => id)).toEqual([
      'pool-red',
      'pool-blue',
      'pool-yellow',
      'shower-red',
      'shower-blue',
      'shower-yellow',
    ]);
    expect(new Set(sources.map(({ colorId }) => colorId))).toEqual(
      new Set(['red', 'blue', 'yellow']),
    );
    expect(sources.filter(({ kind }) => kind === 'pool')).toHaveLength(3);
    expect(sources.filter(({ kind }) => kind === 'shower')).toHaveLength(3);
    expect(sources.every(({ position, triggerBounds }) => (
      resolveWorldDistrict(position) === 'south'
      && triggerBounds.minX >= (southBounds?.minX ?? Number.POSITIVE_INFINITY)
      && triggerBounds.maxX <= (southBounds?.maxX ?? Number.NEGATIVE_INFINITY)
      && triggerBounds.minZ >= (southBounds?.minZ ?? Number.POSITIVE_INFINITY)
      && triggerBounds.maxZ <= (southBounds?.maxZ ?? Number.NEGATIVE_INFINITY)
    ))).toBe(true);

    for (let leftIndex = 0; leftIndex < sources.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < sources.length; rightIndex += 1) {
        const left = sources[leftIndex].triggerBounds;
        const right = sources[rightIndex].triggerBounds;
        const overlaps = Math.max(left.minX, right.minX) < Math.min(left.maxX, right.maxX)
          && Math.max(left.minZ, right.minZ) < Math.min(left.maxZ, right.maxZ);
        expect(overlaps, `${sources[leftIndex].id}/${sources[rightIndex].id}`).toBe(false);
      }
    }
  });

  it('color sourceの非有限bounds、南地区外、正面積重複を拒否する', () => {
    const [first, second, ...remaining] = EXPECTED_LANDMARKS.colorPlaySources;
    const invalidBounds = {
      ...MAP_WITH_LANDMARK_FIXTURE,
      landmarks: {
        ...MAP_WITH_LANDMARK_FIXTURE.landmarks,
        colorPlaySources: [
          { ...first, triggerBounds: { ...first.triggerBounds, minX: Number.NaN } },
          second,
          ...remaining,
        ],
      },
    };
    const outsideSouth = {
      ...MAP_WITH_LANDMARK_FIXTURE,
      landmarks: {
        ...MAP_WITH_LANDMARK_FIXTURE.landmarks,
        colorPlaySources: [
          { ...first, position: [20, 0.24, 18.5] as const },
          second,
          ...remaining,
        ],
      },
    };
    const overlapping = {
      ...MAP_WITH_LANDMARK_FIXTURE,
      landmarks: {
        ...MAP_WITH_LANDMARK_FIXTURE.landmarks,
        colorPlaySources: [first, { ...second, triggerBounds: first.triggerBounds }, ...remaining],
      },
    };

    expect(validateProductionWorldMap(invalidBounds)).toContain(
      'non-finite color source bounds: pool-red',
    );
    expect(validateProductionWorldMap(outsideSouth)).toContain(
      'color source outside south district: pool-red',
    );
    expect(validateProductionWorldMap(overlapping)).toContain(
      'overlapping color sources: pool-red, pool-blue',
    );
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

  it('正の面積で重なるdistrictを定義順のIDペアで拒否する', () => {
    const overlapping = {
      ...MAP_WITH_LANDMARK_FIXTURE,
      districts: MAP_WITH_LANDMARK_FIXTURE.districts.map((district) => (
        district.id === 'hub'
          ? { ...district, bounds: { ...district.bounds, maxX: 20 } }
          : district
      )),
    };

    expect(validateProductionWorldMap(overlapping)).toContain(
      'overlapping districts: hub, fire',
    );
  });

  it('districtの境界が接するだけなら重複として拒否しない', () => {
    const touching = {
      ...MAP_WITH_LANDMARK_FIXTURE,
      districts: MAP_WITH_LANDMARK_FIXTURE.districts.map((district) => (
        district.id === 'fire'
          ? { ...district, bounds: { ...district.bounds, minX: 10 } }
          : district
      )),
    };

    expect(validateProductionWorldMap(touching)).not.toContain(
      'overlapping districts: hub, fire',
    );
  });

  it.each([
    [
      '非有限bounds',
      { maxX: Number.NaN, maxZ: 10, minX: -10, minZ: -10 },
      'non-finite district bounds: hub',
    ],
    [
      '逆転bounds',
      { maxX: 10, maxZ: 10, minX: 11, minZ: -10 },
      'invalid district bounds: hub',
    ],
  ])('%sのdistrictへ重複の二次エラーを追加しない', (_description, hubBounds, primaryError) => {
    const invalid = {
      ...MAP_WITH_LANDMARK_FIXTURE,
      districts: MAP_WITH_LANDMARK_FIXTURE.districts.map((district) => (
        district.id === 'hub' ? { ...district, bounds: hubBounds } : district
      )),
    };
    const errors = validateProductionWorldMap(invalid);

    expect(errors).toContain(primaryError);
    expect(errors.some((error) => error.startsWith('overlapping districts:'))).toBe(false);
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

  it('がれきIDも全map IDとの重複を拒否する', () => {
    const duplicate = {
      ...MAP_WITH_LANDMARK_FIXTURE,
      landmarks: {
        ...EXPECTED_LANDMARKS,
        bulldozerDebris: EXPECTED_LANDMARKS.bulldozerDebris.map((debris, index) => (
          index === 0 ? { ...debris, id: 'road-hub-east-west' } : debris
        )),
      },
    };

    expect(validateProductionWorldMap(duplicate)).toContain('duplicate id: road-hub-east-west');
  });

  it.each([
    [
      '非正のがれき半径',
      EXPECTED_LANDMARKS.bulldozerDebris.map((debris, index) => (
        index === 0 ? { ...debris, radius: 0 } : debris
      )),
      'invalid bulldozer debris radius: debris-timber',
    ],
    [
      '西地区外のがれき',
      EXPECTED_LANDMARKS.bulldozerDebris.map((debris, index) => (
        index === 0 ? { ...debris, position: [0, 0.8, 6] as const } : debris
      )),
      'landmark bulldozerDebris:debris-timber expected blocks, received hub',
    ],
    [
      'がれき同士の不足間隔',
      EXPECTED_LANDMARKS.bulldozerDebris.map((debris, index) => (
        index === 1 ? { ...debris, position: [-28.5, 0.8, 12.5] as const } : debris
      )),
      'bulldozer debris too close: debris-timber, debris-stone',
    ],
    [
      '通常積み木との不足間隔',
      EXPECTED_LANDMARKS.bulldozerDebris.map((debris, index) => (
        index === 0 ? { ...debris, position: [-26.7, 0.8, 11.5] as const } : debris
      )),
      'bulldozer debris overlaps breakable: debris-timber, plaza-red',
    ],
  ])('%sを拒否する', (_description, bulldozerDebris, expectedError) => {
    const map = {
      ...MAP_WITH_LANDMARK_FIXTURE,
      landmarks: { ...EXPECTED_LANDMARKS, bulldozerDebris },
    };
    expect(validateProductionWorldMap(map)).toContain(expectedError);
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
      '非有限fire route marker',
      {
        ...MAP_WITH_LANDMARK_FIXTURE,
        landmarks: {
          ...EXPECTED_LANDMARKS,
          fireRouteMarkers: EXPECTED_LANDMARKS.fireRouteMarkers.map((position, index) => (
            index === 0 ? [0, Number.NaN, 3] as const : position
          )),
        },
      },
      'non-finite landmark: fireRouteMarker:0',
    ],
    [
      'world外fire route marker',
      {
        ...MAP_WITH_LANDMARK_FIXTURE,
        landmarks: {
          ...EXPECTED_LANDMARKS,
          fireRouteMarkers: EXPECTED_LANDMARKS.fireRouteMarkers.map((position, index) => (
            index === 0 ? [40, 0.26, 3] as const : position
          )),
        },
      },
      'landmark outside world bounds: fireRouteMarker:0',
    ],
    [
      '非有限celebration star center',
      {
        ...MAP_WITH_LANDMARK_FIXTURE,
        landmarks: {
          ...EXPECTED_LANDMARKS,
          celebrationStarCenters: EXPECTED_LANDMARKS.celebrationStarCenters.map(
            (position, index) => (
              index === 0 ? [24.8, 1, Number.POSITIVE_INFINITY] as const : position
            ),
          ),
        },
      },
      'non-finite landmark: celebrationStarCenter:0',
    ],
    [
      'world外celebration star center',
      {
        ...MAP_WITH_LANDMARK_FIXTURE,
        landmarks: {
          ...EXPECTED_LANDMARKS,
          celebrationStarCenters: EXPECTED_LANDMARKS.celebrationStarCenters.map(
            (position, index) => (index === 0 ? [24.8, 1, -40] as const : position),
          ),
        },
      },
      'landmark outside world bounds: celebrationStarCenter:0',
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

/** 72×72の本番箱庭を描画・物理・ゲームプレイで共有する純粋な座標定義。 */

/** 本番箱庭にある目的地地区の識別子。 */
export type WorldDistrictId = 'hub' | 'park' | 'fire' | 'blocks' | 'south';

/** 任意のworld座標を解決した結果の地区識別子。 */
export type ResolvedWorldDistrictId = WorldDistrictId | 'road' | 'outside';

/** Three.jsに依存しない、world空間内の3次元座標または寸法。 */
export type WorldPoint = readonly [number, number, number];

/** X-Z平面における軸揃え矩形の境界。 */
export interface WorldBounds2D {
  readonly maxX: number;
  readonly maxZ: number;
  readonly minX: number;
  readonly minZ: number;
}

/** 本番箱庭の目的地地区を表す定義。 */
export interface WorldDistrictDefinition {
  readonly bounds: WorldBounds2D;
  readonly id: WorldDistrictId;
  readonly label: string;
}

/** 描画とstatic colliderで共有する軸揃えboxの定義。 */
export interface WorldBoxDefinition {
  readonly color: string;
  readonly id: string;
  readonly position: WorldPoint;
  readonly rotation?: WorldPoint;
  readonly scale: WorldPoint;
  readonly solid: boolean;
}

/** 積み木広場へ置く壊せる積み木の座標定義。 */
export interface BreakableBlockLandmarkDefinition {
  readonly color: string;
  readonly id: string;
  readonly position: WorldPoint;
}

/** 工事仕事でブルドーザーだけが片付けられるがれきの色種別。 */
export type BulldozerDebrisPaletteId = 'timber' | 'stone' | 'crate';

/** 工事現場へ置く1つのがれきと寛容な接触半径。 */
export interface BulldozerDebrisLandmarkDefinition {
  readonly id: string;
  readonly palette: BulldozerDebrisPaletteId;
  readonly position: WorldPoint;
  readonly radius: number;
}

/** 積み木広場の土台となるboxの座標定義。 */
export interface BlockPlazaLandmarkDefinition {
  readonly position: WorldPoint;
  readonly scale: WorldPoint;
}

/** gameplayが参照する代表地点と積み木配置の不変定義。 */
export interface WorldLandmarksDefinition {
  readonly blockPlaza: BlockPlazaLandmarkDefinition;
  readonly breakableBlocks: readonly BreakableBlockLandmarkDefinition[];
  readonly bulldozerDebris: readonly BulldozerDebrisLandmarkDefinition[];
  readonly bulldozerRouteMarkers: readonly WorldPoint[];
  readonly celebrationStarCenters: readonly WorldPoint[];
  readonly fire: WorldPoint;
  readonly fireRouteMarkers: readonly WorldPoint[];
  readonly fireSprayTarget: WorldPoint;
  readonly garage: WorldPoint;
  readonly park: WorldPoint;
}

/** 地区をつなぐ、描画可能な道路boxの定義。 */
export interface WorldRoadDefinition {
  readonly connects: readonly WorldDistrictId[];
  readonly id: string;
  readonly position: WorldPoint;
  readonly rotation?: WorldPoint;
  readonly scale: WorldPoint;
}

/** 本番箱庭を構成する地区、道路、共有boxの不変定義。 */
export interface ProductionWorldMapDefinition {
  readonly bounds: WorldBounds2D;
  readonly districts: readonly WorldDistrictDefinition[];
  readonly landmarks: WorldLandmarksDefinition;
  readonly roads: readonly WorldRoadDefinition[];
  readonly visualBoxes: readonly WorldBoxDefinition[];
}

/** 描画・物理・ゲームプレイ間で共有する72×72本番箱庭の唯一の座標定義。 */
const PRODUCTION_WORLD_MAP_DEFINITION = {
  bounds: { maxX: 36, maxZ: 36, minX: -36, minZ: -36 },
  districts: [
    { bounds: { maxX: 10, maxZ: 10, minX: -10, minZ: -10 }, id: 'hub', label: 'ちゅうおうしゃこ' },
    { bounds: { maxX: 12, maxZ: -14, minX: -12, minZ: -34 }, id: 'park', label: 'こうえん' },
    { bounds: { maxX: 34, maxZ: 6, minX: 14, minZ: -20 }, id: 'fire', label: 'かさいげんば' },
    { bounds: { maxX: -14, maxZ: 16, minX: -34, minZ: -10 }, id: 'blocks', label: 'つみきひろば' },
    { bounds: { maxX: 12, maxZ: 34, minX: -12, minZ: 14 }, id: 'south', label: 'じゆうそうこう' },
  ],
  landmarks: {
    blockPlaza: {
      position: [-24, 0.18, 6],
      scale: [14, 0.34, 16],
    },
    breakableBlocks: [
      { color: '#ef4444', id: 'plaza-red', position: [-26.7, 0.75, 9.5] },
      { color: '#facc15', id: 'plaza-yellow', position: [-21.5, 0.75, 0] },
      { color: '#3b82f6', id: 'plaza-blue', position: [-21.3, 0.75, 4.6] },
      { color: '#65a30d', id: 'plaza-green', position: [-26.7, 0.75, 2.5] },
    ],
    bulldozerDebris: [
      { id: 'debris-timber', palette: 'timber', position: [-29.5, 0.8, 12.5], radius: 1.15 },
      { id: 'debris-stone', palette: 'stone', position: [-24, 0.8, 13], radius: 1.15 },
      { id: 'debris-crate', palette: 'crate', position: [-18.2, 0.8, 12], radius: 1.15 },
    ],
    bulldozerRouteMarkers: [
      [-3, 0.26, 0],
      [-7, 0.26, 0],
      [-11, 0.26, 0],
      [-15, 0.26, 0],
      [-19, 0.26, 2],
      [-22, 0.26, 6],
      [-24, 0.26, 9],
    ],
    celebrationStarCenters: [
      [24.8, 1, -11],
      [22.5, 1.2, -11.4],
      [31, 1, -11.8],
      [24, 1.8, -12.2],
      [31.25, 3, -15],
      [28.8, 1.7, -13],
    ],
    fire: [26, 1.2, -18],
    fireRouteMarkers: [
      [0, 0.26, 3],
      [0, 0.26, 0],
      [4, 0.26, 0],
      [8, 0.26, 0],
      [12, 0.26, 0],
      [16, 0.26, 0],
      [20, 0.26, 0],
      [24, 0.26, 0],
      [28, 0.26, 0],
      [30, 0.26, -4],
      [30, 0.26, -8],
      [28, 0.26, -13],
    ],
    fireSprayTarget: [26.9, 1.45, -16.1],
    garage: [0, 0.8, 6],
    park: [0, 0, -24],
  },
  roads: [
    { connects: ['blocks', 'hub', 'fire'], id: 'road-hub-east-west', position: [0, 0.08, 0], scale: [68, 0.18, 5] },
    { connects: ['park', 'hub', 'south'], id: 'road-hub-north-south', position: [0, 0.08, 0], scale: [5, 0.18, 68] },
    { connects: ['park'], id: 'road-park-north', position: [0, 0.08, -32], scale: [24, 0.18, 4] },
    { connects: ['park'], id: 'road-park-west', position: [-10, 0.08, -24], scale: [4, 0.18, 16] },
    { connects: ['park'], id: 'road-park-east', position: [10, 0.08, -24], scale: [4, 0.18, 16] },
    { connects: ['fire'], id: 'road-fire-east', position: [32, 0.08, -7], scale: [4, 0.18, 26] },
    { connects: ['fire'], id: 'road-fire-north', position: [24, 0.08, -20], scale: [16, 0.18, 4] },
    { connects: ['blocks'], id: 'road-blocks-west', position: [-32, 0.08, 3], scale: [4, 0.18, 26] },
    { connects: ['blocks'], id: 'road-blocks-south', position: [-24, 0.08, 16], scale: [16, 0.18, 4] },
    { connects: ['south'], id: 'road-south-bottom', position: [0, 0.08, 32], scale: [24, 0.18, 4] },
    { connects: ['south'], id: 'road-south-west', position: [-10, 0.08, 24], scale: [4, 0.18, 16] },
    { connects: ['south'], id: 'road-south-east', position: [10, 0.08, 24], scale: [4, 0.18, 16] },
  ],
  visualBoxes: [
    { color: '#78a94f', id: 'park-ground', position: [0, 0.18, -24], scale: [20, 0.34, 16], solid: false },
    { color: '#67c7df', id: 'park-pond', position: [2, 0.4, -24], scale: [6, 0.18, 4], solid: false },
    { color: '#86552f', id: 'tree-trunk-1', position: [-7, 1.25, -28], scale: [0.7, 2.2, 0.7], solid: true },
    { color: '#86552f', id: 'tree-trunk-2', position: [-7, 1.25, -20], scale: [0.7, 2.2, 0.7], solid: true },
    { color: '#86552f', id: 'tree-trunk-3', position: [7, 1.25, -20], scale: [0.7, 2.2, 0.7], solid: true },
    { color: '#3f7f3a', id: 'tree-crown-1', position: [-7, 2.85, -28], scale: [2.2, 1.4, 2.2], solid: false },
    { color: '#3f7f3a', id: 'tree-crown-2', position: [-7, 2.85, -20], scale: [2.2, 1.4, 2.2], solid: false },
    { color: '#3f7f3a', id: 'tree-crown-3', position: [7, 2.85, -20], scale: [2.2, 1.4, 2.2], solid: false },
    { color: '#e24b3f', id: 'playground-plank', position: [3, 0.75, -26], scale: [3.4, 0.28, 0.7], solid: true },
    { color: '#f2c94c', id: 'playground-support', position: [3, 0.45, -26], scale: [0.36, 0.8, 0.36], solid: true },
    { color: '#f1efe6', id: 'garage-back-wall', position: [0, 1.8, 9.2], scale: [8.8, 3.4, 0.8], solid: true },
    { color: '#f1efe6', id: 'garage-left-wall', position: [-4, 1.8, 7.2], scale: [0.8, 3.4, 4.8], solid: true },
    { color: '#f1efe6', id: 'garage-right-wall', position: [4, 1.8, 7.2], scale: [0.8, 3.4, 4.8], solid: true },
    { color: '#c83e34', id: 'garage-roof', position: [0, 3.65, 7.2], scale: [8.8, 0.5, 5.2], solid: false },
    { color: '#c83e34', id: 'garage-header', position: [0, 3.35, 4.7], scale: [8.8, 0.45, 0.35], solid: false },
    { color: '#a86f3f', id: 'fire-building-body', position: [23.5, 1.8, -16.5], scale: [6, 3.4, 5], solid: true },
    { color: '#6f4327', id: 'fire-building-roof', position: [23.5, 3.75, -16.5], scale: [6.8, 0.5, 5.8], solid: false },
    { color: '#7ed1e6', id: 'fire-window-1', position: [22.2, 1.9, -19.05], scale: [1.5, 1.5, 0.18], solid: false },
    { color: '#7ed1e6', id: 'fire-window-2', position: [24.8, 1.9, -19.05], scale: [1.5, 1.5, 0.18], solid: false },
    { color: '#e1c78c', id: 'block-plaza-ground', position: [-24, 0.18, 6], scale: [14, 0.34, 16], solid: false },
    { color: '#c83e34', id: 'hub-gate-post', position: [-6, 1.1, 0], scale: [0.7, 2, 0.7], solid: true },
    { color: '#86552f', id: 'south-sign-post-west', position: [-7, 1.1, 24], scale: [0.7, 2, 0.7], solid: true },
    { color: '#86552f', id: 'south-sign-post-east', position: [7, 1.1, 28], scale: [0.7, 2, 0.7], solid: true },
    { color: '#f2c94c', id: 'south-sign-board-west', position: [-7, 2.15, 24], scale: [3, 1, 0.4], solid: false },
    { color: '#e24b3f', id: 'south-sign-board-east', position: [7, 2.15, 28], scale: [3, 1, 0.4], solid: false },
  ],
} as const satisfies ProductionWorldMapDefinition;

/** 指定map内のworld座標を地区、道路、またはworld外として解決する。 */
function resolveWorldDistrictInMap(
  map: Pick<ProductionWorldMapDefinition, 'bounds' | 'districts'>,
  position: WorldPoint,
): ResolvedWorldDistrictId {
  const [x, , z] = position;
  const { bounds, districts } = map;
  if (!position.every(Number.isFinite)
    || x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) {
    return 'outside';
  }

  const district = districts.find(({ bounds: districtBounds }) => (
    x >= districtBounds.minX && x <= districtBounds.maxX
    && z >= districtBounds.minZ && z <= districtBounds.maxZ
  ));
  if (district) return district.id;

  return 'road';
}

/** 本番map内のworld座標を地区、道路、またはworld外として解決する。 */
export function resolveWorldDistrict(position: WorldPoint): ResolvedWorldDistrictId {
  return resolveWorldDistrictInMap(PRODUCTION_WORLD_MAP, position);
}

/** X-Z境界の4成分がすべて有限かを判定する。 */
function isFiniteBounds(bounds: WorldBounds2D): boolean {
  return [bounds.maxX, bounds.maxZ, bounds.minX, bounds.minZ].every(Number.isFinite);
}

/** X-Z境界の最小値が最大値を下回る有効な範囲かを判定する。 */
function isOrderedBounds(bounds: WorldBounds2D): boolean {
  return bounds.minX < bounds.maxX && bounds.minZ < bounds.maxZ;
}

/** 2つの有効なX-Z境界が、正の面積を持って重なるかを判定する。 */
function doBoundsOverlapWithPositiveArea(
  first: WorldBounds2D,
  second: WorldBounds2D,
): boolean {
  return Math.max(first.minX, second.minX) < Math.min(first.maxX, second.maxX)
    && Math.max(first.minZ, second.minZ) < Math.min(first.maxZ, second.maxZ);
}

/** 内側のX-Z境界が外側のX-Z境界を越えないかを判定する。 */
function isBoundsInsideBounds(inner: WorldBounds2D, outer: WorldBounds2D): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX
    && inner.minZ >= outer.minZ && inner.maxZ <= outer.maxZ;
}

/** 3次元座標のX-Z成分が指定境界内にあるかを判定する。 */
function isPointInsideBounds(position: WorldPoint, bounds: WorldBounds2D): boolean {
  return position[0] >= bounds.minX && position[0] <= bounds.maxX
    && position[2] >= bounds.minZ && position[2] <= bounds.maxZ;
}

/** 軸揃えboxのX-Z外形が指定境界内に収まるかを判定する。 */
function isBoxInsideBounds(
  position: WorldPoint,
  scale: WorldPoint,
  bounds: WorldBounds2D,
): boolean {
  return position[0] - scale[0] / 2 >= bounds.minX
    && position[0] + scale[0] / 2 <= bounds.maxX
    && position[2] - scale[2] / 2 >= bounds.minZ
    && position[2] + scale[2] / 2 <= bounds.maxZ;
}

/** map内のID、数値、world境界、代表地点の地区契約を定義順で検証する。 */
export function validateProductionWorldMap(
  map: ProductionWorldMapDefinition,
): readonly string[] {
  const errors: string[] = [];
  const worldBoundsAreFinite = isFiniteBounds(map.bounds);
  const worldBoundsAreOrdered = worldBoundsAreFinite && isOrderedBounds(map.bounds);
  if (!worldBoundsAreFinite) errors.push('non-finite world bounds');
  else if (!worldBoundsAreOrdered) errors.push('invalid world bounds');

  for (const district of map.districts) {
    if (!isFiniteBounds(district.bounds)) {
      errors.push(`non-finite district bounds: ${district.id}`);
      continue;
    }
    if (!isOrderedBounds(district.bounds)) {
      errors.push(`invalid district bounds: ${district.id}`);
      continue;
    }
    if (worldBoundsAreOrdered && !isBoundsInsideBounds(district.bounds, map.bounds)) {
      errors.push(`district outside world bounds: ${district.id}`);
    }
  }

  for (const [firstIndex, first] of map.districts.entries()) {
    if (!isFiniteBounds(first.bounds) || !isOrderedBounds(first.bounds)) continue;
    for (const second of map.districts.slice(firstIndex + 1)) {
      if (!isFiniteBounds(second.bounds) || !isOrderedBounds(second.bounds)) continue;
      if (doBoundsOverlapWithPositiveArea(first.bounds, second.bounds)) {
        errors.push(`overlapping districts: ${first.id}, ${second.id}`);
      }
    }
  }

  const ids = [
    ...map.districts.map(({ id }) => id),
    ...map.roads.map(({ id }) => id),
    ...map.visualBoxes.map(({ id }) => id),
    ...map.landmarks.breakableBlocks.map(({ id }) => id),
    ...map.landmarks.bulldozerDebris.map(({ id }) => id),
  ];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`duplicate id: ${id}`);
    seen.add(id);
  }
  for (const box of [...map.roads, ...map.visualBoxes]) {
    if (!box.position.every(Number.isFinite)) errors.push(`non-finite position: ${box.id}`);
    if (!box.scale.every((value) => Number.isFinite(value) && value > 0)) {
      errors.push(`invalid scale: ${box.id}`);
    }
    if (box.rotation && !box.rotation.every(Number.isFinite)) {
      errors.push(`non-finite rotation: ${box.id}`);
    }
    if (worldBoundsAreOrdered && !isBoxInsideBounds(box.position, box.scale, map.bounds)) {
      errors.push(`outside world bounds: ${box.id}`);
    }
  }

  const landmarkPoints: readonly {
    readonly name: string;
    readonly position: WorldPoint;
  }[] = [
    { name: 'garage', position: map.landmarks.garage },
    { name: 'park', position: map.landmarks.park },
    { name: 'fire', position: map.landmarks.fire },
    { name: 'fireSprayTarget', position: map.landmarks.fireSprayTarget },
    { name: 'blockPlaza', position: map.landmarks.blockPlaza.position },
    ...map.landmarks.fireRouteMarkers.map((position, index) => ({
      name: `fireRouteMarker:${index}`,
      position,
    })),
    ...map.landmarks.celebrationStarCenters.map((position, index) => ({
      name: `celebrationStarCenter:${index}`,
      position,
    })),
    ...map.landmarks.breakableBlocks.map(({ id, position }) => ({
      name: `breakableBlock:${id}`,
      position,
    })),
    ...map.landmarks.bulldozerRouteMarkers.map((position, index) => ({
      name: `bulldozerRouteMarker:${index}`,
      position,
    })),
    ...map.landmarks.bulldozerDebris.map(({ id, position }) => ({
      name: `bulldozerDebris:${id}`,
      position,
    })),
  ];
  for (const landmark of landmarkPoints) {
    if (!landmark.position.every(Number.isFinite)) {
      errors.push(`non-finite landmark: ${landmark.name}`);
    } else if (worldBoundsAreOrdered && !isPointInsideBounds(landmark.position, map.bounds)) {
      errors.push(`landmark outside world bounds: ${landmark.name}`);
    }
  }

  const { blockPlaza } = map.landmarks;
  const blockPlazaScaleIsValid = blockPlaza.scale.every(
    (value) => Number.isFinite(value) && value > 0,
  );
  if (!blockPlazaScaleIsValid) {
    errors.push('invalid landmark scale: blockPlaza');
  } else if (
    blockPlaza.position.every(Number.isFinite)
    && worldBoundsAreOrdered
    && !isBoxInsideBounds(blockPlaza.position, blockPlaza.scale, map.bounds)
  ) {
    errors.push('landmark outside world bounds: blockPlaza');
  }

  const breakableBlockHalfExtent = 0.75;
  const plazaBounds = {
    maxX: blockPlaza.position[0] + blockPlaza.scale[0] / 2,
    maxZ: blockPlaza.position[2] + blockPlaza.scale[2] / 2,
    minX: blockPlaza.position[0] - blockPlaza.scale[0] / 2,
    minZ: blockPlaza.position[2] - blockPlaza.scale[2] / 2,
  };
  for (const block of map.landmarks.breakableBlocks) {
    if (
      block.position[0] - breakableBlockHalfExtent < plazaBounds.minX
      || block.position[0] + breakableBlockHalfExtent > plazaBounds.maxX
      || block.position[2] - breakableBlockHalfExtent < plazaBounds.minZ
      || block.position[2] + breakableBlockHalfExtent > plazaBounds.maxZ
    ) {
      errors.push(`breakable outside block plaza: ${block.id}`);
    }
  }

  const minimumDebrisClearance = 2.5;
  const minimumBreakableClearance = 3;
  for (const [index, debris] of map.landmarks.bulldozerDebris.entries()) {
    if (!Number.isFinite(debris.radius) || debris.radius <= 0) {
      errors.push(`invalid bulldozer debris radius: ${debris.id}`);
    }
    const receivedDistrict = resolveWorldDistrictInMap(map, debris.position);
    if (receivedDistrict !== 'blocks') {
      errors.push(
        `landmark bulldozerDebris:${debris.id} expected blocks, received ${receivedDistrict}`,
      );
    }

    for (const other of map.landmarks.bulldozerDebris.slice(index + 1)) {
      const distance = Math.hypot(
        other.position[0] - debris.position[0],
        other.position[2] - debris.position[2],
      );
      if (distance < minimumDebrisClearance) {
        errors.push(`bulldozer debris too close: ${debris.id}, ${other.id}`);
      }
    }

    for (const block of map.landmarks.breakableBlocks) {
      const distance = Math.hypot(
        block.position[0] - debris.position[0],
        block.position[2] - debris.position[2],
      );
      if (distance < minimumBreakableClearance) {
        errors.push(`bulldozer debris overlaps breakable: ${debris.id}, ${block.id}`);
      }
    }
  }

  const expectedDistricts: readonly {
    readonly expected: WorldDistrictId;
    readonly name: string;
    readonly position: WorldPoint;
  }[] = [
    { expected: 'hub', name: 'garage', position: map.landmarks.garage },
    { expected: 'park', name: 'park', position: map.landmarks.park },
    { expected: 'fire', name: 'fire', position: map.landmarks.fire },
    { expected: 'fire', name: 'fireSprayTarget', position: map.landmarks.fireSprayTarget },
    { expected: 'blocks', name: 'blockPlaza', position: map.landmarks.blockPlaza.position },
  ];
  for (const landmark of expectedDistricts) {
    const received = resolveWorldDistrictInMap(map, landmark.position);
    if (received !== landmark.expected) {
      errors.push(`landmark ${landmark.name} expected ${landmark.expected}, received ${received}`);
    }
  }

  return errors;
}

/** 不正なmapを明確なErrorで拒否し、有効なら元のtyped参照を返す起動guard。 */
export function requireValidProductionWorldMap<
  const MapDefinition extends ProductionWorldMapDefinition,
>(map: MapDefinition): MapDefinition {
  const errors = validateProductionWorldMap(map);
  if (errors.length > 0) {
    throw new Error(`Invalid production world map:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  }
  return map;
}

/** module初期化時の検証を通過した、本番箱庭の唯一のcanonical map。 */
export const PRODUCTION_WORLD_MAP = requireValidProductionWorldMap(
  PRODUCTION_WORLD_MAP_DEFINITION,
);

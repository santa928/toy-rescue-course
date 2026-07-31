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

/** 地区をつなぐ、描画可能な道路boxの定義。 */
export interface WorldRoadDefinition {
  readonly connects: readonly WorldDistrictId[];
  readonly id: string;
  readonly position: WorldPoint;
  readonly scale: WorldPoint;
}

/** 本番箱庭を構成する地区、道路、共有boxの不変定義。 */
export interface ProductionWorldMapDefinition {
  readonly bounds: WorldBounds2D;
  readonly districts: readonly WorldDistrictDefinition[];
  readonly roads: readonly WorldRoadDefinition[];
  readonly visualBoxes: readonly WorldBoxDefinition[];
}

/** 描画・物理・ゲームプレイ間で共有する72×72本番箱庭の唯一の座標定義。 */
export const PRODUCTION_WORLD_MAP = {
  bounds: { maxX: 36, maxZ: 36, minX: -36, minZ: -36 },
  districts: [
    { bounds: { maxX: 10, maxZ: 10, minX: -10, minZ: -10 }, id: 'hub', label: 'ちゅうおうしゃこ' },
    { bounds: { maxX: 12, maxZ: -14, minX: -12, minZ: -34 }, id: 'park', label: 'こうえん' },
    { bounds: { maxX: 34, maxZ: 6, minX: 14, minZ: -20 }, id: 'fire', label: 'かさいげんば' },
    { bounds: { maxX: -14, maxZ: 16, minX: -34, minZ: -10 }, id: 'blocks', label: 'つみきひろば' },
    { bounds: { maxX: 12, maxZ: 34, minX: -12, minZ: 14 }, id: 'south', label: 'じゆうそうこう' },
  ],
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

/** world座標を地区、道路、またはworld外として解決する。 */
export function resolveWorldDistrict(position: WorldPoint): ResolvedWorldDistrictId {
  const [x, , z] = position;
  const { bounds, districts } = PRODUCTION_WORLD_MAP;
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

/** map内のID重複、数値、world境界違反を定義順で検証する。 */
export function validateProductionWorldMap(
  map: ProductionWorldMapDefinition,
): readonly string[] {
  const errors: string[] = [];
  const ids = [
    ...map.districts.map(({ id }) => id),
    ...map.roads.map(({ id }) => id),
    ...map.visualBoxes.map(({ id }) => id),
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
    if (
      box.position[0] - box.scale[0] / 2 < map.bounds.minX
      || box.position[0] + box.scale[0] / 2 > map.bounds.maxX
      || box.position[2] - box.scale[2] / 2 < map.bounds.minZ
      || box.position[2] + box.scale[2] / 2 > map.bounds.maxZ
    ) {
      errors.push(`outside world bounds: ${box.id}`);
    }
  }
  return errors;
}

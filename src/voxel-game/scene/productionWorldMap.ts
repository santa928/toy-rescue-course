import { validateWorldStreetscape } from './worldStreetscape';

/** 96×96の本番箱庭を描画・物理・ゲームプレイで共有する純粋な座標定義。 */

/** 本番箱庭にある目的地地区の識別子。 */
export type WorldDistrictId =
  | 'hub'
  | 'park'
  | 'fire'
  | 'blocks'
  | 'south'
  | 'construction'
  | 'town';

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

/** 色遊びで車体へ適用できる3つの玩具色。 */
export type VehicleColorId = 'red' | 'blue' | 'yellow';

/** 色遊びsourceの通過方法。 */
export type ColorPlaySourceKind = 'pool' | 'shower';

/** 南地区に置く色遊びsourceと寛容なXZ trigger境界。 */
export interface ColorPlaySourceDefinition {
  readonly color: string;
  readonly colorId: VehicleColorId;
  readonly id: string;
  readonly kind: ColorPlaySourceKind;
  readonly position: WorldPoint;
  readonly triggerBounds: WorldBounds2D;
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

/** 道路下へ置く、地区識別専用の非solid床タイル。 */
export interface WorldSurfaceTileDefinition {
  readonly color: string;
  readonly districtId: WorldDistrictId;
  readonly id: string;
  readonly position: WorldPoint;
  readonly scale: WorldPoint;
}

/** 1つの街角テーマとして同時に配置する装飾box群。 */
export interface WorldDecorationClusterDefinition {
  readonly boxes: readonly WorldBoxDefinition[];
  readonly districtId: WorldDistrictId;
  readonly id: string;
  readonly purpose: 'entry' | 'landmark' | 'rest' | 'service';
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
  readonly colorPlaySources: readonly ColorPlaySourceDefinition[];
  readonly construction: WorldPoint;
  readonly fire: WorldPoint;
  readonly fireRouteMarkers: readonly WorldPoint[];
  readonly fireSprayTarget: WorldPoint;
  readonly garage: WorldPoint;
  readonly park: WorldPoint;
  readonly town: WorldPoint;
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
  readonly decorationClusters: readonly WorldDecorationClusterDefinition[];
  readonly districts: readonly WorldDistrictDefinition[];
  readonly landmarks: WorldLandmarksDefinition;
  readonly roads: readonly WorldRoadDefinition[];
  readonly surfaceTiles: readonly WorldSurfaceTileDefinition[];
  readonly visualBoxes: readonly WorldBoxDefinition[];
}

/** 描画・物理・ゲームプレイ間で共有する96×96本番箱庭の唯一の座標定義。 */
const PRODUCTION_WORLD_MAP_DEFINITION = {
  bounds: { maxX: 48, maxZ: 48, minX: -48, minZ: -48 },
  decorationClusters: [
    {
      boxes: [
        { color: '#86552f', id: 'hub-tool-rack-post', position: [8.2, 1, 7.2], scale: [0.6, 1.8, 0.6], solid: true },
        { color: '#f2c94c', id: 'hub-tool-rack-shelf', position: [8.2, 1.55, 7.2], scale: [2.2, 0.25, 0.65], solid: false },
        { color: '#a86f3f', id: 'hub-parcel-a', position: [6.1, 0.45, 8.7], scale: [1.2, 0.9, 1.2], solid: false },
        { color: '#a86f3f', id: 'hub-parcel-b', position: [8.1, 0.35, 8.6], scale: [1, 0.7, 1], solid: false },
      ],
      districtId: 'hub',
      id: 'hub-tools-and-parcels',
      purpose: 'service',
    },
    {
      boxes: [
        { color: '#e24b3f', id: 'hub-entry-guide-red', position: [-6.4, 0.3, -5.6], scale: [2.2, 0.5, 0.5], solid: false },
        { color: '#f1efe6', id: 'hub-entry-guide-white', position: [-6.4, 0.3, -6.35], scale: [2.2, 0.5, 0.5], solid: false },
      ],
      districtId: 'hub',
      id: 'hub-entry-guides',
      purpose: 'entry',
    },
    {
      boxes: [
        { color: '#86552f', id: 'park-bench-seat', position: [5.2, 0.55, -22], scale: [1.6, 0.7, 2.4], solid: true },
        { color: '#e24b3f', id: 'park-entry-flower-red', position: [5.2, 0.32, -24.2], scale: [0.6, 0.55, 0.6], solid: false },
        { color: '#f2c94c', id: 'park-entry-flower-yellow', position: [5.2, 0.32, -25], scale: [0.6, 0.55, 0.6], solid: false },
      ],
      districtId: 'park',
      id: 'park-entry-flowerbed',
      purpose: 'entry',
    },
    {
      boxes: [
        { color: '#86552f', id: 'park-lamp-post', position: [-5.2, 1.25, -28], scale: [0.5, 2.3, 0.5], solid: true },
        { color: '#f2c94c', id: 'park-lamp-light', position: [-5.2, 2.55, -28], scale: [0.9, 0.45, 0.9], solid: false },
        { color: '#3f7f3a', id: 'park-hedge', position: [-5.2, 0.45, -29.2], scale: [1.4, 0.8, 0.55], solid: false },
      ],
      districtId: 'park',
      id: 'park-lamp-and-hedge',
      purpose: 'landmark',
    },
    {
      boxes: [
        { color: '#86552f', id: 'park-picnic-table', position: [-5.2, 0.6, -17], scale: [1.6, 0.8, 2], solid: true },
        { color: '#e24b3f', id: 'park-picnic-cloth', position: [-5.2, 1.05, -17], scale: [1.7, 0.12, 2.1], solid: false },
      ],
      districtId: 'park',
      id: 'park-picnic-corner',
      purpose: 'rest',
    },
    {
      boxes: [
        { color: '#e24b3f', id: 'fire-hydrant-body', position: [16, 0.65, -12], scale: [0.8, 1.2, 0.8], solid: true },
        { color: '#f2c94c', id: 'fire-hydrant-cap', position: [16, 1.35, -12], scale: [1.05, 0.25, 1.05], solid: false },
        { color: '#f1efe6', id: 'fire-entry-curb', position: [15, 0.25, -8.5], scale: [0.5, 0.4, 3], solid: false },
      ],
      districtId: 'fire',
      id: 'fire-entry-hydrant',
      purpose: 'entry',
    },
    {
      boxes: [
        { color: '#86552f', id: 'fire-lamp-post', position: [18, 1.25, -7], scale: [0.5, 2.3, 0.5], solid: true },
        { color: '#f2c94c', id: 'fire-lamp-light', position: [18, 2.55, -7], scale: [0.9, 0.45, 0.9], solid: false },
      ],
      districtId: 'fire',
      id: 'fire-sidewalk-lamp',
      purpose: 'landmark',
    },
    {
      boxes: [
        { color: '#c83e34', id: 'fire-mailbox', position: [27, 0.85, -8], scale: [0.8, 1.4, 0.8], solid: false },
        { color: '#3f7f3a', id: 'fire-planter-green', position: [25.5, 0.4, -8], scale: [1, 0.7, 1], solid: false },
        { color: '#f2c94c', id: 'fire-planter-flower', position: [25.5, 0.85, -8], scale: [0.6, 0.35, 0.6], solid: false },
      ],
      districtId: 'fire',
      id: 'fire-mailbox-planters',
      purpose: 'service',
    },
    {
      boxes: [
        { color: '#86552f', id: 'blocks-fence-post', position: [-16, 1, -9], scale: [0.6, 1.8, 0.6], solid: true },
        { color: '#e24b3f', id: 'blocks-entry-cone-red', position: [-18, 0.4, -9], scale: [0.7, 0.75, 0.7], solid: false },
        { color: '#f2c94c', id: 'blocks-entry-cone-yellow', position: [-19.2, 0.4, -9], scale: [0.7, 0.75, 0.7], solid: false },
        { color: '#f1efe6', id: 'blocks-fence-board', position: [-16, 1.25, -8.7], scale: [0.4, 0.35, 2.6], solid: false },
      ],
      districtId: 'blocks',
      id: 'blocks-entry-fence',
      purpose: 'entry',
    },
    {
      boxes: [
        { color: '#86552f', id: 'blocks-pallet-base', position: [-20, 0.3, 8], scale: [3, 0.4, 2], solid: false },
        { color: '#a86f3f', id: 'blocks-pallet-crate', position: [-20, 0.85, 8], scale: [1.4, 0.8, 1.4], solid: false },
      ],
      districtId: 'blocks',
      id: 'blocks-pallet-corner',
      purpose: 'service',
    },
    {
      boxes: [
        { color: '#3b82f6', id: 'blocks-toolbox', position: [-16.5, 0.45, 10.5], scale: [1.8, 0.8, 1.1], solid: false },
        { color: '#f2c94c', id: 'blocks-guide-board', position: [-16.5, 1.4, 11.2], scale: [2.4, 1.1, 0.35], solid: false },
      ],
      districtId: 'blocks',
      id: 'blocks-tools-and-guide',
      purpose: 'landmark',
    },
    {
      boxes: [
        { color: '#e24b3f', id: 'south-entry-flag-red', position: [-1.5, 1.2, 15], scale: [1.4, 1.1, 0.2], solid: false },
        { color: '#f2c94c', id: 'south-entry-flag-yellow', position: [0, 1.2, 15], scale: [1.4, 1.1, 0.2], solid: false },
        { color: '#3b82f6', id: 'south-entry-flag-blue', position: [1.5, 1.2, 15], scale: [1.4, 1.1, 0.2], solid: false },
      ],
      districtId: 'south',
      id: 'south-entry-flags',
      purpose: 'entry',
    },
    {
      boxes: [
        { color: '#86552f', id: 'south-viewing-bench', position: [5, 0.55, 26], scale: [0.8, 0.7, 2.6], solid: true },
        { color: '#f1efe6', id: 'south-bench-back', position: [5.25, 1.05, 26], scale: [0.25, 0.8, 2.6], solid: false },
      ],
      districtId: 'south',
      id: 'south-viewing-corner',
      purpose: 'rest',
    },
    {
      boxes: [
        { color: '#3f7f3a', id: 'south-flowerbed-green', position: [0, 0.3, 30], scale: [3.2, 0.5, 1], solid: false },
        { color: '#e24b3f', id: 'south-flowerbed-red', position: [-0.8, 0.65, 30], scale: [0.45, 0.35, 0.45], solid: false },
        { color: '#f2c94c', id: 'south-flowerbed-yellow', position: [0.8, 0.65, 30], scale: [0.45, 0.35, 0.45], solid: false },
      ],
      districtId: 'south',
      id: 'south-color-flowerbed',
      purpose: 'landmark',
    },
    {
      boxes: [
        { color: '#86552f', id: 'construction-barrier-post', position: [-40, 1, -31], scale: [0.6, 1.8, 0.6], solid: true },
        { color: '#e24b3f', id: 'construction-barrier-board-red', position: [-40, 1.35, -31], scale: [0.4, 0.45, 3], solid: false },
        { color: '#f1efe6', id: 'construction-barrier-board-white', position: [-40, 0.75, -31], scale: [0.4, 0.45, 3], solid: false },
      ],
      districtId: 'construction',
      id: 'construction-entry-barrier',
      purpose: 'entry',
    },
    {
      boxes: [
        { color: '#86552f', id: 'construction-material-stack', position: [-31, 0.45, -22.5], scale: [3, 0.8, 1.6], solid: false },
        { color: '#3b82f6', id: 'construction-toolbox', position: [-28.5, 0.45, -22.5], scale: [1.6, 0.8, 1.1], solid: false },
      ],
      districtId: 'construction',
      id: 'construction-materials',
      purpose: 'service',
    },
    {
      boxes: [
        { color: '#86552f', id: 'construction-work-lamp-post', position: [-22.1, 1.3, -31], scale: [0.6, 2.4, 0.6], solid: true },
        { color: '#facc15', id: 'construction-work-lamp', position: [-22.1, 2.7, -31], scale: [1, 0.5, 1], solid: false },
      ],
      districtId: 'construction',
      id: 'construction-work-light',
      purpose: 'landmark',
    },
    {
      boxes: [
        { color: '#86552f', id: 'town-west-lamp-post', position: [22.1, 1.3, 29.5], scale: [0.6, 2.4, 0.6], solid: true },
        { color: '#f2c94c', id: 'town-west-lamp-light', position: [22.1, 2.7, 29.5], scale: [1, 0.5, 1], solid: false },
      ],
      districtId: 'town',
      id: 'town-west-lamp',
      purpose: 'entry',
    },
    {
      boxes: [
        { color: '#86552f', id: 'town-east-lamp-post', position: [39.9, 1.3, 31], scale: [0.6, 2.4, 0.6], solid: true },
        { color: '#f2c94c', id: 'town-east-lamp-light', position: [39.9, 2.7, 31], scale: [1, 0.5, 1], solid: false },
      ],
      districtId: 'town',
      id: 'town-east-lamp',
      purpose: 'landmark',
    },
    {
      boxes: [
        { color: '#86552f', id: 'town-bench-seat', position: [31, 0.55, 31], scale: [3, 0.7, 0.8], solid: true },
        { color: '#3f7f3a', id: 'town-bench-hedge', position: [31, 0.55, 32.2], scale: [3.4, 1, 0.7], solid: false },
      ],
      districtId: 'town',
      id: 'town-bench-and-hedge',
      purpose: 'rest',
    },
    {
      boxes: [
        { color: '#c83e34', id: 'town-mailbox', position: [31, 0.85, 22.3], scale: [0.8, 1.4, 0.8], solid: false },
        { color: '#f1efe6', id: 'town-doorstep-west', position: [25, 0.22, 22], scale: [2.4, 0.3, 0.8], solid: false },
        { color: '#f2c94c', id: 'town-doorstep-east', position: [37, 0.22, 22], scale: [2.4, 0.3, 0.8], solid: false },
      ],
      districtId: 'town',
      id: 'town-mailbox-doorsteps',
      purpose: 'service',
    },
  ],
  districts: [
    { bounds: { maxX: 10, maxZ: 10, minX: -10, minZ: -10 }, id: 'hub', label: 'ちゅうおうしゃこ' },
    { bounds: { maxX: 12, maxZ: -14, minX: -12, minZ: -34 }, id: 'park', label: 'こうえん' },
    { bounds: { maxX: 34, maxZ: 6, minX: 14, minZ: -20 }, id: 'fire', label: 'かさいげんば' },
    { bounds: { maxX: -14, maxZ: 16, minX: -34, minZ: -10 }, id: 'blocks', label: 'つみきひろば' },
    { bounds: { maxX: 12, maxZ: 34, minX: -12, minZ: 14 }, id: 'south', label: 'じゆうそうこう' },
    {
      bounds: { maxX: -16, maxZ: -16, minX: -46, minZ: -46 },
      id: 'construction',
      label: 'こうじヤード',
    },
    {
      bounds: { maxX: 46, maxZ: 46, minX: 16, minZ: 16 },
      id: 'town',
      label: 'おもちゃのまち',
    },
  ],
  landmarks: {
    blockPlaza: {
      position: [-24, 0.18, 6],
      scale: [14, 0.34, 16],
    },
    colorPlaySources: [
      {
        color: '#ef4444',
        colorId: 'red',
        id: 'pool-red',
        kind: 'pool',
        position: [-9.4, 0.24, 18.5],
        triggerBounds: { maxX: -7.1, maxZ: 20.3, minX: -11.7, minZ: 16.7 },
      },
      {
        color: '#3b82f6',
        colorId: 'blue',
        id: 'pool-blue',
        kind: 'pool',
        position: [-9.4, 0.24, 24],
        triggerBounds: { maxX: -7.1, maxZ: 25.8, minX: -11.7, minZ: 22.2 },
      },
      {
        color: '#facc15',
        colorId: 'yellow',
        id: 'pool-yellow',
        kind: 'pool',
        position: [-9.4, 0.24, 29.5],
        triggerBounds: { maxX: -7.1, maxZ: 31.3, minX: -11.7, minZ: 27.7 },
      },
      {
        color: '#ef4444',
        colorId: 'red',
        id: 'shower-red',
        kind: 'shower',
        position: [9.4, 1.6, 18.5],
        triggerBounds: { maxX: 11.7, maxZ: 20.3, minX: 7.1, minZ: 16.7 },
      },
      {
        color: '#3b82f6',
        colorId: 'blue',
        id: 'shower-blue',
        kind: 'shower',
        position: [9.4, 1.6, 24],
        triggerBounds: { maxX: 11.7, maxZ: 25.8, minX: 7.1, minZ: 22.2 },
      },
      {
        color: '#facc15',
        colorId: 'yellow',
        id: 'shower-yellow',
        kind: 'shower',
        position: [9.4, 1.6, 29.5],
        triggerBounds: { maxX: 11.7, maxZ: 31.3, minX: 7.1, minZ: 27.7 },
      },
    ],
    construction: [-31, 0, -31],
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
    town: [31, 0, 31],
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
    {
      connects: ['blocks', 'construction'],
      id: 'road-construction-blocks-connector',
      position: [-32, 0.08, -13],
      scale: [4, 0.18, 6],
    },
    { connects: ['construction'], id: 'road-construction-south', position: [-31, 0.08, -18], scale: [26, 0.18, 4] },
    { connects: ['construction'], id: 'road-construction-west', position: [-44, 0.08, -31], scale: [4, 0.18, 26] },
    { connects: ['construction'], id: 'road-construction-north', position: [-31, 0.08, -44], scale: [26, 0.18, 4] },
    { connects: ['construction'], id: 'road-construction-east', position: [-18, 0.08, -31], scale: [4, 0.18, 26] },
    {
      connects: ['construction', 'park'],
      id: 'road-construction-park-connector',
      position: [-14, 0.08, -32],
      scale: [8, 0.18, 4],
    },
    {
      connects: ['fire', 'town'],
      id: 'road-town-fire-connector',
      position: [32, 0.08, 11],
      scale: [4, 0.18, 10],
    },
    { connects: ['town'], id: 'road-town-north', position: [31, 0.08, 18], scale: [26, 0.18, 4] },
    { connects: ['town'], id: 'road-town-east', position: [44, 0.08, 31], scale: [4, 0.18, 26] },
    { connects: ['town'], id: 'road-town-south', position: [31, 0.08, 44], scale: [26, 0.18, 4] },
    { connects: ['town'], id: 'road-town-west', position: [18, 0.08, 31], scale: [4, 0.18, 26] },
    {
      connects: ['south', 'town'],
      id: 'road-town-south-connector',
      position: [14, 0.08, 24],
      scale: [8, 0.18, 4],
    },
  ],
  surfaceTiles: [
    { color: '#dfcda8', districtId: 'hub', id: 'hub-ground', position: [0, 0.025, 0], scale: [20, 0.05, 20] },
    { color: '#f6e8c9', districtId: 'hub', id: 'hub-entry-pattern', position: [-6.4, 0.06, -7.2], scale: [5, 0.04, 0.55] },
    { color: '#91bd70', districtId: 'park', id: 'park-district-base', position: [0, 0.025, -24], scale: [24, 0.05, 20] },
    { color: '#91bd70', districtId: 'park', id: 'park-ground', position: [0, 0.055, -24], scale: [20, 0.02, 16] },
    { color: '#b9d798', districtId: 'park', id: 'park-entry-pattern', position: [0, 0.06, -15], scale: [8, 0.04, 0.65] },
    { color: '#d99275', districtId: 'fire', id: 'fire-ground', position: [24, 0.025, -7], scale: [20, 0.05, 26] },
    { color: '#efb7a3', districtId: 'fire', id: 'fire-entry-pattern', position: [15, 0.06, -7], scale: [0.65, 0.04, 8] },
    { color: '#d8ba76', districtId: 'blocks', id: 'blocks-district-base', position: [-24, 0.025, 3], scale: [20, 0.05, 26] },
    { color: '#d8ba76', districtId: 'blocks', id: 'block-plaza-ground', position: [-24, 0.055, 6], scale: [14, 0.02, 16] },
    { color: '#f2d995', districtId: 'blocks', id: 'blocks-entry-pattern', position: [-15, 0.06, -7], scale: [0.65, 0.04, 5] },
    { color: '#82b8d7', districtId: 'south', id: 'south-ground', position: [0, 0.025, 24], scale: [24, 0.05, 20] },
    { color: '#aed5e9', districtId: 'south', id: 'south-entry-pattern', position: [0, 0.06, 15], scale: [8, 0.04, 0.65] },
    { color: '#d5b468', districtId: 'construction', id: 'construction-ground', position: [-31, 0.025, -31], scale: [30, 0.05, 30] },
    { color: '#a9adb3', districtId: 'construction', id: 'construction-entry-pattern', position: [-31, 0.06, -17], scale: [8, 0.04, 0.65] },
    { color: '#a9adb3', districtId: 'construction', id: 'construction-gravel-patch', position: [-31, 0.055, -33], scale: [7, 0.02, 5] },
    { color: '#d7d0b9', districtId: 'town', id: 'town-ground', position: [31, 0.025, 31], scale: [30, 0.05, 30] },
    { color: '#eee7d2', districtId: 'town', id: 'town-green-west', position: [22, 0.055, 34], scale: [4, 0.02, 12] },
    { color: '#eee7d2', districtId: 'town', id: 'town-green-east', position: [40, 0.055, 35], scale: [4, 0.02, 14] },
    { color: '#eee7d2', districtId: 'town', id: 'town-entry-pattern', position: [31, 0.06, 17], scale: [8, 0.04, 0.65] },
  ],
  visualBoxes: [
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
    { color: '#c83e34', id: 'garage-roof-left', position: [-3.65, 3.65, 7.2], scale: [1.5, 0.5, 5.2], solid: false },
    { color: '#c83e34', id: 'garage-roof-right', position: [3.65, 3.65, 7.2], scale: [1.5, 0.5, 5.2], solid: false },
    { color: '#c83e34', id: 'garage-roof-back', position: [0, 3.65, 8.9], scale: [5.8, 0.5, 1.4], solid: false },
    { color: '#c83e34', id: 'garage-header', position: [0, 3.35, 4.7], scale: [8.8, 0.45, 0.35], solid: false },
    { color: '#a86f3f', id: 'fire-building-body', position: [23.5, 1.8, -16.5], scale: [6, 3.4, 5], solid: true },
    { color: '#6f4327', id: 'fire-building-roof', position: [23.5, 3.75, -16.5], scale: [6.8, 0.5, 5.8], solid: false },
    { color: '#7ed1e6', id: 'fire-window-1', position: [22.2, 1.9, -19.05], scale: [1.5, 1.5, 0.18], solid: false },
    { color: '#7ed1e6', id: 'fire-window-2', position: [24.8, 1.9, -19.05], scale: [1.5, 1.5, 0.18], solid: false },
    { color: '#c83e34', id: 'hub-gate-post', position: [-6, 1.1, 0], scale: [0.7, 2, 0.7], solid: true },
    { color: '#86552f', id: 'south-sign-post-west', position: [-3.5, 1.1, 18.5], scale: [0.7, 2, 0.7], solid: true },
    { color: '#86552f', id: 'south-sign-post-east', position: [3.5, 1.1, 29.5], scale: [0.7, 2, 0.7], solid: true },
    { color: '#f2c94c', id: 'south-sign-board-west', position: [-3.5, 2.15, 18.5], scale: [3, 1, 0.4], solid: false },
    { color: '#e24b3f', id: 'south-sign-board-east', position: [3.5, 2.15, 29.5], scale: [3, 1, 0.4], solid: false },
    { color: '#3b82f6', id: 'construction-office-body', position: [-38, 1.5, -37], scale: [6, 2.8, 5], solid: true },
    { color: '#facc15', id: 'construction-office-roof', position: [-38, 3.1, -37], scale: [6.8, 0.4, 5.8], solid: false },
    { color: '#f2c94c', id: 'construction-crane-post-west', position: [-27, 2, -38], scale: [0.8, 3.8, 0.8], solid: true },
    { color: '#f2c94c', id: 'construction-crane-post-east', position: [-21, 2, -38], scale: [0.8, 3.8, 0.8], solid: true },
    { color: '#f2c94c', id: 'construction-crane-beam', position: [-24, 3.85, -38], scale: [7, 0.5, 0.8], solid: false },
    { color: '#86552f', id: 'construction-timber-stack-a', position: [-35, 0.8, -26], scale: [3, 1.4, 2], solid: true },
    { color: '#86552f', id: 'construction-timber-stack-b', position: [-30, 0.8, -26], scale: [3, 1.4, 2], solid: true },
    { color: '#86552f', id: 'construction-timber-stack-c', position: [-25, 0.8, -26], scale: [3, 1.4, 2], solid: true },
    { color: '#86552f', id: 'construction-sign-post', position: [-40, 1.1, -22], scale: [0.7, 2, 0.7], solid: true },
    { color: '#e24b3f', id: 'construction-sign-board', position: [-40, 2.15, -22], scale: [3.4, 1, 0.4], solid: false },
    { color: '#e24b3f', id: 'town-house-red-body', position: [25, 1.5, 25], scale: [6, 2.8, 5], solid: true },
    { color: '#c83e34', id: 'town-house-red-roof', position: [25, 3.1, 25], scale: [6.8, 0.4, 5.8], solid: false },
    { color: '#f2c94c', id: 'town-house-yellow-body', position: [37, 1.5, 25], scale: [6, 2.8, 5], solid: true },
    { color: '#6f4327', id: 'town-house-yellow-roof', position: [37, 3.1, 25], scale: [6.8, 0.4, 5.8], solid: false },
    { color: '#f1efe6', id: 'town-house-white-body', position: [31, 1.5, 37], scale: [6, 2.8, 5], solid: true },
    { color: '#c83e34', id: 'town-house-white-roof', position: [31, 3.1, 37], scale: [6.8, 0.4, 5.8], solid: false },
    { color: '#86552f', id: 'town-tree-trunk-a', position: [22, 1.25, 34], scale: [0.7, 2.2, 0.7], solid: true },
    { color: '#3f7f3a', id: 'town-tree-crown-a', position: [22, 2.85, 34], scale: [2.2, 1.4, 2.2], solid: false },
    { color: '#86552f', id: 'town-tree-trunk-b', position: [40, 1.25, 33], scale: [0.7, 2.2, 0.7], solid: true },
    { color: '#3f7f3a', id: 'town-tree-crown-b', position: [40, 2.85, 33], scale: [2.2, 1.4, 2.2], solid: false },
    { color: '#86552f', id: 'town-tree-trunk-c', position: [24, 1.25, 40], scale: [0.7, 2.2, 0.7], solid: true },
    { color: '#3f7f3a', id: 'town-tree-crown-c', position: [24, 2.85, 40], scale: [2.2, 1.4, 2.2], solid: false },
    { color: '#86552f', id: 'town-sign-post-west', position: [28, 1.1, 21.5], scale: [0.7, 2, 0.7], solid: true },
    { color: '#86552f', id: 'town-sign-post-east', position: [34, 1.1, 21.5], scale: [0.7, 2, 0.7], solid: true },
    { color: '#f2c94c', id: 'town-sign-board', position: [31, 2.15, 21.5], scale: [7, 1, 0.4], solid: false },
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
    ...map.surfaceTiles.map(({ id }) => id),
    ...map.decorationClusters.map(({ id }) => id),
    ...map.decorationClusters.flatMap(({ boxes }) => boxes.map(({ id }) => id)),
    ...map.visualBoxes.map(({ id }) => id),
    ...map.landmarks.breakableBlocks.map(({ id }) => id),
    ...map.landmarks.bulldozerDebris.map(({ id }) => id),
    ...map.landmarks.colorPlaySources.map(({ id }) => id),
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
    { name: 'construction', position: map.landmarks.construction },
    { name: 'town', position: map.landmarks.town },
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
    ...map.landmarks.colorPlaySources.map(({ id, position }) => ({
      name: `colorPlaySource:${id}`,
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

  const southBounds = map.districts.find(({ id }) => id === 'south')?.bounds;
  for (const [index, source] of map.landmarks.colorPlaySources.entries()) {
    const boundsAreFinite = isFiniteBounds(source.triggerBounds);
    const boundsAreOrdered = boundsAreFinite && isOrderedBounds(source.triggerBounds);
    if (!boundsAreFinite) {
      errors.push(`non-finite color source bounds: ${source.id}`);
    } else if (!boundsAreOrdered) {
      errors.push(`invalid color source bounds: ${source.id}`);
    }

    const positionIsSouth = source.position.every(Number.isFinite)
      && resolveWorldDistrictInMap(map, source.position) === 'south';
    const boundsAreInsideSouth = southBounds !== undefined
      && isFiniteBounds(southBounds)
      && isOrderedBounds(southBounds)
      && boundsAreOrdered
      && isBoundsInsideBounds(source.triggerBounds, southBounds);
    if (!positionIsSouth || !boundsAreInsideSouth) {
      errors.push(`color source outside south district: ${source.id}`);
    }

    if (!['red', 'blue', 'yellow'].includes(source.colorId)) {
      errors.push(`invalid color source color: ${source.id}`);
    }
    if (!['pool', 'shower'].includes(source.kind)) {
      errors.push(`invalid color source kind: ${source.id}`);
    }
    if (!/^#[0-9a-f]{6}$/i.test(source.color)) {
      errors.push(`invalid color source hex: ${source.id}`);
    }

    if (!boundsAreOrdered) continue;
    for (const other of map.landmarks.colorPlaySources.slice(index + 1)) {
      if (!isFiniteBounds(other.triggerBounds) || !isOrderedBounds(other.triggerBounds)) continue;
      if (doBoundsOverlapWithPositiveArea(source.triggerBounds, other.triggerBounds)) {
        errors.push(`overlapping color sources: ${source.id}, ${other.id}`);
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
    { expected: 'construction', name: 'construction', position: map.landmarks.construction },
    { expected: 'town', name: 'town', position: map.landmarks.town },
  ];
  for (const landmark of expectedDistricts) {
    const received = resolveWorldDistrictInMap(map, landmark.position);
    if (received !== landmark.expected) {
      errors.push(`landmark ${landmark.name} expected ${landmark.expected}, received ${received}`);
    }
  }

  errors.push(...validateWorldStreetscape(map));

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

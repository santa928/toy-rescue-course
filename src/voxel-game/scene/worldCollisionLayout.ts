import { PRODUCTION_WORLD_MAP, type WorldBoxDefinition } from './productionWorldMap';

/** R3F meshとRapier colliderで共有するEuler回転。 */
export type BoxRotation = readonly [number, number, number];

/** 既存consumer向けに色とsolid属性を隠した共有直方体定義。 */
export type BoxDefinition = Omit<WorldBoxDefinition, 'color' | 'solid'>;

/** 消防車の実CuboidColliderと車庫clearance testで共有するhalf extents。 */
export const VEHICLE_COLLIDER_HALF_EXTENTS = [1.45, 0.95, 1.7] as const;

/** 本番mapのsolid定義だけを描画元と同じ順序・参照で公開する。 */
export const WORLD_SOLID_BOXES: readonly WorldBoxDefinition[] = (
  PRODUCTION_WORLD_MAP.visualBoxes.filter(({ solid }) => solid)
);

/** 72×72の描画床とRapier ground colliderで共有する直方体。 */
export const WORLD_GROUND_BOX = {
  position: [0, -0.2, 0] as const,
  scale: [
    PRODUCTION_WORLD_MAP.bounds.maxX - PRODUCTION_WORLD_MAP.bounds.minX,
    0.4,
    PRODUCTION_WORLD_MAP.bounds.maxZ - PRODUCTION_WORLD_MAP.bounds.minZ,
  ] as const,
};

/** 一意なsolid定義をIDで取得し、欠落時は起動を停止する。 */
function requireSolidBox(id: string): WorldBoxDefinition {
  const box = WORLD_SOLID_BOXES.find((candidate) => candidate.id === id);
  if (!box) throw new Error(`Missing production world solid: ${id}`);
  return box;
}

/** 中央公園に描画する3本の木の幹。 */
export const TREE_TRUNKS: readonly BoxDefinition[] = [
  requireSolidBox('tree-trunk-1'),
  requireSolidBox('tree-trunk-2'),
  requireSolidBox('tree-trunk-3'),
];

/** 北東の火災建物で衝突対象にする主ボディ。 */
export const FIRE_BUILDING_BODY: BoxDefinition = requireSolidBox('fire-building-body');

/** 初期車両を囲まず、-Z正面から出入りできる消防車庫3壁。 */
export const GARAGE_WALLS: readonly BoxDefinition[] = [
  requireSolidBox('garage-back-wall'),
  requireSolidBox('garage-left-wall'),
  requireSolidBox('garage-right-wall'),
];

/** 公園の赤い遊具板。 */
export const PLAYGROUND_PLANK: BoxDefinition = requireSolidBox('playground-plank');

/** 公園の黄色い遊具支柱。 */
export const PLAYGROUND_SUPPORT: BoxDefinition = requireSolidBox('playground-support');

/** 公園遊具を構成する静的衝突用の2部品。 */
export const PLAYGROUND_SOLIDS = [PLAYGROUND_PLANK, PLAYGROUND_SUPPORT] as const;

/** 座標・scale・rotationがRapierへ安全に渡せる定義だけを受理する。 */
export function isValidBoxDefinition(box: BoxDefinition): boolean {
  const positionIsFinite = box.position.every(Number.isFinite);
  const scaleIsPositiveFinite = box.scale.every((value) => Number.isFinite(value) && value > 0);
  const rotationIsFinite = box.rotation?.every(Number.isFinite) ?? true;
  return box.id.length > 0 && positionIsFinite && scaleIsPositiveFinite && rotationIsFinite;
}

/** axis-alignedなbox同士の軸別分離距離を返し、負値はその軸の重なりを表す。 */
export function getAxisAlignedSeparation(
  box: BoxDefinition,
  center: readonly [number, number, number],
  halfExtents: readonly [number, number, number],
): readonly [number, number, number] {
  return box.position.map((value, axis) => (
    Math.abs(center[axis] - value) - (halfExtents[axis] + box.scale[axis] / 2)
  )) as [number, number, number];
}

/** 描画用full scaleをRapier CuboidCollider用half extentsへ副作用なく変換する。 */
export function scaleToHalfExtents(
  scale: readonly [number, number, number],
): [number, number, number] {
  return [scale[0] / 2, scale[1] / 2, scale[2] / 2];
}

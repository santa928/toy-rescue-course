/** R3F meshとRapier colliderで共有するEuler回転。 */
export type BoxRotation = readonly [number, number, number];

/** 箱庭の描画と静的衝突が共有するworld座標単位の直方体定義。 */
export interface BoxDefinition {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly rotation?: BoxRotation;
  readonly scale: readonly [number, number, number];
}

/** 消防車の実CuboidColliderと車庫clearance testで共有するhalf extents。 */
export const VEHICLE_COLLIDER_HALF_EXTENTS = [1.45, 0.95, 1.7] as const;

/** 中央公園に描画する3本の木の幹。 */
export const TREE_TRUNKS: readonly BoxDefinition[] = [
  { id: 'tree-trunk-1', position: [-4, 1.25, -2], scale: [0.7, 2.2, 0.7] },
  { id: 'tree-trunk-2', position: [-4.5, 1.25, 2], scale: [0.7, 2.2, 0.7] },
  { id: 'tree-trunk-3', position: [4.4, 1.25, 2.1], scale: [0.7, 2.2, 0.7] },
];

/** 北東の火災建物で衝突対象にする主ボディ。 */
export const FIRE_BUILDING_BODY: BoxDefinition = {
  id: 'fire-building-body',
  position: [9.5, 1.8, -9.5],
  scale: [6, 3.4, 5],
};

/** 初期車両を囲まず、+Z正面から出入りできる消防車庫3壁。 */
export const GARAGE_WALLS: readonly BoxDefinition[] = [
  { id: 'garage-back-wall', position: [0, 1.8, 11.6], scale: [8.8, 3.4, 0.8] },
  { id: 'garage-left-wall', position: [-4, 1.8, 13], scale: [0.8, 3.4, 3] },
  { id: 'garage-right-wall', position: [4, 1.8, 13], scale: [0.8, 3.4, 3] },
];

/** 公園の傾いた赤い遊具板。 */
export const PLAYGROUND_PLANK: BoxDefinition = {
  id: 'playground-plank',
  position: [2.9, 0.75, 2.4],
  rotation: [0, 0, -0.2],
  scale: [3.4, 0.28, 0.7],
};

/** 公園の黄色い遊具支柱。 */
export const PLAYGROUND_SUPPORT: BoxDefinition = {
  id: 'playground-support',
  position: [2.9, 0.45, 2.4],
  scale: [0.36, 0.8, 0.36],
};

/** 公園遊具を構成する静的衝突用の2部品。 */
export const PLAYGROUND_SOLIDS = [PLAYGROUND_PLANK, PLAYGROUND_SUPPORT] as const;

/** 箱庭で消防車を通過させない9個の静的直方体。 */
export const WORLD_SOLID_BOXES: readonly BoxDefinition[] = [
  ...TREE_TRUNKS,
  FIRE_BUILDING_BODY,
  ...GARAGE_WALLS,
  ...PLAYGROUND_SOLIDS,
];

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

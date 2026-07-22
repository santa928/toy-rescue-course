/** 箱庭の描画と静的衝突が共有する、world座標単位の直方体定義。 */
export interface BoxDefinition {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
}

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

/** 箱庭で消防車を通過させない4個の直方体。 */
export const WORLD_SOLID_BOXES: readonly BoxDefinition[] = [
  ...TREE_TRUNKS,
  FIRE_BUILDING_BODY,
];

/** 描画用full scaleをRapier CuboidCollider用half extentsへ副作用なく変換する。 */
export function scaleToHalfExtents(
  scale: readonly [number, number, number],
): [number, number, number] {
  return [scale[0] / 2, scale[1] / 2, scale[2] / 2];
}

/** 純ボクセル箱庭で使用する36×36相当の座標境界。 */
export const WORLD_BOUNDS = { maxX: 18, maxZ: 18, minX: -18, minZ: -18 } as const;

/** 消防車庫前に置く消防車の初期位置。 */
export const GARAGE_POSITION = [0, 0.8, 14] as const;

/** 火災建物の代表位置。 */
export const FIRE_POSITION = [12, 1.2, -11] as const;

/** 中央公園の基準位置。 */
export const PARK_CENTER = [0, 0, 0] as const;

/** 後続Taskで壊せるようにする積み木広場の配置契約。 */
export const BREAKABLE_BLOCKS = [
  { color: '#ef4444', id: 'plaza-red', position: [-13, 0.75, 0] as const },
  { color: '#facc15', id: 'plaza-yellow', position: [-11.5, 0.75, -1.5] as const },
  { color: '#3b82f6', id: 'plaza-blue', position: [-12, 0.75, 1.6] as const },
  { color: '#65a30d', id: 'plaza-green', position: [-10.2, 0.75, 0.7] as const },
] as const;

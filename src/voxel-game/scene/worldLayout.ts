/** 純ボクセル箱庭で使用する36×36相当の座標境界。 */
export const WORLD_BOUNDS = { maxX: 18, maxZ: 18, minX: -18, minZ: -18 } as const;

/** 消防車庫前に置く消防車の初期位置。 */
export const GARAGE_POSITION = [0, 0.8, 14] as const;

/** 車庫へ戻ったとみなして次の仕事を再開するXZ半径。 */
export const GARAGE_RESTART_RADIUS = 3;

/** 高低差を無視し、車両が車庫の仕事再開領域内にいるか判定する。 */
export function isInsideGarageRestartArea(
  vehiclePosition: readonly [number, number, number],
): boolean {
  return Math.hypot(
    vehiclePosition[0] - GARAGE_POSITION[0],
    vehiclePosition[2] - GARAGE_POSITION[2],
  ) <= GARAGE_RESTART_RADIUS;
}

/** 火災建物の代表位置。 */
export const FIRE_POSITION = [12, 1.2, -11] as const;

/** 中央公園の基準位置。 */
export const PARK_CENTER = [0, 0, 0] as const;

/** 西側道路と中央公園の間へ収める木製積み木広場の土台。 */
export const BLOCK_PLAZA = {
  position: [-9.5, 0.18, 0] as const,
  scale: [7, 0.34, 14] as const,
} as const;

/** 車体の回転外形を挟める間隔で並べた積み木広場の配置契約。 */
export const BREAKABLE_BLOCKS = [
  { color: '#ef4444', id: 'plaza-red', position: [-12.2, 0.75, 3.5] as const },
  { color: '#facc15', id: 'plaza-yellow', position: [-7, 0.75, -6] as const },
  { color: '#3b82f6', id: 'plaza-blue', position: [-6.8, 0.75, -1.4] as const },
  { color: '#65a30d', id: 'plaza-green', position: [-12.2, 0.75, -3.5] as const },
] as const;

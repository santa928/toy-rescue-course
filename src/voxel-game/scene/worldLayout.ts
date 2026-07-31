import {
  PRODUCTION_WORLD_MAP,
  resolveWorldDistrict,
  type ResolvedWorldDistrictId,
} from './productionWorldMap';

/** 純ボクセル箱庭で使用する72×72本番座標境界。 */
export const WORLD_BOUNDS = PRODUCTION_WORLD_MAP.bounds;

/** 描画・物理と共有する本番箱庭の地区定義。 */
export const WORLD_DISTRICTS = PRODUCTION_WORLD_MAP.districts;

/** 消防車庫前に置く消防車の初期位置。 */
export const GARAGE_POSITION = [0, 0.8, 6] as const;

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

/** 車両world座標を本番地区IDへ解決する。 */
export function resolveVehicleDistrict(
  position: readonly [number, number, number],
): ResolvedWorldDistrictId {
  return resolveWorldDistrict(position);
}

/** 火災建物の代表位置。 */
export const FIRE_POSITION = [26, 1.2, -18] as const;

/** 消火判定と水流補正に使う、画面に見える炎の中心位置。 */
export const FIRE_SPRAY_TARGET_POSITION = [26.9, 1.45, -16.1] as const;

/** 中央公園の基準位置。 */
export const PARK_CENTER = [0, 0, -24] as const;

/** 西側の積み木地区へ収める木製積み木広場の土台。 */
export const BLOCK_PLAZA = {
  position: [-24, 0.18, 6] as const,
  scale: [14, 0.34, 16] as const,
} as const;

/** 車体の回転外形を挟める間隔で並べた積み木広場の配置契約。 */
export const BREAKABLE_BLOCKS = [
  { color: '#ef4444', id: 'plaza-red', position: [-26.7, 0.75, 9.5] as const },
  { color: '#facc15', id: 'plaza-yellow', position: [-21.5, 0.75, 0] as const },
  { color: '#3b82f6', id: 'plaza-blue', position: [-21.3, 0.75, 4.6] as const },
  { color: '#65a30d', id: 'plaza-green', position: [-26.7, 0.75, 2.5] as const },
] as const;

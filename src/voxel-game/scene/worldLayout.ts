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
export const GARAGE_POSITION = PRODUCTION_WORLD_MAP.landmarks.garage;

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
export const FIRE_POSITION = PRODUCTION_WORLD_MAP.landmarks.fire;

/** 消火判定と水流補正に使う、画面に見える炎の中心位置。 */
export const FIRE_SPRAY_TARGET_POSITION = PRODUCTION_WORLD_MAP.landmarks.fireSprayTarget;

/** 中央車庫から火災地区へ導く非solid道しるべのworld座標。 */
export const FIRE_ROUTE_MARKER_POSITIONS = PRODUCTION_WORLD_MAP.landmarks.fireRouteMarkers;

/** 消火成功時に火災現場上空へ置く星中心のworld座標。 */
export const CELEBRATION_STAR_CENTER_POSITIONS =
  PRODUCTION_WORLD_MAP.landmarks.celebrationStarCenters;

/** 中央公園の基準位置。 */
export const PARK_CENTER = PRODUCTION_WORLD_MAP.landmarks.park;

/** 西側の積み木地区へ収める木製積み木広場の土台。 */
export const BLOCK_PLAZA = PRODUCTION_WORLD_MAP.landmarks.blockPlaza;

/** 車体の回転外形を挟める間隔で並べた積み木広場の配置契約。 */
export const BREAKABLE_BLOCKS = PRODUCTION_WORLD_MAP.landmarks.breakableBlocks;

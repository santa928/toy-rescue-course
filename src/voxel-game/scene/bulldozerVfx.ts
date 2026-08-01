import type { BulldozerMissionSnapshot } from '../domain/BulldozerMissionRuntime';
import {
  VEHICLE_JOBS,
  type BulldozerVehicleJobDefinition,
} from '../domain/vehicleJobs';
import type { BulldozerDebrisPaletteId } from './productionWorldMap';
import { BULLDOZER_DEBRIS, BULLDOZER_ROUTE_MARKER_POSITIONS } from './worldLayout';

export const BULLDOZER_DEBRIS_VOXELS_PER_SOURCE = 4;
export const BULLDOZER_CHIPS_PER_SOURCE = 6;
export const BULLDOZER_DEBRIS_VOXEL_POOL_SIZE =
  BULLDOZER_DEBRIS.length * BULLDOZER_DEBRIS_VOXELS_PER_SOURCE;
export const BULLDOZER_CHIP_POOL_SIZE = BULLDOZER_DEBRIS.length * BULLDOZER_CHIPS_PER_SOURCE;
export const BULLDOZER_STAR_POOL_SIZE = 12;

export type BulldozerVfxPaletteId = BulldozerDebrisPaletteId | 'route' | 'star';

/** 固定pool内の1 voxelを毎frame in-place更新する描画target。 */
export interface BulldozerVoxelTransform {
  active: boolean;
  palette: BulldozerVfxPaletteId;
  readonly position: [number, number, number];
  readonly scale: [number, number, number];
  readonly slot: number;
  readonly sourceIndex: number;
}

/** がれき、chip、route、成功星の固定slotをまとめた再利用frame。 */
export interface BulldozerVfxFrame {
  readonly celebrationCenter: [number, number, number];
  readonly chips: BulldozerVoxelTransform[];
  readonly debris: BulldozerVoxelTransform[];
  readonly routeMarkers: BulldozerVoxelTransform[];
  readonly stars: BulldozerVoxelTransform[];
}

const HIDDEN_Y = -40;
const CHIP_LIFETIME_SECONDS = 1.1;
const DEBRIS_VOXELS = [
  { offset: [0, 0, 0] as const, scale: [0.95, 0.8, 0.85] as const },
  { offset: [0.52, 0.18, 0.12] as const, scale: [0.62, 0.58, 0.68] as const },
  { offset: [-0.48, 0.12, -0.2] as const, scale: [0.68, 0.55, 0.62] as const },
  { offset: [0.08, 0.5, -0.28] as const, scale: [0.58, 0.52, 0.58] as const },
] as const;
const CHIP_DIRECTIONS = [
  [-0.86, 0.82, -0.42],
  [-0.52, 1, 0.66],
  [-0.12, 0.9, -0.92],
  [0.28, 1.08, 0.88],
  [0.64, 0.84, -0.56],
  [0.92, 0.96, 0.36],
] as const;
const STAR_OFFSETS = [
  [-1.8, 0.1, -0.5], [-1.2, 0.8, 0.2], [-0.6, 0.2, -0.8],
  [0, 1, 0], [0.6, 0.35, 0.7], [1.2, 0.85, -0.2],
  [1.8, 0.15, 0.45], [-1.5, 1.4, 0.6], [-0.5, 1.7, -0.4],
  [0.5, 1.55, 0.45], [1.5, 1.35, -0.55], [0, 2.1, 0.2],
] as const;

/** 指定paletteとsourceへ紐づく非active固定slotを作る。 */
function createTransform(
  slot: number,
  sourceIndex: number,
  palette: BulldozerVfxPaletteId,
): BulldozerVoxelTransform {
  return {
    active: false,
    palette,
    position: [0, HIDDEN_Y, 0],
    scale: [0, 0, 0],
    slot,
    sourceIndex,
  };
}

/** transformを描画対象外のzero scale位置へin-placeで戻す。 */
export function hideBulldozerTransform(transform: BulldozerVoxelTransform): void {
  transform.active = false;
  transform.position[0] = 0;
  transform.position[1] = HIDDEN_Y;
  transform.position[2] = 0;
  transform.scale[0] = 0;
  transform.scale[1] = 0;
  transform.scale[2] = 0;
}

/** 別車種選択中に重ならないよう、がれき本体を含む全固定slotを非表示へ戻す。 */
export function hideBulldozerMissionFrame(frame: BulldozerVfxFrame): void {
  for (const transform of frame.debris) hideBulldozerTransform(transform);
  for (const transform of frame.chips) hideBulldozerTransform(transform);
  for (const transform of frame.routeMarkers) hideBulldozerTransform(transform);
  for (const transform of frame.stars) hideBulldozerTransform(transform);
}

/** 全slotを一度だけ確保した非active frameを返す。 */
export function createBulldozerVfxFrame(): BulldozerVfxFrame {
  return {
    celebrationCenter: [0, HIDDEN_Y, 0],
    debris: Array.from({ length: BULLDOZER_DEBRIS_VOXEL_POOL_SIZE }, (_, slot) => {
      const sourceIndex = Math.floor(slot / BULLDOZER_DEBRIS_VOXELS_PER_SOURCE);
      return createTransform(slot, sourceIndex, BULLDOZER_DEBRIS[sourceIndex].palette);
    }),
    chips: Array.from({ length: BULLDOZER_CHIP_POOL_SIZE }, (_, slot) => {
      const sourceIndex = Math.floor(slot / BULLDOZER_CHIPS_PER_SOURCE);
      return createTransform(slot, sourceIndex, BULLDOZER_DEBRIS[sourceIndex].palette);
    }),
    routeMarkers: BULLDOZER_ROUTE_MARKER_POSITIONS.map((_, slot) => (
      createTransform(slot, -1, 'route')
    )),
    stars: Array.from({ length: BULLDOZER_STAR_POOL_SIZE }, (_, slot) => (
      createTransform(slot, -1, 'star')
    )),
  };
}

/** 3対象の平均を玩具グリッドへ丸め、成功星の中心を既存tupleへ書き戻す。 */
export function updateBulldozerCelebrationCenter(
  job: BulldozerVehicleJobDefinition,
  target: [number, number, number],
): void {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const { position } of job.debris) {
    x += position[0];
    y += position[1];
    z += position[2];
  }
  const count = job.debris.length || 1;
  target[0] = Math.round(x / count * 2) / 2;
  target[1] = y / count + 0.7;
  target[2] = Math.round(z / count * 2) / 2;
}

/** 現在snapshotとclear時刻から全固定slotを配列再生成なしで更新する。 */
export function updateBulldozerVfxFrame(
  frame: BulldozerVfxFrame,
  snapshot: BulldozerMissionSnapshot,
  clearTimesSeconds: Float64Array,
  elapsedSeconds: number,
  job: BulldozerVehicleJobDefinition = VEHICLE_JOBS.bulldozer[0],
): void {
  const safeElapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  updateBulldozerCelebrationCenter(job, frame.celebrationCenter);

  for (const transform of frame.debris) {
    const source = job.debris[transform.sourceIndex];
    const debrisState = snapshot.debris[transform.sourceIndex];
    if (!source || !debrisState || debrisState.cleared) {
      hideBulldozerTransform(transform);
      continue;
    }
    const voxel = DEBRIS_VOXELS[transform.slot % BULLDOZER_DEBRIS_VOXELS_PER_SOURCE];
    transform.active = true;
    transform.palette = source.palette;
    transform.position[0] = source.position[0] + voxel.offset[0];
    transform.position[1] = source.position[1] + voxel.offset[1];
    transform.position[2] = source.position[2] + voxel.offset[2];
    transform.scale[0] = voxel.scale[0];
    transform.scale[1] = voxel.scale[1];
    transform.scale[2] = voxel.scale[2];
  }

  for (const transform of frame.chips) {
    const source = job.debris[transform.sourceIndex];
    const clearTime = clearTimesSeconds[transform.sourceIndex] ?? -1;
    const age = safeElapsed - clearTime;
    if (!source || clearTime < 0 || age < 0 || age >= CHIP_LIFETIME_SECONDS) {
      hideBulldozerTransform(transform);
      continue;
    }
    const direction = CHIP_DIRECTIONS[transform.slot % BULLDOZER_CHIPS_PER_SOURCE];
    const remaining = 1 - age / CHIP_LIFETIME_SECONDS;
    const size = 0.28 * remaining;
    transform.active = true;
    transform.palette = source.palette;
    transform.position[0] = source.position[0] + direction[0] * age * 2.4;
    transform.position[1] = source.position[1] + 0.3
      + direction[1] * age * 3.2 - 4.8 * age * age;
    transform.position[2] = source.position[2] + direction[2] * age * 2.4;
    transform.scale[0] = size;
    transform.scale[1] = size;
    transform.scale[2] = size;
  }

  for (const transform of frame.routeMarkers) {
    const position = job.routeMarkers[transform.slot];
    if (!snapshot.routeVisible || !position) {
      hideBulldozerTransform(transform);
      continue;
    }
    const pulse = 0.42 + Math.sin(safeElapsed * 4 + transform.slot * 0.65) * 0.05;
    transform.active = true;
    transform.position[0] = position[0];
    transform.position[1] = position[1] + Math.sin(safeElapsed * 3 + transform.slot) * 0.08;
    transform.position[2] = position[2];
    transform.scale[0] = pulse;
    transform.scale[1] = pulse;
    transform.scale[2] = pulse;
  }

  for (const transform of frame.stars) {
    const offset = STAR_OFFSETS[transform.slot];
    if (snapshot.missionPhase !== 'celebrating' || !offset) {
      hideBulldozerTransform(transform);
      continue;
    }
    const pulse = 0.24 + Math.sin(safeElapsed * 8 + transform.slot) * 0.05;
    transform.active = true;
    transform.position[0] = frame.celebrationCenter[0] + offset[0];
    transform.position[1] = frame.celebrationCenter[1] + offset[1]
      + Math.sin(safeElapsed * 5 + transform.slot) * 0.12;
    transform.position[2] = frame.celebrationCenter[2] + offset[2];
    transform.scale[0] = pulse;
    transform.scale[1] = pulse;
    transform.scale[2] = pulse;
  }
}

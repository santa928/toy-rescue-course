import type { BulldozerMissionSnapshot } from '../domain/BulldozerMissionRuntime';
import {
  VEHICLE_JOBS,
  type BulldozerVehicleJobDefinition,
} from '../domain/vehicleJobs';
import type { BulldozerDebrisPaletteId } from './productionWorldMap';
import { BULLDOZER_DEBRIS, BULLDOZER_ROUTE_MARKER_POSITIONS } from './worldLayout';

export const BULLDOZER_DEBRIS_VOXELS_PER_SOURCE = 4;
export const BULLDOZER_CHIPS_PER_SOURCE = 12;
export const BULLDOZER_DEBRIS_VOXEL_POOL_SIZE =
  BULLDOZER_DEBRIS.length * BULLDOZER_DEBRIS_VOXELS_PER_SOURCE;
export const BULLDOZER_CHIP_POOL_SIZE = BULLDOZER_DEBRIS.length * BULLDOZER_CHIPS_PER_SOURCE;
export const BULLDOZER_STAR_POOL_SIZE = 12;
export const BULLDOZER_TARGET_MARKER_SLOT_COUNT = 4;
export const BULLDOZER_DYNAMIC_FRUSTUM_CULLED = false;
export const BULLDOZER_GUIDE_POOL_SIZE = BULLDOZER_ROUTE_MARKER_POSITIONS.length
  + BULLDOZER_TARGET_MARKER_SLOT_COUNT;

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
  readonly clearDirections: [number, number][];
  readonly debris: BulldozerVoxelTransform[];
  readonly routeMarkers: BulldozerVoxelTransform[];
  readonly stars: BulldozerVoxelTransform[];
}

/** 接触中のblade基準と周期を既存chip poolへ渡す。 */
export interface BulldozerVfxContact {
  readonly bladeCenter: readonly [number, number, number];
  readonly forward: readonly [number, number, number];
  readonly progress: number;
  readonly sourceIndex: number;
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
  [-0.96, 0.7, 0.12],
  [-0.7, 1.12, -0.72],
  [-0.34, 0.76, 0.98],
  [0.12, 1.18, -1],
  [0.52, 0.72, 0.86],
  [0.88, 1.04, -0.14],
] as const;
const IMPACT_PALETTES = ['crate', 'stone', 'timber'] as const;
const STAR_OFFSETS = [
  [-1.8, 0.1, -0.5], [-1.2, 0.8, 0.2], [-0.6, 0.2, -0.8],
  [0, 1, 0], [0.6, 0.35, 0.7], [1.2, 0.85, -0.2],
  [1.8, 0.15, 0.45], [-1.5, 1.4, 0.6], [-0.5, 1.7, -0.4],
  [0.5, 1.55, 0.45], [1.5, 1.35, -0.55], [0, 2.1, 0.2],
] as const;
const TARGET_MARKER_PARTS = [
  { offset: [-1.35, 0, -1.35], scale: [0.32, 0.9, 0.32] },
  { offset: [1.35, 0, -1.35], scale: [0.32, 0.9, 0.32] },
  { offset: [-1.35, 0, 1.35], scale: [0.32, 0.9, 0.32] },
  { offset: [1.35, 0, 1.35], scale: [0.32, 0.9, 0.32] },
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
    clearDirections: BULLDOZER_DEBRIS.map(() => [0, 1]),
    debris: Array.from({ length: BULLDOZER_DEBRIS_VOXEL_POOL_SIZE }, (_, slot) => {
      const sourceIndex = Math.floor(slot / BULLDOZER_DEBRIS_VOXELS_PER_SOURCE);
      return createTransform(slot, sourceIndex, BULLDOZER_DEBRIS[sourceIndex].palette);
    }),
    chips: Array.from({ length: BULLDOZER_CHIP_POOL_SIZE }, (_, slot) => {
      const sourceIndex = Math.floor(slot / BULLDOZER_CHIPS_PER_SOURCE);
      return createTransform(slot, sourceIndex, BULLDOZER_DEBRIS[sourceIndex].palette);
    }),
    routeMarkers: Array.from({ length: BULLDOZER_GUIDE_POOL_SIZE }, (_, slot) => (
      createTransform(
        slot,
        slot < BULLDOZER_ROUTE_MARKER_POSITIONS.length ? -1 : -2,
        'route',
      )
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
  contact: BulldozerVfxContact | null = null,
): void {
  const safeElapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  updateBulldozerCelebrationCenter(job, frame.celebrationCenter);
  if (contact && Number.isInteger(contact.sourceIndex)) {
    const direction = frame.clearDirections[contact.sourceIndex];
    const length = Math.hypot(contact.forward[0], contact.forward[2]);
    if (direction && Number.isFinite(length) && length > 0.001) {
      direction[0] = contact.forward[0] / length;
      direction[1] = contact.forward[2] / length;
    }
  }

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
    const localSlot = transform.slot % BULLDOZER_CHIPS_PER_SOURCE;
    if (!source) {
      hideBulldozerTransform(transform);
      continue;
    }
    if (clearTime >= 0 && age >= 0 && age < CHIP_LIFETIME_SECONDS) {
      const direction = CHIP_DIRECTIONS[localSlot];
      const clearForward = frame.clearDirections[transform.sourceIndex] ?? [0, 1];
      const rightX = clearForward[1];
      const rightZ = -clearForward[0];
      const remaining = 1 - age / CHIP_LIFETIME_SECONDS;
      const size = 0.3 * remaining;
      const forwardPush = age * 1.9;
      transform.active = true;
      transform.palette = IMPACT_PALETTES[localSlot % IMPACT_PALETTES.length];
      transform.position[0] = source.position[0]
        + rightX * direction[0] * age * 2.5
        + clearForward[0] * (direction[2] * age * 1.2 + forwardPush);
      transform.position[1] = source.position[1] + 0.3
        + direction[1] * age * 3.2 - 4.8 * age * age;
      transform.position[2] = source.position[2]
        + rightZ * direction[0] * age * 2.5
        + clearForward[1] * (direction[2] * age * 1.2 + forwardPush);
      transform.scale[0] = size;
      transform.scale[1] = size;
      transform.scale[2] = size;
      continue;
    }
    if (
      contact
      && contact.sourceIndex === transform.sourceIndex
      && localSlot < 9
      && Number.isFinite(contact.progress)
      && contact.progress > 0
    ) {
      const forwardLength = Math.hypot(contact.forward[0], contact.forward[2]) || 1;
      const forwardX = contact.forward[0] / forwardLength;
      const forwardZ = contact.forward[2] / forwardLength;
      const rightX = forwardZ;
      const rightZ = -forwardX;
      const ray = Math.floor(localSlot / 3) - 1;
      const step = localSlot % 3 + 1;
      const distance = step * 0.34 * (0.8 + Math.min(contact.progress, 1) * 0.2);
      transform.active = true;
      transform.palette = IMPACT_PALETTES[localSlot % IMPACT_PALETTES.length];
      transform.position[0] = contact.bladeCenter[0]
        + forwardX * distance + rightX * ray * distance * 0.58;
      transform.position[1] = source.position[1] + 0.12 + (step % 2) * 0.04;
      transform.position[2] = contact.bladeCenter[2]
        + forwardZ * distance + rightZ * ray * distance * 0.58;
      transform.scale[0] = 0.18;
      transform.scale[1] = 0.1;
      transform.scale[2] = 0.22 + step * 0.04;
      continue;
    }
    hideBulldozerTransform(transform);
  }

  const nextTargetIndex = snapshot.debris.findIndex(({ cleared }) => !cleared);
  for (const transform of frame.routeMarkers) {
    if (transform.sourceIndex === -2) {
      const target = job.debris[nextTargetIndex];
      const part = TARGET_MARKER_PARTS[
        transform.slot - BULLDOZER_ROUTE_MARKER_POSITIONS.length
      ];
      if (!snapshot.routeVisible || !target || !part) {
        hideBulldozerTransform(transform);
        continue;
      }
      const pulse = 1 + Math.sin(safeElapsed * 5) * 0.06;
      transform.active = true;
      transform.position[0] = target.position[0] + part.offset[0];
      transform.position[1] = 1.35 + Math.sin(safeElapsed * 4) * 0.08;
      transform.position[2] = target.position[2] + part.offset[2];
      transform.scale[0] = part.scale[0] * pulse;
      transform.scale[1] = part.scale[1];
      transform.scale[2] = part.scale[2] * pulse;
      continue;
    }
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

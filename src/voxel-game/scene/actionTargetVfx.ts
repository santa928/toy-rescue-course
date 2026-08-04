import type { ActionTargetMissionSnapshot } from '../domain/ActionTargetMissionRuntime';
import * as THREE from 'three';
import type { WorldPoint } from './productionWorldMap';

export const ACTION_TARGET_BODY_POOL_SIZE = 18;
export const ACTION_TARGET_ACCENT_POOL_SIZE = 9;
export const ACTION_TARGET_PARTICLE_POOL_SIZE = 30;
export const ACTION_TARGET_ROUTE_POOL_SIZE = 7;
export const ACTION_TARGET_STAR_POOL_SIZE = 12;
/** 毎frame遠隔座標へ動かす固定poolは原点の初期境界で描画除外しない。 */
export const ACTION_TARGET_DYNAMIC_FRUSTUM_CULLED = false;

/** 追加車両の対象を描き分ける3つの玩具形状。 */
export type ActionTargetKind = 'soil' | 'patient' | 'checkpoint';

/** 1つの主操作対象と寛容な水平接触半径。 */
export interface ActionTargetVfxSource {
  readonly id: string;
  readonly position: WorldPoint;
  readonly radius: number;
}

/** VFXが読む現在仕事の対象、形状、道しるべ。 */
export interface ActionTargetVfxJob {
  readonly routeMarkers: readonly WorldPoint[];
  readonly targetKind: ActionTargetKind;
  readonly targets: readonly ActionTargetVfxSource[];
}

/** 固定pool内の1 voxelを毎frame in-place更新する描画target。 */
export interface ActionTargetVoxelTransform {
  active: boolean;
  colorMixToWhite: number;
  readonly position: [number, number, number];
  readonly scale: [number, number, number];
  readonly slot: number;
  readonly sourceIndex: number;
}

/** target、particle、route、成功星の固定slotをまとめた再利用frame。 */
export interface ActionTargetVfxFrame {
  readonly celebrationCenter: [number, number, number];
  readonly particles: ActionTargetVoxelTransform[];
  readonly routeMarkers: ActionTargetVoxelTransform[];
  readonly stars: ActionTargetVoxelTransform[];
  readonly targetAccents: ActionTargetVoxelTransform[];
  readonly targetBodies: ActionTargetVoxelTransform[];
}

/** 接触中の固有アクションを対象VFXへ渡す固定値。 */
export interface ActionTargetVfxInteraction {
  readonly actionCycleProgress: number;
  readonly contactPoint: WorldPoint;
  readonly forward: WorldPoint;
  readonly holdProgress: number;
  readonly sourceIndex: number;
}

const TARGET_CAPACITY = 3;
const BODY_VOXELS_PER_TARGET = ACTION_TARGET_BODY_POOL_SIZE / TARGET_CAPACITY;
const ACCENT_VOXELS_PER_TARGET = ACTION_TARGET_ACCENT_POOL_SIZE / TARGET_CAPACITY;
const PARTICLES_PER_TARGET = ACTION_TARGET_PARTICLE_POOL_SIZE / TARGET_CAPACITY;
const HIDDEN_Y = -40;
const PARTICLE_LIFETIME_SECONDS = 1.1;
const PATIENT_RISE_SECONDS = 0.65;
const PATIENT_GLYPH_LIFETIME_SECONDS = 1.3;
const CHECKPOINT_ARCH_WHITE_SECONDS = 1;
const CHECKPOINT_ARCH_LIFETIME_SECONDS = 1.8;
const BODY_SHAPES: Readonly<Record<ActionTargetKind, readonly {
  readonly offset: WorldPoint;
  readonly scale: WorldPoint;
}[]>> = {
  checkpoint: [
    { offset: [-1.82, 0, 0], scale: [0.28, 1.5, 0.28] },
    { offset: [1.82, 0, 0], scale: [0.28, 1.5, 0.28] },
    { offset: [-1.32, 0.7, 0], scale: [1.32, 0.28, 0.28] },
    { offset: [0, 0.7, 0], scale: [1.32, 0.28, 0.28] },
    { offset: [1.32, 0.7, 0], scale: [1.32, 0.28, 0.28] },
    { offset: [0, -0.62, 0], scale: [4.2, 0.12, 0.5] },
  ],
  patient: [
    { offset: [0, 0.68, 0], scale: [0.72, 0.72, 0.72] },
    { offset: [0, 0.1, 0], scale: [0.78, 0.9, 0.52] },
    { offset: [-0.48, 0.1, 0], scale: [0.24, 0.72, 0.24] },
    { offset: [0.48, 0.1, 0], scale: [0.24, 0.72, 0.24] },
    { offset: [-0.24, -0.58, 0], scale: [0.28, 0.7, 0.3] },
    { offset: [0.24, -0.58, 0], scale: [0.28, 0.7, 0.3] },
  ],
  soil: [
    { offset: [0, 0, 0], scale: [1.25, 0.7, 1.05] },
    { offset: [-0.62, 0.08, -0.18], scale: [0.65, 0.55, 0.62] },
    { offset: [0.62, 0.1, 0.12], scale: [0.68, 0.58, 0.7] },
    { offset: [-0.2, 0.45, 0.3], scale: [0.62, 0.54, 0.58] },
    { offset: [0.35, 0.4, -0.3], scale: [0.58, 0.5, 0.62] },
    { offset: [-0.42, 0.36, -0.38], scale: [0.48, 0.42, 0.5] },
  ],
};
const ACCENT_SHAPES: Readonly<Record<ActionTargetKind, readonly {
  readonly offset: WorldPoint;
  readonly scale: WorldPoint;
}[]>> = {
  checkpoint: [
    { offset: [-1.32, 0.7, -0.2], scale: [0.32, 0.32, 0.32] },
    { offset: [0, 0.7, -0.2], scale: [0.32, 0.32, 0.32] },
    { offset: [1.32, 0.7, -0.2], scale: [0.32, 0.32, 0.32] },
  ],
  patient: [
    { offset: [0, 0.12, -0.3], scale: [0.18, 0.58, 0.12] },
    { offset: [-0.2, 0.12, -0.3], scale: [0.22, 0.18, 0.12] },
    { offset: [0.2, 0.12, -0.3], scale: [0.22, 0.18, 0.12] },
  ],
  soil: [
    { offset: [-0.5, 0.3, 0.35], scale: [0.22, 0.22, 0.22] },
    { offset: [0.08, 0.58, -0.08], scale: [0.24, 0.24, 0.24] },
    { offset: [0.55, 0.3, -0.22], scale: [0.2, 0.2, 0.2] },
  ],
};
const PATIENT_LYING_BODY_SHAPES = [
  { offset: [-0.72, 0.04, 0], scale: [0.72, 0.72, 0.72] },
  { offset: [0, 0, 0], scale: [0.9, 0.52, 0.78] },
  { offset: [0, 0, -0.48], scale: [0.72, 0.24, 0.24] },
  { offset: [0, 0, 0.48], scale: [0.72, 0.24, 0.24] },
  { offset: [0.7, 0, -0.24], scale: [0.7, 0.28, 0.3] },
  { offset: [0.7, 0, 0.24], scale: [0.7, 0.28, 0.3] },
] as const;
const PATIENT_LYING_ACCENT_SHAPES = [
  { offset: [0, -0.3, 0], scale: [0.58, 0.12, 0.18] },
  { offset: [0, -0.3, -0.2], scale: [0.18, 0.12, 0.22] },
  { offset: [0, -0.3, 0.2], scale: [0.18, 0.12, 0.22] },
] as const;
const PARTICLE_DIRECTIONS = [
  [-0.9, 0.9, -0.45], [-0.58, 1.05, 0.7], [-0.18, 0.88, -0.92],
  [0.25, 1.1, 0.88], [0.62, 0.86, -0.58], [0.94, 0.98, 0.38],
  [-0.78, 1.16, 0.16], [-0.42, 0.82, -0.78], [0.44, 1.2, 0.76],
  [0.82, 0.9, -0.2],
] as const;
const PATIENT_GLYPH_OFFSETS = [
  [-0.65, 0, 0], [-0.95, 0, 0], [-0.35, 0, 0], [-0.65, 0.3, 0], [-0.65, -0.3, 0],
  [0.4, 0.18, 0], [0.9, 0.18, 0], [0.25, 0.42, 0], [1.05, 0.42, 0], [0.65, -0.2, 0],
] as const;
const STAR_OFFSETS = [
  [-1.8, 0.1, -0.5], [-1.2, 0.8, 0.2], [-0.6, 0.2, -0.8],
  [0, 1, 0], [0.6, 0.35, 0.7], [1.2, 0.85, -0.2],
  [1.8, 0.15, 0.45], [-1.5, 1.4, 0.6], [-0.5, 1.7, -0.4],
  [0.5, 1.55, 0.45], [1.5, 1.35, -0.55], [0, 2.1, 0.2],
] as const;

/** 指定sourceへ紐づく非active固定slotを作る。 */
function createTransform(slot: number, sourceIndex: number): ActionTargetVoxelTransform {
  return {
    active: false,
    colorMixToWhite: 0,
    position: [0, HIDDEN_Y, 0],
    scale: [0, 0, 0],
    slot,
    sourceIndex,
  };
}

/** transformを描画対象外のzero scale位置へin-placeで戻す。 */
export function hideActionTargetTransform(transform: ActionTargetVoxelTransform): void {
  transform.active = false;
  transform.colorMixToWhite = 0;
  transform.position[0] = 0;
  transform.position[1] = HIDDEN_Y;
  transform.position[2] = 0;
  transform.scale[0] = 0;
  transform.scale[1] = 0;
  transform.scale[2] = 0;
}

/** 全slotを一度だけ確保した非active frameを返す。 */
export function createActionTargetVfxFrame(): ActionTargetVfxFrame {
  return {
    celebrationCenter: [0, HIDDEN_Y, 0],
    particles: Array.from({ length: ACTION_TARGET_PARTICLE_POOL_SIZE }, (_, slot) => (
      createTransform(slot, Math.floor(slot / PARTICLES_PER_TARGET))
    )),
    routeMarkers: Array.from({ length: ACTION_TARGET_ROUTE_POOL_SIZE }, (_, slot) => (
      createTransform(slot, -1)
    )),
    stars: Array.from({ length: ACTION_TARGET_STAR_POOL_SIZE }, (_, slot) => (
      createTransform(slot, -1)
    )),
    targetAccents: Array.from({ length: ACTION_TARGET_ACCENT_POOL_SIZE }, (_, slot) => (
      createTransform(slot, Math.floor(slot / ACCENT_VOXELS_PER_TARGET))
    )),
    targetBodies: Array.from({ length: ACTION_TARGET_BODY_POOL_SIZE }, (_, slot) => (
      createTransform(slot, Math.floor(slot / BODY_VOXELS_PER_TARGET))
    )),
  };
}

/** 現在jobの対象平均を成功星の玩具グリッド中心へ書き戻す。 */
function updateCelebrationCenter(
  job: ActionTargetVfxJob,
  target: [number, number, number],
): void {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const source of job.targets) {
    x += source.position[0];
    y += source.position[1];
    z += source.position[2];
  }
  const count = job.targets.length || 1;
  target[0] = Math.round(x / count * 2) / 2;
  target[1] = y / count + 0.7;
  target[2] = Math.round(z / count * 2) / 2;
}

export type PatientGlyphKind = 'cross' | 'heart';

/** 手当て進捗中に使う患者glyph種を返す。 */
export function getPatientGlyphKinds(holdProgress: number): readonly PatientGlyphKind[] {
  if (!Number.isFinite(holdProgress) || holdProgress <= 0) return [];
  return ['cross', 'heart'];
}

/** 患者の完了時刻から予備収縮と0.65秒の起き上がりposeを返す。 */
export function getPatientRecoveryPose(
  completed: boolean,
  completionTimeSeconds: number,
  elapsedSeconds: number,
): { readonly rise: number; readonly scaleY: number } {
  if (!completed || completionTimeSeconds < 0) return { rise: 0, scaleY: 1 };
  const age = Math.max(0, elapsedSeconds - completionTimeSeconds);
  if (age <= 0.12) {
    return {
      rise: 0,
      scaleY: 1 - Math.sin(age / 0.12 * Math.PI) * 0.08,
    };
  }
  if (age >= PATIENT_RISE_SECONDS - 1e-9) return { rise: 1, scaleY: 1 };
  return {
    rise: Math.min(1, (age - 0.12) / (PATIENT_RISE_SECONDS - 0.12)),
    scaleY: 1,
  };
}

const CHECKPOINT_ACCENT_ORDERS = [
  [],
  [0],
  [0, 1],
  [0, 1, 2],
] as const;

/** 巡回hold進捗から入口側より点灯済みとなるaccent順を返す。 */
export function getCheckpointAccentOrder(holdProgress: number): readonly number[] {
  if (!Number.isFinite(holdProgress) || holdProgress <= 0) return CHECKPOINT_ACCENT_ORDERS[0];
  const progress = Math.min(1, holdProgress);
  const count = progress < 0.4 ? 1 : progress < 0.7 ? 2 : 3;
  return CHECKPOINT_ACCENT_ORDERS[count];
}

/** 現在snapshotと完了時刻から全固定slotを配列再生成なしで更新する。 */
export function updateActionTargetVfxFrame(
  frame: ActionTargetVfxFrame,
  snapshot: ActionTargetMissionSnapshot,
  completionTimesSeconds: Float64Array,
  elapsedSeconds: number,
  job: ActionTargetVfxJob,
  enabled: boolean,
  interaction: ActionTargetVfxInteraction | null = null,
): void {
  const safeElapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  updateCelebrationCenter(job, frame.celebrationCenter);

  for (const transform of frame.targetBodies) {
    const source = job.targets[transform.sourceIndex];
    const state = snapshot.targets[transform.sourceIndex];
    const shapeIndex = transform.slot % BODY_VOXELS_PER_TARGET;
    const shape = BODY_SHAPES[job.targetKind][shapeIndex];
    const patientShape = PATIENT_LYING_BODY_SHAPES[shapeIndex];
    const patientVisible = job.targetKind === 'patient';
    if (!enabled || !source || !state || (state.completed && !patientVisible) || !shape) {
      hideActionTargetTransform(transform);
      continue;
    }
    const recovery = patientVisible
      ? getPatientRecoveryPose(
        state.completed,
        completionTimesSeconds[transform.sourceIndex] ?? -1,
        safeElapsed,
      )
      : { rise: 1, scaleY: 1 };
    const rise = recovery.rise;
    const startShape = patientVisible && patientShape ? patientShape : shape;
    transform.active = true;
    transform.position[0] = source.position[0]
      + startShape.offset[0] + (shape.offset[0] - startShape.offset[0]) * rise;
    transform.position[1] = source.position[1]
      + startShape.offset[1] + (shape.offset[1] - startShape.offset[1]) * rise;
    transform.position[2] = source.position[2]
      + startShape.offset[2] + (shape.offset[2] - startShape.offset[2]) * rise;
    transform.scale[0] = startShape.scale[0] + (shape.scale[0] - startShape.scale[0]) * rise;
    const baseScaleY = startShape.scale[1] + (shape.scale[1] - startShape.scale[1]) * rise;
    const soilHold = job.targetKind === 'soil'
      && interaction?.sourceIndex === transform.sourceIndex
      ? Math.min(1, Math.max(0, interaction.holdProgress))
      : 0;
    const digWeight = (shapeIndex + 1) / BODY_VOXELS_PER_TARGET;
    transform.scale[1] = baseScaleY * recovery.scaleY
      * (1 - soilHold * (0.18 + digWeight * 0.48));
    transform.position[1] -= (baseScaleY - transform.scale[1]) / 2;
    transform.scale[2] = startShape.scale[2] + (shape.scale[2] - startShape.scale[2]) * rise;
  }

  for (const transform of frame.targetAccents) {
    const source = job.targets[transform.sourceIndex];
    const state = snapshot.targets[transform.sourceIndex];
    const shapeIndex = transform.slot % ACCENT_VOXELS_PER_TARGET;
    const shape = ACCENT_SHAPES[job.targetKind][shapeIndex];
    const patientShape = PATIENT_LYING_ACCENT_SHAPES[shapeIndex];
    const patientVisible = job.targetKind === 'patient';
    if (!enabled || !source || !state || (state.completed && !patientVisible) || !shape) {
      hideActionTargetTransform(transform);
      continue;
    }
    const recovery = patientVisible
      ? getPatientRecoveryPose(
        state.completed,
        completionTimesSeconds[transform.sourceIndex] ?? -1,
        safeElapsed,
      )
      : { rise: 1, scaleY: 1 };
    const rise = recovery.rise;
    const startShape = patientVisible && patientShape ? patientShape : shape;
    const pulse = 1 + Math.sin(safeElapsed * 5 + transform.slot) * 0.08;
    const checkpointChase = job.targetKind === 'checkpoint'
      && interaction?.sourceIndex === transform.sourceIndex
      ? getCheckpointAccentOrder(interaction.holdProgress)
      : null;
    const chaseScale = checkpointChase
      ? (checkpointChase.includes(shapeIndex) ? 1.46 : 0.72)
      : 1;
    transform.active = true;
    transform.position[0] = source.position[0]
      + startShape.offset[0] + (shape.offset[0] - startShape.offset[0]) * rise;
    transform.position[1] = source.position[1]
      + startShape.offset[1] + (shape.offset[1] - startShape.offset[1]) * rise;
    transform.position[2] = source.position[2]
      + startShape.offset[2] + (shape.offset[2] - startShape.offset[2]) * rise;
    transform.scale[0] = (startShape.scale[0]
      + (shape.scale[0] - startShape.scale[0]) * rise) * pulse * chaseScale;
    transform.scale[1] = (startShape.scale[1]
      + (shape.scale[1] - startShape.scale[1]) * rise) * pulse * recovery.scaleY * chaseScale;
    transform.scale[2] = (startShape.scale[2]
      + (shape.scale[2] - startShape.scale[2]) * rise) * pulse * chaseScale;
  }

  for (const transform of frame.particles) {
    const source = job.targets[transform.sourceIndex];
    const completionTime = completionTimesSeconds[transform.sourceIndex] ?? -1;
    const age = safeElapsed - completionTime;
    const localSlot = transform.slot % PARTICLES_PER_TARGET;
    const direction = PARTICLE_DIRECTIONS[localSlot];
    transform.colorMixToWhite = 0;
    if (!enabled || !source || !direction) {
      hideActionTargetTransform(transform);
      continue;
    }
    if (job.targetKind === 'checkpoint' && completionTime >= 0 && age >= 0) {
      if (age >= CHECKPOINT_ARCH_LIFETIME_SECONDS) {
        hideActionTargetTransform(transform);
        continue;
      }
      const step = localSlot / (PARTICLES_PER_TARGET - 1);
      const archX = (step - 0.5) * 4.4;
      const archY = Math.sin(step * Math.PI) * 2.2;
      const spread = Math.min(1, age / 0.15);
      transform.active = true;
      transform.colorMixToWhite = Math.min(1, age / CHECKPOINT_ARCH_WHITE_SECONDS);
      transform.position[0] = source.position[0] + archX * spread;
      transform.position[1] = source.position[1] + 0.5 + archY * spread + age * 0.18;
      transform.position[2] = source.position[2] + age * 0.45;
      const size = 0.28 - age * 0.055;
      transform.scale[0] = size;
      transform.scale[1] = size;
      transform.scale[2] = size;
      continue;
    }
    if (
      job.targetKind === 'patient'
      && completionTime >= 0
      && age >= 0
      && age < PATIENT_GLYPH_LIFETIME_SECONDS
    ) {
      const offset = PATIENT_GLYPH_OFFSETS[localSlot];
      const remaining = 1 - age / PATIENT_GLYPH_LIFETIME_SECONDS;
      transform.active = true;
      transform.position[0] = source.position[0] + offset[0] * (1 + remaining * 0.18);
      transform.position[1] = source.position[1] + 1.75 + offset[1] + age * 0.22;
      transform.position[2] = source.position[2] + offset[2];
      transform.scale[0] = 0.2 * remaining;
      transform.scale[1] = 0.2 * remaining;
      transform.scale[2] = 0.2 * remaining;
      continue;
    }
    if (completionTime >= 0 && age >= 0 && age < PARTICLE_LIFETIME_SECONDS) {
      const size = 0.3 * (1 - age / PARTICLE_LIFETIME_SECONDS);
      const soilLift = job.targetKind === 'soil' ? 1.28 : 1;
      transform.active = true;
      transform.position[0] = source.position[0] + direction[0] * age * 2.5;
      transform.position[1] = source.position[1] + 0.3
        + direction[1] * age * 3.2 * soilLift - 4.8 * age * age;
      transform.position[2] = source.position[2] + direction[2] * age * 2.5;
      transform.scale[0] = size;
      transform.scale[1] = size;
      transform.scale[2] = size;
      continue;
    }
    if (
      job.targetKind === 'patient'
      && interaction?.sourceIndex === transform.sourceIndex
      && Number.isFinite(interaction.holdProgress)
      && interaction.holdProgress > 0
    ) {
      const hold = Math.min(1, interaction.holdProgress);
      const angle = localSlot / PARTICLES_PER_TARGET * Math.PI * 2
        + interaction.actionCycleProgress * Math.PI * 2;
      const radius = 1.05 + Math.sin(hold * Math.PI) * 0.22;
      transform.active = true;
      transform.position[0] = source.position[0] + Math.cos(angle) * radius;
      transform.position[1] = source.position[1] + 0.2 + hold * 1.6
        + Math.sin(angle * 2) * 0.06;
      transform.position[2] = source.position[2] + Math.sin(angle) * radius;
      const size = 0.16 + (localSlot % 2) * 0.045;
      transform.scale[0] = size;
      transform.scale[1] = size;
      transform.scale[2] = size;
      continue;
    }
    if (
      job.targetKind === 'soil'
      && interaction?.sourceIndex === transform.sourceIndex
      && localSlot < 9
      && Number.isFinite(interaction.holdProgress)
      && interaction.holdProgress > 0
    ) {
      const cycle = Math.min(1, Math.max(0, interaction.actionCycleProgress));
      const forwardLength = Math.hypot(interaction.forward[0], interaction.forward[2]) || 1;
      const forwardX = interaction.forward[0] / forwardLength;
      const forwardZ = interaction.forward[2] / forwardLength;
      const rightX = forwardZ;
      const rightZ = -forwardX;
      const angle = localSlot / 9 * Math.PI * 2;
      const startX = source.position[0] + Math.cos(angle) * 0.82;
      const startY = source.position[1] + 0.24 + (localSlot % 3) * 0.12;
      const startZ = source.position[2] + Math.sin(angle) * 0.72;
      if (cycle < 0.55) {
        const progress = Math.min(1, cycle / 0.55 + localSlot * 0.035);
        transform.position[0] = THREE.MathUtils.lerp(startX, interaction.contactPoint[0], progress);
        transform.position[1] = THREE.MathUtils.lerp(startY, interaction.contactPoint[1] + 0.28, progress)
          + Math.sin(progress * Math.PI) * 0.25;
        transform.position[2] = THREE.MathUtils.lerp(startZ, interaction.contactPoint[2], progress);
      } else {
        const progress = Math.min(1, (cycle - 0.55) / 0.45 + localSlot * 0.025);
        const sideDistance = 1.35 + (localSlot % 3) * 0.22;
        transform.position[0] = interaction.contactPoint[0]
          + rightX * sideDistance * progress + forwardX * 0.45 * progress;
        transform.position[1] = interaction.contactPoint[1] + 0.25
          + Math.sin(progress * Math.PI) * 0.95 + (localSlot % 2) * 0.08;
        transform.position[2] = interaction.contactPoint[2]
          + rightZ * sideDistance * progress + forwardZ * 0.45 * progress;
      }
      const size = 0.17 + (localSlot % 3) * 0.035;
      transform.active = true;
      transform.scale[0] = size;
      transform.scale[1] = size;
      transform.scale[2] = size;
      continue;
    }
    hideActionTargetTransform(transform);
  }

  for (const transform of frame.routeMarkers) {
    const position = job.routeMarkers[transform.slot];
    if (!enabled || !snapshot.routeVisible || !position) {
      hideActionTargetTransform(transform);
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
    if (!enabled || snapshot.missionPhase !== 'celebrating' || !offset) {
      hideActionTargetTransform(transform);
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

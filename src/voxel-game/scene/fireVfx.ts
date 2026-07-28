/** 立体ボクセル炎の固定slotと、描画時刻ごとのtransformを計算するpure module。 */

export type FireVoxelRole = 'outer' | 'middle' | 'core';
export type FireVoxelKind = 'flame' | 'spark';

export interface FireVoxelSlot {
  readonly basePosition: readonly [number, number, number];
  readonly baseScale: readonly [number, number, number];
  readonly cycleSeconds: number;
  readonly kind: FireVoxelKind;
  readonly minimumLayerCount: 1 | 2 | 3;
  readonly phase: number;
  readonly role: FireVoxelRole;
  readonly slot: number;
}

export interface FireVoxelTransform {
  readonly active: boolean;
  readonly kind: FireVoxelKind;
  readonly position: readonly [number, number, number];
  readonly role: FireVoxelRole;
  readonly scale: readonly [number, number, number];
  readonly slot: number;
}

export interface FireVoxelFrame {
  readonly instances: readonly FireVoxelTransform[];
}

const TAU = Math.PI * 2;

export const FIRE_VOXEL_POOL_SIZE = 18;
export const FIRE_ROLE_CAPACITY = { core: 4, middle: 8, outer: 6 } as const;

export const FIRE_VOXEL_SLOTS: readonly FireVoxelSlot[] = [
  { slot: 0, role: 'outer', kind: 'flame', minimumLayerCount: 1, basePosition: [12.92, 0.62, -9.05], baseScale: [0.95, 0.72, 0.9], phase: 0.04, cycleSeconds: 0.82 },
  { slot: 1, role: 'outer', kind: 'flame', minimumLayerCount: 2, basePosition: [12.62, 0.95, -8.82], baseScale: [0.58, 0.85, 0.55], phase: 0.21, cycleSeconds: 0.94 },
  { slot: 2, role: 'outer', kind: 'flame', minimumLayerCount: 2, basePosition: [13.22, 0.88, -9.22], baseScale: [0.58, 0.78, 0.55], phase: 0.48, cycleSeconds: 0.77 },
  { slot: 3, role: 'outer', kind: 'flame', minimumLayerCount: 3, basePosition: [12.68, 1.55, -8.96], baseScale: [0.44, 0.82, 0.44], phase: 0.67, cycleSeconds: 0.91 },
  { slot: 4, role: 'outer', kind: 'flame', minimumLayerCount: 3, basePosition: [13.18, 1.78, -9.12], baseScale: [0.4, 0.9, 0.4], phase: 0.83, cycleSeconds: 1.03 },
  { slot: 5, role: 'outer', kind: 'flame', minimumLayerCount: 3, basePosition: [12.96, 1.45, -9.38], baseScale: [0.42, 0.75, 0.42], phase: 0.34, cycleSeconds: 0.73 },
  { slot: 6, role: 'middle', kind: 'flame', minimumLayerCount: 1, basePosition: [12.92, 0.62, -8.98], baseScale: [0.68, 0.72, 0.62], phase: 0.13, cycleSeconds: 0.74 },
  { slot: 7, role: 'middle', kind: 'flame', minimumLayerCount: 1, basePosition: [12.76, 0.96, -8.92], baseScale: [0.48, 0.76, 0.46], phase: 0.42, cycleSeconds: 0.88 },
  { slot: 8, role: 'middle', kind: 'flame', minimumLayerCount: 2, basePosition: [13.12, 1.12, -9.03], baseScale: [0.46, 0.82, 0.44], phase: 0.61, cycleSeconds: 0.79 },
  { slot: 9, role: 'middle', kind: 'flame', minimumLayerCount: 2, basePosition: [12.72, 1.38, -9.05], baseScale: [0.36, 0.7, 0.35], phase: 0.91, cycleSeconds: 0.97 },
  { slot: 10, role: 'middle', kind: 'flame', minimumLayerCount: 3, basePosition: [13.08, 1.88, -9.12], baseScale: [0.32, 0.82, 0.32], phase: 0.28, cycleSeconds: 0.86 },
  { slot: 11, role: 'core', kind: 'flame', minimumLayerCount: 1, basePosition: [12.9, 0.55, -8.85], baseScale: [0.48, 0.58, 0.44], phase: 0.17, cycleSeconds: 0.69 },
  { slot: 12, role: 'core', kind: 'flame', minimumLayerCount: 1, basePosition: [12.78, 0.82, -8.82], baseScale: [0.3, 0.46, 0.28], phase: 0.56, cycleSeconds: 0.81 },
  { slot: 13, role: 'core', kind: 'flame', minimumLayerCount: 2, basePosition: [13.05, 1.08, -8.92], baseScale: [0.3, 0.55, 0.3], phase: 0.76, cycleSeconds: 0.9 },
  { slot: 14, role: 'core', kind: 'flame', minimumLayerCount: 3, basePosition: [12.88, 1.5, -8.92], baseScale: [0.26, 0.62, 0.26], phase: 0.38, cycleSeconds: 0.72 },
  { slot: 15, role: 'middle', kind: 'spark', minimumLayerCount: 1, basePosition: [12.6, 0.78, -8.8], baseScale: [0.16, 0.16, 0.16], phase: 0.1, cycleSeconds: 0.85 },
  { slot: 16, role: 'middle', kind: 'spark', minimumLayerCount: 2, basePosition: [13.16, 0.82, -8.95], baseScale: [0.15, 0.15, 0.15], phase: 0.43, cycleSeconds: 1.05 },
  { slot: 17, role: 'middle', kind: 'spark', minimumLayerCount: 3, basePosition: [12.92, 0.9, -9.25], baseScale: [0.14, 0.14, 0.14], phase: 0.77, cycleSeconds: 1.22 },
] as const;

/** 不正入力を含む火勢を描画段階0〜3へ丸める。 */
function normalizeLayerCount(layerCount: number): 0 | 1 | 2 | 3 {
  if (!Number.isFinite(layerCount)) return 0;
  return Math.max(0, Math.min(3, Math.trunc(layerCount))) as 0 | 1 | 2 | 3;
}

/** 負値・非finiteを0へ寄せ、同一入力を決定的なVFX時刻へ変換する。 */
function normalizeElapsedSeconds(elapsedSeconds: number): number {
  return Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
}

/** 負値を含む値を0以上modulus未満へ循環させる。 */
function modulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/** 固定slotのうち現在火勢で表示する個数を返す。 */
export function getActiveFireVoxelCount(layerCount: number): number {
  const normalized = normalizeLayerCount(layerCount);
  return FIRE_VOXEL_SLOTS.reduce(
    (count, slot) => count + Number(normalized >= slot.minimumLayerCount),
    0,
  );
}

/** 通常炎1slotの非同期な揺れと伸縮を計算する。 */
function createFlameTransform(
  slot: FireVoxelSlot,
  elapsedSeconds: number,
  active: boolean,
): FireVoxelTransform {
  const phaseRadians = slot.phase * TAU;
  const verticalWave = Math.sin(elapsedSeconds / slot.cycleSeconds * TAU + phaseRadians);
  const horizontalWave = Math.sin(
    elapsedSeconds / (slot.cycleSeconds * 1.37) * TAU + phaseRadians,
  );
  const depthWave = Math.cos(
    elapsedSeconds / (slot.cycleSeconds * 1.19) * TAU + phaseRadians,
  );
  return {
    active,
    kind: slot.kind,
    position: [
      slot.basePosition[0] + horizontalWave * 0.08,
      slot.basePosition[1] + verticalWave * 0.07,
      slot.basePosition[2] + depthWave * 0.04,
    ],
    role: slot.role,
    scale: active ? [
      slot.baseScale[0] * (1 - verticalWave * 0.05),
      slot.baseScale[1] * (1 + verticalWave * 0.14),
      slot.baseScale[2] * (1 - verticalWave * 0.05),
    ] : [0, 0, 0],
    slot: slot.slot,
  };
}

/** 火の粉1slotを上昇・縮小させ、寿命後に同じslotへ循環させる。 */
function createSparkTransform(
  slot: FireVoxelSlot,
  elapsedSeconds: number,
  active: boolean,
): FireVoxelTransform {
  const age = modulo(elapsedSeconds / slot.cycleSeconds + slot.phase, 1);
  const scaleFactor = 1 - age * 0.7;
  return {
    active,
    kind: slot.kind,
    position: [
      slot.basePosition[0] + Math.sin(age * TAU + slot.phase * TAU) * 0.12,
      slot.basePosition[1] + age * 2,
      slot.basePosition[2] + Math.cos(age * TAU + slot.phase * TAU) * 0.09,
    ],
    role: slot.role,
    scale: active ? [
      slot.baseScale[0] * scaleFactor,
      slot.baseScale[1] * scaleFactor,
      slot.baseScale[2] * scaleFactor,
    ] : [0, 0, 0],
    slot: slot.slot,
  };
}

/** 同じ時刻・火勢から同じ18 transformを返すpureな炎frame計算。 */
export function createFireVoxelFrame(input: {
  readonly elapsedSeconds: number;
  readonly layerCount: number;
}): FireVoxelFrame {
  const elapsedSeconds = normalizeElapsedSeconds(input.elapsedSeconds);
  const layerCount = normalizeLayerCount(input.layerCount);
  return {
    instances: FIRE_VOXEL_SLOTS.map((slot) => {
      const active = layerCount >= slot.minimumLayerCount;
      return slot.kind === 'spark'
        ? createSparkTransform(slot, elapsedSeconds, active)
        : createFlameTransform(slot, elapsedSeconds, active);
    }),
  };
}

export const WATER_STREAM_COUNT = 24;
export const WATER_SPLASH_COUNT = 8;
export const WATER_INSTANCE_COUNT = WATER_STREAM_COUNT + WATER_SPLASH_COUNT;
const STREAM_EMISSION_INTERVAL_SECONDS = 0.032;
const STREAM_PERIOD_SECONDS = 1.15;
const SPLASH_LIFETIME_SECONDS = 0.22;

/**
 * 水流フレーム計算の入力。座標はワールド空間、時刻は秒単位で、
 * direction はノズルから着弾点へ向かうベクトル、visibleDistance はその可視距離を表す。
 */
export interface WaterFlowInput {
  readonly direction: readonly [number, number, number];
  readonly nozzleOrigin: readonly [number, number, number];
  readonly splashElapsedSeconds: number;
  readonly sprayActive: boolean;
  readonly sprayElapsedSeconds: number;
  readonly targeted: boolean;
  readonly visibleDistance: number;
}

/**
 * 固定slotへ割り当てる水粒の描画変換。position はワールド座標、scale は無次元倍率、
 * slot はstream 0〜23またはsplash 24〜31、color は青または白の粒色を表す。
 */
export interface WaterInstanceTransform {
  readonly active: boolean;
  readonly color: 'blue' | 'white';
  readonly kind: 'stream' | 'splash';
  readonly position: readonly [number, number, number];
  readonly scale: number;
  readonly slot: number;
}

/** 固定32slotのstreamとsplashを、その時点の描画transformへ変換した結果。 */
export interface WaterFlowFrame {
  readonly instances: readonly WaterInstanceTransform[];
}

const SPLASH_DIRECTIONS = [
  [-0.8, 0.8, -0.2], [-0.45, 1, 0.25], [0, 1.15, -0.35], [0.5, 0.9, 0.15],
  [0.85, 0.7, -0.15], [-0.65, 0.55, 0.5], [0.25, 0.65, 0.65], [0.7, 0.5, 0.45],
] as const;

/** 固定slotのstreamとtarget着弾飛沫を、指定時刻の決定的なtransformへ変換する。 */
export function createWaterFlowFrame(input: WaterFlowInput): WaterFlowFrame {
  const directionLength = Math.hypot(...input.direction) || 1;
  const direction = input.direction.map((value) => value / directionLength) as [number, number, number];
  const end = input.nozzleOrigin.map(
    (value, axis) => value + direction[axis] * input.visibleDistance,
  ) as [number, number, number];
  const instances: WaterInstanceTransform[] = [];

  for (let slot = 0; slot < WATER_STREAM_COUNT; slot += 1) {
    const localTime = input.sprayElapsedSeconds - slot * STREAM_EMISSION_INTERVAL_SECONDS;
    const active = input.sprayActive && localTime >= 0;
    const age = active ? (localTime % STREAM_PERIOD_SECONDS) / STREAM_PERIOD_SECONDS : 0;
    const arc = -0.24 * age * age + Math.sin((age + slot * 0.13) * Math.PI * 2) * 0.035;
    instances.push({
      active,
      color: slot % 3 === 2 ? 'white' : 'blue',
      kind: 'stream',
      position: [
        input.nozzleOrigin[0] + direction[0] * input.visibleDistance * age,
        input.nozzleOrigin[1] + direction[1] * input.visibleDistance * age + arc,
        input.nozzleOrigin[2] + direction[2] * input.visibleDistance * age,
      ],
      scale: active ? 0.12 + Math.sin(Math.PI * age) * 0.09 : 0,
      slot,
    });
  }

  for (let splashSlot = 0; splashSlot < WATER_SPLASH_COUNT; splashSlot += 1) {
    const slot = WATER_STREAM_COUNT + splashSlot;
    const age = Math.min(1, Math.max(0, input.splashElapsedSeconds / SPLASH_LIFETIME_SECONDS));
    const active = input.sprayActive && input.targeted && age > 0 && age < 1;
    const spread = SPLASH_DIRECTIONS[splashSlot];
    instances.push({
      active,
      color: splashSlot % 3 === 2 ? 'white' : 'blue',
      kind: 'splash',
      position: [
        end[0] + spread[0] * age * 0.65,
        end[1] + spread[1] * age * 0.65 - age * age * 0.22,
        end[2] + spread[2] * age * 0.65,
      ],
      scale: active ? 0.18 * (1 - age) : 0,
      slot,
    });
  }

  return { instances };
}

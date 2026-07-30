export const WATER_STREAM_COUNT = 24;
export const WATER_SPLASH_COUNT = 8;
export const WATER_INSTANCE_COUNT = WATER_STREAM_COUNT + WATER_SPLASH_COUNT;
const STREAM_EMISSION_INTERVAL_SECONDS = 0.032;
const STREAM_PERIOD_SECONDS = 1.15;
const SPLASH_LIFETIME_SECONDS = 0.22;
const TARGET_STOP_OFFSET = 0.55;
const UNTARGETED_VISIBLE_DISTANCE = 6;

/** 描画とtext telemetryが共有するquadratic Bézier放水経路。 */
export interface WaterFlowPath {
  readonly controlX: number;
  readonly controlY: number;
  readonly controlZ: number;
  readonly endX: number;
  readonly endY: number;
  readonly endZ: number;
  readonly startX: number;
  readonly startY: number;
  readonly startZ: number;
}

/** 放水経路を作るpure helperの入力。 */
export interface WaterFlowPathInput {
  readonly initialDirection: readonly [number, number, number];
  readonly nozzleOrigin: readonly [number, number, number];
  readonly targetPosition: readonly [number, number, number];
  readonly targeted: boolean;
}

/**
 * 水流フレーム計算の入力。座標はワールド空間、時刻は秒単位で、
 * path は描画とtext telemetryで共有する同一の放水経路を表す。
 */
export interface WaterFlowInput {
  readonly path: WaterFlowPath;
  readonly splashElapsedSeconds: number;
  readonly sprayActive: boolean;
  readonly sprayElapsedSeconds: number;
  readonly targeted: boolean;
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

/** 45/55補正を初期接線に保ち、対象時だけ炎中心の0.55unit手前へ曲線で収束させる。 */
export function createWaterFlowPath(input: WaterFlowPathInput): WaterFlowPath {
  const directionLength = Math.hypot(...input.initialDirection) || 1;
  const directionX = input.initialDirection[0] / directionLength;
  const directionY = input.initialDirection[1] / directionLength;
  const directionZ = input.initialDirection[2] / directionLength;
  const startX = input.nozzleOrigin[0];
  const startY = input.nozzleOrigin[1];
  const startZ = input.nozzleOrigin[2];

  if (!input.targeted) {
    return {
      controlX: startX + directionX * UNTARGETED_VISIBLE_DISTANCE / 2,
      controlY: startY + directionY * UNTARGETED_VISIBLE_DISTANCE / 2,
      controlZ: startZ + directionZ * UNTARGETED_VISIBLE_DISTANCE / 2,
      endX: startX + directionX * UNTARGETED_VISIBLE_DISTANCE,
      endY: startY + directionY * UNTARGETED_VISIBLE_DISTANCE,
      endZ: startZ + directionZ * UNTARGETED_VISIBLE_DISTANCE,
      startX,
      startY,
      startZ,
    };
  }

  const targetDeltaX = input.targetPosition[0] - startX;
  const targetDeltaY = input.targetPosition[1] - startY;
  const targetDeltaZ = input.targetPosition[2] - startZ;
  const targetDistance = Math.hypot(targetDeltaX, targetDeltaY, targetDeltaZ);
  const endpointDistance = Math.max(0, targetDistance - TARGET_STOP_OFFSET);
  const endpointRatio = targetDistance > 0 ? endpointDistance / targetDistance : 0;

  return {
    controlX: startX + directionX * endpointDistance / 2,
    controlY: startY + directionY * endpointDistance / 2,
    controlZ: startZ + directionZ * endpointDistance / 2,
    endX: startX + targetDeltaX * endpointRatio,
    endY: startY + targetDeltaY * endpointRatio,
    endZ: startZ + targetDeltaZ * endpointRatio,
    startX,
    startY,
    startZ,
  };
}

/** 固定slotのstreamとtarget着弾飛沫を、指定時刻の決定的なtransformへ変換する。 */
export function createWaterFlowFrame(input: WaterFlowInput): WaterFlowFrame {
  const instances: WaterInstanceTransform[] = [];

  for (let slot = 0; slot < WATER_STREAM_COUNT; slot += 1) {
    const localTime = input.sprayElapsedSeconds - slot * STREAM_EMISSION_INTERVAL_SECONDS;
    const active = input.sprayActive && localTime >= 0;
    const age = active ? (localTime % STREAM_PERIOD_SECONDS) / STREAM_PERIOD_SECONDS : 0;
    const arc = -0.24 * age * age + Math.sin((age + slot * 0.13) * Math.PI * 2) * 0.035;
    const inverse = 1 - age;
    const startWeight = inverse * inverse;
    const controlWeight = 2 * inverse * age;
    const endWeight = age * age;
    instances.push({
      active,
      color: slot % 3 === 2 ? 'white' : 'blue',
      kind: 'stream',
      position: [
        startWeight * input.path.startX
          + controlWeight * input.path.controlX
          + endWeight * input.path.endX,
        startWeight * input.path.startY
          + controlWeight * input.path.controlY
          + endWeight * input.path.endY
          + arc,
        startWeight * input.path.startZ
          + controlWeight * input.path.controlZ
          + endWeight * input.path.endZ,
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
        input.path.endX + spread[0] * age * 0.65,
        input.path.endY + spread[1] * age * 0.65 - age * age * 0.22,
        input.path.endZ + spread[2] * age * 0.65,
      ],
      scale: active ? 0.18 * (1 - age) : 0,
      slot,
    });
  }

  return { instances };
}

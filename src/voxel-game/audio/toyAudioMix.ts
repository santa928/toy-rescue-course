import type { VehicleId } from '../domain/vehicleDefinitions';

/** 5車種のprimary actionを聴覚で区別する固定識別子。 */
export type ToyAudioActionKind = 'water' | 'blade' | 'bucket' | 'care' | 'siren';

/** 1 audio frameを決定するframework非依存の入力。 */
export interface ToyAudioMixInput {
  readonly actionAttackAgeSeconds?: number;
  readonly actionPressed: boolean;
  readonly elapsedSeconds: number;
  readonly enabled: boolean;
  readonly primaryAction: boolean;
  readonly speed: number;
  readonly targetActionActive: boolean;
  readonly vehicleId: VehicleId;
}

/** 固定Web Audio graphへ適用するscalarだけのmix frame。 */
export interface ToyAudioMixFrame {
  readonly actionAttackFrequency: number;
  readonly actionAttackGain: number;
  readonly actionFrequencyA: number;
  readonly actionFrequencyB: number;
  readonly actionGainA: number;
  readonly actionGainB: number;
  readonly actionKind: ToyAudioActionKind;
  readonly bgmFrequency: number;
  readonly bgmGain: number;
  readonly bgmStep: number;
  readonly engineFrequency: number;
  readonly engineGain: number;
  readonly noiseGain: number;
  readonly targetActionGain: number;
}

const MAX_VEHICLE_SPEED = 7.4;
const BGM_STEP_SECONDS = 0.42;
const BGM_MELODY = [0, 2, 1, 3, 4, 3, 1, 2] as const;
const PENTATONIC_FREQUENCIES = [261.63, 293.66, 329.63, 392, 440] as const;

const ACTION_KIND_BY_VEHICLE: Readonly<Record<VehicleId, ToyAudioActionKind>> = {
  ambulance: 'care',
  bulldozer: 'blade',
  excavator: 'bucket',
  'fire-truck': 'water',
  police: 'siren',
};

const ENGINE_BASE_FREQUENCY: Readonly<Record<VehicleId, number>> = {
  ambulance: 96,
  bulldozer: 72,
  excavator: 78,
  'fire-truck': 88,
  police: 104,
};

const ACTION_ATTACK_FREQUENCY: Readonly<Record<VehicleId, number>> = {
  ambulance: 523.25,
  bulldozer: 74,
  excavator: 196,
  'fire-truck': 880,
  police: 622.25,
};

const ACTION_ATTACK_GAIN: Readonly<Record<VehicleId, number>> = {
  ambulance: 0.025,
  bulldozer: 0.032,
  excavator: 0.028,
  'fire-truck': 0.018,
  police: 0.026,
};

const TARGET_ACTION_GAIN: Readonly<Record<VehicleId, number>> = {
  ambulance: 0.01,
  bulldozer: 0.012,
  excavator: 0.012,
  'fire-truck': 0.006,
  police: 0.012,
};

const ACTION_ATTACK_DURATION_SECONDS = 0.14;

/** scene refから音へ渡す対象作用の最小scalar入力。 */
export interface ToyTargetActionInput {
  readonly actionTargetHoldMilliseconds: ArrayLike<number>;
  readonly bulldozerActiveChipCount: number;
  readonly primaryAction: boolean;
  readonly vehicleId: VehicleId;
}

/** 選択車種と主操作中の実target telemetryだけから対象作用を判定する。 */
export function deriveToyTargetActionActive(input: ToyTargetActionInput): boolean {
  if (!input.primaryAction || input.vehicleId === 'fire-truck') return false;
  if (input.vehicleId === 'bulldozer') {
    return Number.isFinite(input.bulldozerActiveChipCount)
      && input.bulldozerActiveChipCount > 0;
  }
  for (let index = 0; index < input.actionTargetHoldMilliseconds.length; index += 1) {
    const milliseconds = input.actionTargetHoldMilliseconds[index];
    if (Number.isFinite(milliseconds) && milliseconds > 0) return true;
  }
  return false;
}

/** 非有限値をfallbackへ戻し、指定範囲内へ収める。 */
function clampFinite(value: number, minimum: number, maximum: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

/** 車種と時刻からprimary action用の周波数・gainを返す。 */
function createActionMix(
  actionKind: ToyAudioActionKind,
  elapsedSeconds: number,
  active: boolean,
): Pick<
  ToyAudioMixFrame,
  'actionFrequencyA' | 'actionFrequencyB' | 'actionGainA' | 'actionGainB' | 'noiseGain'
> {
  if (!active) {
    return {
      actionFrequencyA: 180,
      actionFrequencyB: 240,
      actionGainA: 0,
      actionGainB: 0,
      noiseGain: 0,
    };
  }

  if (actionKind === 'water') {
    const pulse = 0.5 + 0.5 * Math.sin(elapsedSeconds * Math.PI * 8);
    return {
      actionFrequencyA: 680 + pulse * 120,
      actionFrequencyB: 1_020,
      actionGainA: 0.012 + pulse * 0.008,
      actionGainB: 0.006,
      noiseGain: 0.042,
    };
  }

  if (actionKind === 'blade') {
    const pulse = 0.5 + 0.5 * Math.sin(elapsedSeconds * Math.PI * 6);
    return {
      actionFrequencyA: 92 + pulse * 18,
      actionFrequencyB: 138,
      actionGainA: 0.028 + pulse * 0.012,
      actionGainB: 0.012,
      noiseGain: 0.004,
    };
  }

  if (actionKind === 'bucket') {
    const alternate = Math.floor(elapsedSeconds / 0.22) % 2;
    return {
      actionFrequencyA: alternate === 0 ? 164 : 218,
      actionFrequencyB: alternate === 0 ? 246 : 196,
      actionGainA: alternate === 0 ? 0.046 : 0.022,
      actionGainB: alternate === 0 ? 0.012 : 0.036,
      noiseGain: 0.006,
    };
  }

  if (actionKind === 'care') {
    const alternate = Math.floor(elapsedSeconds / 0.34) % 2;
    return {
      actionFrequencyA: alternate === 0 ? 523.25 : 659.25,
      actionFrequencyB: alternate === 0 ? 659.25 : 783.99,
      actionGainA: 0.032,
      actionGainB: 0.014,
      noiseGain: 0,
    };
  }

  const redBlueStep = Math.floor(elapsedSeconds / 0.28) % 2;
  return {
    actionFrequencyA: redBlueStep === 0 ? 622.25 : 830.61,
    actionFrequencyB: redBlueStep === 0 ? 783.99 : 659.25,
    actionGainA: 0.044,
    actionGainB: 0.018,
    noiseGain: 0,
  };
}

/** 時刻、車種、速度、primary actionから決定的な玩具音mixを返す。 */
export function createToyAudioMixFrame(input: ToyAudioMixInput): ToyAudioMixFrame {
  const elapsedSeconds = clampFinite(input.elapsedSeconds, 0, Number.MAX_SAFE_INTEGER, 0);
  const speed = clampFinite(input.speed, 0, MAX_VEHICLE_SPEED, 0);
  const speedRatio = speed / MAX_VEHICLE_SPEED;
  const bgmStep = Math.floor(elapsedSeconds / BGM_STEP_SECONDS) % BGM_MELODY.length;
  const noteIndex = BGM_MELODY[bgmStep] ?? 0;
  const stepProgress = (elapsedSeconds % BGM_STEP_SECONDS) / BGM_STEP_SECONDS;
  const actionKind = ACTION_KIND_BY_VEHICLE[input.vehicleId];
  const enabled = input.enabled;
  const action = createActionMix(actionKind, elapsedSeconds, enabled && input.primaryAction);
  const engineBase = ENGINE_BASE_FREQUENCY[input.vehicleId];
  const attackAge = clampFinite(
    input.actionAttackAgeSeconds ?? 0,
    0,
    ACTION_ATTACK_DURATION_SECONDS,
    0,
  );
  const attackEnvelope = input.actionPressed
    ? (1 - attackAge / ACTION_ATTACK_DURATION_SECONDS) ** 2
    : 0;

  return {
    ...action,
    actionAttackFrequency: ACTION_ATTACK_FREQUENCY[input.vehicleId],
    actionAttackGain: enabled ? ACTION_ATTACK_GAIN[input.vehicleId] * attackEnvelope : 0,
    actionKind,
    bgmFrequency: PENTATONIC_FREQUENCIES[noteIndex] ?? PENTATONIC_FREQUENCIES[0],
    bgmGain: enabled ? 0.012 + ((1 - stepProgress) ** 2) * 0.02 : 0,
    bgmStep,
    engineFrequency: engineBase + speedRatio * 118,
    engineGain: enabled ? 0.006 + speedRatio * 0.026 : 0,
    noiseGain: enabled ? action.noiseGain : 0,
    actionGainA: enabled ? action.actionGainA : 0,
    actionGainB: enabled ? action.actionGainB : 0,
    targetActionGain: enabled && input.primaryAction && input.targetActionActive
      ? TARGET_ACTION_GAIN[input.vehicleId]
      : 0,
  };
}

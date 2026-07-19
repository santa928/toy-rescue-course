/** 放水照準の判定と、sceneへ渡す方向ベクトル。 */
export interface SprayTargetResult {
  readonly direction: readonly [number, number, number];
  readonly distance: number;
  readonly targeted: boolean;
}

const SPRAY_RANGE = 6;
const TARGET_DOT_THRESHOLD = 0.67;
const TARGET_ASSIST_RATIO = 0.35;

/** 前方6unit、約48度以内の火へだけ放水方向を35%補正する。 */
export function resolveSprayTarget(
  origin: readonly [number, number, number],
  forward: readonly [number, number, number],
  target: readonly [number, number, number],
): SprayTargetResult {
  const delta = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]] as const;
  const distance = Math.hypot(...delta);
  const normalizedTarget: readonly [number, number, number] = distance > 0
    ? [delta[0] / distance, delta[1] / distance, delta[2] / distance]
    : [0, 0, 0];
  const dot = forward[0] * normalizedTarget[0] + forward[1] * normalizedTarget[1] + forward[2] * normalizedTarget[2];
  const targeted = distance <= SPRAY_RANGE && dot >= TARGET_DOT_THRESHOLD;

  if (!targeted) return { direction: forward, distance, targeted };

  const mixed: readonly [number, number, number] = [
    forward[0] * (1 - TARGET_ASSIST_RATIO) + normalizedTarget[0] * TARGET_ASSIST_RATIO,
    forward[1] * (1 - TARGET_ASSIST_RATIO) + normalizedTarget[1] * TARGET_ASSIST_RATIO,
    forward[2] * (1 - TARGET_ASSIST_RATIO) + normalizedTarget[2] * TARGET_ASSIST_RATIO,
  ];
  const length = Math.hypot(...mixed) || 1;
  return {
    direction: [mixed[0] / length, mixed[1] / length, mixed[2] / length],
    distance,
    targeted,
  };
}

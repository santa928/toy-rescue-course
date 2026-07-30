/** 放水照準の判定と、sceneへ渡す方向ベクトル。 */
export interface SprayTargetResult {
  readonly direction: readonly [number, number, number];
  readonly distance: number;
  readonly targeted: boolean;
}

const SPRAY_HORIZONTAL_RANGE = 7;
const TARGET_HORIZONTAL_DOT_THRESHOLD = 0.5;
const TARGET_ASSIST_RATIO = 0.55;
const SAFE_FORWARD: readonly [number, number, number] = [0, 0, -1];

/** 3要素vectorがすべて有限かを確認する。 */
function isFiniteVector(value: readonly [number, number, number]): boolean {
  return value.every(Number.isFinite);
}

/**
 * 見える炎が水平7unit・前方60度以内なら対象とし、水流方向を炎側へ55%補正する。
 * 判定の距離と角度はXZ平面、返すdistanceとdirectionは3次元で扱う。
 */
export function resolveSprayTarget(
  origin: readonly [number, number, number],
  forward: readonly [number, number, number],
  target: readonly [number, number, number],
): SprayTargetResult {
  const coordinatesAreValid = isFiniteVector(origin) && isFiniteVector(target);
  const distance = coordinatesAreValid
    ? Math.hypot(
      target[0] - origin[0],
      target[1] - origin[1],
      target[2] - origin[2],
    )
    : 0;
  const forwardHorizontalLength = Math.hypot(forward[0], forward[2]);
  const forwardIsValid = isFiniteVector(forward)
    && Number.isFinite(forwardHorizontalLength)
    && forwardHorizontalLength > 0;
  const safeForward = forwardIsValid ? forward : SAFE_FORWARD;
  if (!coordinatesAreValid || !forwardIsValid) {
    return { direction: safeForward, distance, targeted: false };
  }

  const deltaX = target[0] - origin[0];
  const deltaY = target[1] - origin[1];
  const deltaZ = target[2] - origin[2];
  const horizontalDistance = Math.hypot(deltaX, deltaZ);

  if (horizontalDistance === 0) {
    return { direction: safeForward, distance, targeted: false };
  }

  const targetHorizontalX = deltaX / horizontalDistance;
  const targetHorizontalZ = deltaZ / horizontalDistance;
  const forwardHorizontalX = safeForward[0] / forwardHorizontalLength;
  const forwardHorizontalZ = safeForward[2] / forwardHorizontalLength;
  const horizontalDot = (
    forwardHorizontalX * targetHorizontalX
    + forwardHorizontalZ * targetHorizontalZ
  );
  const targeted = (
    horizontalDistance <= SPRAY_HORIZONTAL_RANGE
    && horizontalDot >= TARGET_HORIZONTAL_DOT_THRESHOLD
  );

  if (!targeted) return { direction: safeForward, distance, targeted };

  const targetLength = distance || 1;
  const forwardLength = Math.hypot(...safeForward) || 1;
  const mixedX = safeForward[0] / forwardLength * (1 - TARGET_ASSIST_RATIO)
    + deltaX / targetLength * TARGET_ASSIST_RATIO;
  const mixedY = safeForward[1] / forwardLength * (1 - TARGET_ASSIST_RATIO)
    + deltaY / targetLength * TARGET_ASSIST_RATIO;
  const mixedZ = safeForward[2] / forwardLength * (1 - TARGET_ASSIST_RATIO)
    + deltaZ / targetLength * TARGET_ASSIST_RATIO;
  const mixedLength = Math.hypot(mixedX, mixedY, mixedZ) || 1;

  return {
    direction: [mixedX / mixedLength, mixedY / mixedLength, mixedZ / mixedLength],
    distance,
    targeted,
  };
}

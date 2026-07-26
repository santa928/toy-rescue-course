// breakableVfx.tsの最大合成初速は5未満。observer契約では保守的な上限5を使う。
const MAX_MAIN_FRAGMENT_LAUNCH_SPEED = 5;
const BREAK_FRAGMENT_GRAVITY_MAGNITUDE = 18;
const FIRST_OBSERVED_POSITION_EPSILON = 0.03;
const RAPIER_FIXED_TIME_STEP_SECONDS = 1 / 60;
const SCHEDULER_UNOBSERVED_FIXED_STEP_COUNT = 1;

/**
 * observer遅延にrAF/Rapier間で未観測になり得る1 fixed stepを足した移動上限を返す。
 *
 * @param {number} delayMilliseconds impact telemetryの初観測から6片の初観測までの遅延。
 * @returns {number} 元block AABBから許容する最大overflow。
 */
export function firstObservedPositionAllowance(delayMilliseconds) {
  if (!Number.isFinite(delayMilliseconds) || delayMilliseconds < 0) {
    throw new RangeError(`Activation transition delay is invalid: ${delayMilliseconds}`);
  }
  const observedDelaySeconds = delayMilliseconds / 1_000;
  const schedulerBoundedTravelSeconds = observedDelaySeconds
    + RAPIER_FIXED_TIME_STEP_SECONDS * SCHEDULER_UNOBSERVED_FIXED_STEP_COUNT;
  return MAX_MAIN_FRAGMENT_LAUNCH_SPEED * schedulerBoundedTravelSeconds
    + 0.5 * BREAK_FRAGMENT_GRAVITY_MAGNITUDE * schedulerBoundedTravelSeconds ** 2
    + FIRST_OBSERVED_POSITION_EPSILON;
}

/**
 * first-observed overflowが物理移動上限内かを、artifact用の許容値とともに返す。
 *
 * @param {{ delayMilliseconds: number, maximumOverflow: number }} observation 観測値。
 * @returns {{ accepted: boolean, allowedOverflow: number }} pureな契約判定。
 */
export function evaluateFirstObservedPositionContract({
  delayMilliseconds,
  maximumOverflow,
}) {
  if (!Number.isFinite(maximumOverflow)) {
    throw new RangeError(`First-observed overflow is invalid: ${maximumOverflow}`);
  }
  const allowedOverflow = firstObservedPositionAllowance(delayMilliseconds);
  return {
    accepted: maximumOverflow <= allowedOverflow,
    allowedOverflow,
  };
}

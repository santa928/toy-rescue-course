// producerの合成初速<=5はbreakableVfx.test.tsが独立して固定する。
// この位置契約は、最も外へ出たAABB軸へ保守的なscalar envelope 5を適用するだけである。
const CONSERVATIVE_AABB_AXIS_SPEED_ENVELOPE = 5;
const BREAK_FRAGMENT_GRAVITY_MAGNITUDE = 18;
const FIRST_OBSERVED_POSITION_EPSILON = 0.03;
const RAPIER_FIXED_TIME_STEP_SECONDS = 1 / 60;
const SCHEDULER_UNOBSERVED_FIXED_STEP_COUNT = 1;

/**
 * observer遅延に未観測になり得る1 fixed stepを足した、保守AABB軸overflow envelopeを返す。
 *
 * このscalar envelopeから実際のfixed-step数や3次元合成速度を逆算することはできない。
 *
 * @param {number} delayMilliseconds impact telemetryの初観測から6片の初観測までの遅延。
 * @returns {number} 元block AABBから許容する最大の単一軸overflow。
 */
export function conservativeFirstObservedAxisOverflowAllowance(delayMilliseconds) {
  if (!Number.isFinite(delayMilliseconds) || delayMilliseconds < 0) {
    throw new RangeError(`Activation transition delay is invalid: ${delayMilliseconds}`);
  }
  const observedDelaySeconds = delayMilliseconds / 1_000;
  const schedulerBoundedTravelSeconds = observedDelaySeconds
    + RAPIER_FIXED_TIME_STEP_SECONDS * SCHEDULER_UNOBSERVED_FIXED_STEP_COUNT;
  return CONSERVATIVE_AABB_AXIS_SPEED_ENVELOPE * schedulerBoundedTravelSeconds
    + 0.5 * BREAK_FRAGMENT_GRAVITY_MAGNITUDE * schedulerBoundedTravelSeconds ** 2
    + FIRST_OBSERVED_POSITION_EPSILON;
}

/**
 * first-observed最大AABB軸overflowが保守envelope内かを許容値とともに返す。
 *
 * @param {{ delayMilliseconds: number, maximumOverflow: number }} observation 観測値。
 * @returns {{ accepted: boolean, allowedOverflow: number }} 単一軸overflowのpure契約判定。
 */
export function evaluateConservativeFirstObservedAxisOverflow({
  delayMilliseconds,
  maximumOverflow,
}) {
  if (!Number.isFinite(maximumOverflow)) {
    throw new RangeError(`First-observed overflow is invalid: ${maximumOverflow}`);
  }
  const allowedOverflow = conservativeFirstObservedAxisOverflowAllowance(delayMilliseconds);
  return {
    accepted: maximumOverflow <= allowedOverflow,
    allowedOverflow,
  };
}

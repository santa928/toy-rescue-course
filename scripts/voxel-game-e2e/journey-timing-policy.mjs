import assert from 'node:assert/strict';

export const DISTRICT_JOURNEY_MAX_SECONDS = 35;

/**
 * 地区移動の壁時計を、物理GPUだけ認証可能な性能policyへ変換する。
 * software／unknownでも実測値とthreshold判定は残すが、合否認証には使わない。
 */
export function evaluateJourneyTimingPolicy(durationSeconds, rendererClass) {
  assert(Number.isFinite(durationSeconds) && durationSeconds >= 0,
    'Journey duration must be finite and non-negative.');
  assert(['physical', 'software', 'unknown'].includes(rendererClass),
    `Unsupported renderer class: ${rendererClass}`);
  const thresholdMet = durationSeconds <= DISTRICT_JOURNEY_MAX_SECONDS;
  return {
    certified: rendererClass === 'physical' && thresholdMet,
    rendererClass,
    thresholdMet,
  };
}

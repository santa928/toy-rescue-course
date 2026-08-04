import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateJourneyTimingPolicy } from './journey-timing-policy.mjs';

test('35秒の地区移動はphysical rendererだけを認証対象にする', () => {
  assert.deepEqual(
    evaluateJourneyTimingPolicy(34.9, 'physical'),
    {
      certified: true,
      rendererClass: 'physical',
      thresholdMet: true,
    },
  );
  assert.deepEqual(
    evaluateJourneyTimingPolicy(35.1, 'physical'),
    {
      certified: false,
      rendererClass: 'physical',
      thresholdMet: false,
    },
  );
  assert.deepEqual(
    evaluateJourneyTimingPolicy(50, 'software'),
    {
      certified: false,
      rendererClass: 'software',
      thresholdMet: false,
    },
  );
  assert.deepEqual(
    evaluateJourneyTimingPolicy(20, 'unknown'),
    {
      certified: false,
      rendererClass: 'unknown',
      thresholdMet: true,
    },
  );
});

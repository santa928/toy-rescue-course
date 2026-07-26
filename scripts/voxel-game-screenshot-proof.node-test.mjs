import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  assertHudCaptureReadiness,
  assertHudPixelProof,
  resolveRenderedCssColor,
} from './voxel-game-screenshot-proof.mjs';

const readyControl = {
  backgroundColor: 'rgb(255, 250, 240)',
  borderColor: 'rgb(129, 39, 31)',
  borderWidths: { bottom: 4, left: 4, right: 4, top: 4 },
  box: { bottom: 64, height: 52, left: 506, right: 774, top: 12, width: 268 },
  display: 'flex',
  label: '火のところへいこう',
  opacity: '1',
  visibility: 'visible',
};

const completePixelProof = {
  backgroundMatchRatio: 0.61,
  edgeMatchRatios: { bottom: 0.87, left: 0.91, right: 0.9, top: 0.88 },
};

describe('Voxel Game screenshot pixel proof', () => {
  test('computed brightness filterを保存PNGの最終RGBへ反映する', () => {
    assert.deepEqual(
      resolveRenderedCssColor('rgb(95, 203, 234)', 'brightness(1.06)'),
      [101, 215, 248],
    );
  });

  test('非空label・可視style・viewport内boxが揃ったHUDだけをcapture可能にする', () => {
    assert.doesNotThrow(() => assertHudCaptureReadiness(
      { controls: { mission: readyControl }, stableSamples: 2 },
      { height: 720, width: 1_280 },
    ));

    assert.throws(
      () => assertHudCaptureReadiness({
        controls: { mission: { ...readyControl, label: '   ' } },
        stableSamples: 2,
      }, { height: 720, width: 1_280 }),
      /mission label is empty/,
    );
    assert.throws(
      () => assertHudCaptureReadiness({
        controls: { mission: { ...readyControl, visibility: 'hidden' } },
        stableSamples: 2,
      }, { height: 720, width: 1_280 }),
      /mission is not visibly painted/,
    );
  });

  test('背景が残っていても右端だけ欠けたPNGを失敗にする', () => {
    assert.doesNotThrow(() => assertHudPixelProof({
      controls: { mission: completePixelProof },
    }));

    assert.throws(
      () => assertHudPixelProof({
        controls: {
          mission: {
            ...completePixelProof,
            edgeMatchRatios: { ...completePixelProof.edgeMatchRatios, right: 0.02 },
          },
        },
      }),
      /mission right edge is not painted/,
    );
  });
});

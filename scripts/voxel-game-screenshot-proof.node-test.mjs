import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as screenshotProof from './voxel-game-screenshot-proof.mjs';

const {
  assertHudCaptureReadiness,
  assertHudPixelProof,
  resolveRenderedCssColor,
} = screenshotProof;

const readyLabel = {
  backgroundColor: 'rgba(0, 0, 0, 0)',
  box: { bottom: 48, height: 20, left: 548, right: 732, top: 28, width: 184 },
  color: 'rgb(129, 39, 31)',
  display: 'block',
  opacity: '1',
  text: '火のところへいこう',
  visibility: 'visible',
};

const readyControl = {
  backgroundColor: 'rgb(255, 250, 240)',
  borderColor: 'rgb(129, 39, 31)',
  borderWidths: { bottom: 4, left: 4, right: 4, top: 4 },
  box: { bottom: 64, height: 52, left: 506, right: 774, top: 12, width: 268 },
  display: 'flex',
  filter: 'none',
  label: readyLabel.text,
  labelStyle: readyLabel,
  opacity: '1',
  visibility: 'visible',
};

const completePixelProof = {
  backgroundMatchRatio: 0.61,
  edgeMatchRatios: { bottom: 0.87, left: 0.91, right: 0.9, top: 0.88 },
  label: {
    distinctFromBackgroundRatio: 0.18,
    foregroundMatchRatio: 0.12,
  },
};

describe('Voxel Game screenshot pixel proof', () => {
  test('computed brightness filterを保存PNGの最終RGBへ反映する', () => {
    assert.deepEqual(
      resolveRenderedCssColor('rgb(95, 203, 234)', 'brightness(1.06)'),
      [101, 215, 248],
    );
  });

  test('label自身の可視style・contrast・親内包が揃ったHUDだけをcapture可能にする', () => {
    assert.doesNotThrow(() => assertHudCaptureReadiness(
      { controls: { mission: readyControl }, stableSamples: 2 },
      { height: 720, width: 1_280 },
    ));

    assert.throws(
      () => assertHudCaptureReadiness({
        controls: {
          mission: {
            ...readyControl,
            labelStyle: { ...readyLabel, opacity: '0' },
          },
        },
        stableSamples: 2,
      }, { height: 720, width: 1_280 }),
      /mission label is not visibly painted/,
    );
    assert.throws(
      () => assertHudCaptureReadiness({
        controls: {
          mission: {
            ...readyControl,
            labelStyle: {
              ...readyLabel,
              backgroundColor: readyLabel.color,
            },
          },
        },
        stableSamples: 2,
      }, { height: 720, width: 1_280 }),
      /mission label contrast is insufficient/,
    );
    assert.throws(
      () => assertHudCaptureReadiness({
        controls: {
          mission: {
            ...readyControl,
            labelStyle: {
              ...readyLabel,
              box: { ...readyLabel.box, left: 480, right: 800, width: 320 },
            },
          },
        },
        stableSamples: 2,
      }, { height: 720, width: 1_280 }),
      /mission label exceeds its control/,
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

  test('親背景と四辺が残っていてもlabel画素が消えたPNGを失敗にする', () => {
    assert.throws(
      () => assertHudPixelProof({
        controls: {
          mission: {
            ...completePixelProof,
            label: {
              distinctFromBackgroundRatio: 0,
              foregroundMatchRatio: 0,
            },
          },
        },
      }),
      /mission label text is not painted/,
    );
  });

  test('小さいlabelは前景近似が少なくても十分な背景差文字画素を受理する', () => {
    assert.doesNotThrow(() => assertHudPixelProof({
      controls: {
        fullscreen: {
          ...completePixelProof,
          label: {
            distinctFromBackgroundRatio: 0.44,
            foregroundMatchRatio: 0.036,
          },
        },
      },
    }));
  });

  test('label bbox内のforegroundと背景差画素を実bufferから数える', () => {
    assert.equal(
      typeof screenshotProof.analyzeHudLabelPixels,
      'function',
      'analyzeHudLabelPixels must be exported',
    );
    const background = [255, 250, 240];
    const foreground = [129, 39, 31];
    const pixels = new Uint8ClampedArray(10 * 10 * 4);
    for (let index = 0; index < 100; index += 1) {
      const offset = index * 4;
      const color = index < 16 ? foreground : background;
      [pixels[offset], pixels[offset + 1], pixels[offset + 2]] = color;
      pixels[offset + 3] = 255;
    }

    assert.deepEqual(
      screenshotProof.analyzeHudLabelPixels(
        pixels,
        10,
        10,
        foreground,
        background,
      ),
      {
        distinctFromBackgroundRatio: 0.16,
        foregroundMatchRatio: 0.16,
        height: 10,
        width: 10,
      },
    );
  });
});

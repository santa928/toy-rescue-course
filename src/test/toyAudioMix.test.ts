import { describe, expect, it } from 'vitest';
import { VEHICLE_DEFINITIONS } from '../voxel-game/domain/vehicleDefinitions';
import {
  createToyAudioMixFrame,
  type ToyAudioMixFrame,
} from '../voxel-game/audio/toyAudioMix';

/** 指定差分だけを上書きした標準mix入力を返す。 */
function createFrame(
  overrides: Partial<Parameters<typeof createToyAudioMixFrame>[0]> = {},
): ToyAudioMixFrame {
  return createToyAudioMixFrame({
    elapsedSeconds: 0,
    enabled: true,
    primaryAction: false,
    speed: 0,
    vehicleId: 'fire-truck',
    ...overrides,
  });
}

describe('createToyAudioMixFrame', () => {
  it('無効時は全channelのgainを0にする', () => {
    expect(createFrame({
      elapsedSeconds: 1.2,
      enabled: false,
      primaryAction: true,
      speed: 7.4,
      vehicleId: 'police',
    })).toMatchObject({
      actionGainA: 0,
      actionGainB: 0,
      bgmGain: 0,
      engineGain: 0,
      noiseGain: 0,
    });
  });

  it('0.42秒ごとに五音音階を進め、8stepで同じ先頭音へ戻る', () => {
    const first = createFrame({ elapsedSeconds: 0 });
    const second = createFrame({ elapsedSeconds: 0.42 });
    const looped = createFrame({ elapsedSeconds: 0.42 * 8 });

    expect(second.bgmStep).toBe(1);
    expect(second.bgmFrequency).not.toBe(first.bgmFrequency);
    expect(looped.bgmStep).toBe(0);
    expect(looped.bgmFrequency).toBe(first.bgmFrequency);
    expect(first.bgmGain).toBeGreaterThan(0);
  });

  it('速度を0〜7.4へ正規化し、走行時だけengineを強く高くする', () => {
    const idle = createFrame({ speed: 0 });
    const moving = createFrame({ speed: 7.4 });
    const overflow = createFrame({ speed: Number.POSITIVE_INFINITY });
    const negative = createFrame({ speed: -4 });

    expect(moving.engineGain).toBeGreaterThan(idle.engineGain);
    expect(moving.engineFrequency).toBeGreaterThan(idle.engineFrequency);
    expect(overflow.engineGain).toBe(idle.engineGain);
    expect(negative.engineFrequency).toBe(idle.engineFrequency);
  });

  it.each([
    ['fire-truck', 'water'],
    ['bulldozer', 'blade'],
    ['excavator', 'bucket'],
    ['ambulance', 'care'],
    ['police', 'siren'],
  ] as const)('%sのprimary actionを%s音へ割り当てる', (vehicleId, actionKind) => {
    const inactive = createFrame({ primaryAction: false, vehicleId });
    const active = createFrame({ primaryAction: true, vehicleId });

    expect(active.actionKind).toBe(actionKind);
    expect(active.actionGainA + active.actionGainB + active.noiseGain).toBeGreaterThan(0);
    expect(inactive.actionGainA + inactive.actionGainB + inactive.noiseGain).toBe(0);
  });

  it('パトカーの赤青2音を0.28秒ごとに交互へする', () => {
    const red = createFrame({ elapsedSeconds: 0, primaryAction: true, vehicleId: 'police' });
    const blue = createFrame({ elapsedSeconds: 0.28, primaryAction: true, vehicleId: 'police' });

    expect(red.actionFrequencyA).not.toBe(blue.actionFrequencyA);
    expect(red.actionGainA).toBeGreaterThan(0);
    expect(blue.actionGainA).toBeGreaterThan(0);
  });

  it('全車種・不正時刻でも有限かつ小音量のscalarだけを返す', () => {
    for (const { id } of VEHICLE_DEFINITIONS) {
      const frame = createFrame({
        elapsedSeconds: Number.NaN,
        primaryAction: true,
        speed: Number.NaN,
        vehicleId: id,
      });
      for (const value of Object.values(frame)) {
        if (typeof value !== 'number') continue;
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(Math.max(
        frame.actionGainA,
        frame.actionGainB,
        frame.bgmGain,
        frame.engineGain,
        frame.noiseGain,
      )).toBeLessThanOrEqual(0.08);
    }
  });
});

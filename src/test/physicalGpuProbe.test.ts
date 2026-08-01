import { describe, expect, it } from 'vitest';
import {
  createFramePerformanceSampler,
  isPhysicalGpuProbeEnabled,
} from '../voxel-game/performance/physicalGpuProbe';

/** 一定間隔のframe timestampをsamplerへ与え、最初の完了結果を返す。 */
function sampleAtFixedInterval(
  frameIntervalMilliseconds: number,
  warmupMilliseconds: number,
  sampleMilliseconds: number,
) {
  const sampler = createFramePerformanceSampler({
    sampleMilliseconds,
    warmupMilliseconds,
  });
  let result = null;
  for (
    let timestamp = 0;
    result === null && timestamp <= warmupMilliseconds + sampleMilliseconds + 100;
    timestamp += frameIntervalMilliseconds
  ) {
    result = sampler.record(timestamp);
  }
  return result;
}

describe('physical GPU frame sampler', () => {
  it('60fpsの12秒相当からmedian、p10、meanを返す', () => {
    const result = sampleAtFixedInterval(1_000 / 60, 2_000, 12_000);

    expect(result).not.toBeNull();
    expect(result?.durationMilliseconds).toBeGreaterThanOrEqual(12_000);
    expect(result?.frameCount).toBeGreaterThanOrEqual(719);
    expect(result?.meanFps).toBeCloseTo(60, 5);
    expect(result?.medianFps).toBeCloseTo(60, 5);
    expect(result?.p10Fps).toBeCloseTo(60, 5);
  });

  it('遅いframeをp10へ反映し、重複timestampは無視する', () => {
    const sampler = createFramePerformanceSampler({
      sampleMilliseconds: 100,
      warmupMilliseconds: 0,
    });
    const timestamps = [0, 10, 10, 20, 40, 50, 70, 80, 90, 100];
    const result = timestamps.reduce(
      (current, timestamp) => current ?? sampler.record(timestamp),
      null as ReturnType<typeof sampler.record>,
    );

    expect(result).not.toBeNull();
    expect(result?.frameCount).toBe(8);
    expect(result?.medianFps).toBe(100);
    expect(result?.p10Fps).toBe(50);
  });

  it('gpu-cert query parameterが明示されたときだけ有効になる', () => {
    expect(isPhysicalGpuProbeEnabled('?gpu-cert=task8')).toBe(true);
    expect(isPhysicalGpuProbeEnabled('?gpu-cert=')).toBe(false);
    expect(isPhysicalGpuProbeEnabled('?verify=1')).toBe(false);
  });
});

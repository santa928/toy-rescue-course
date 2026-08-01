/** 物理GPU認証で公開するframe分布の集計値。 */
export interface FramePerformanceSample {
  readonly durationMilliseconds: number;
  readonly frameCount: number;
  readonly meanFps: number;
  readonly medianFps: number;
  readonly p10Fps: number;
}

/** warm-upと本計測の長さをmillisecondsで指定する。 */
export interface FramePerformanceSamplerOptions {
  readonly sampleMilliseconds: number;
  readonly warmupMilliseconds: number;
}

/** timestampを1件ずつ受け取り、計測完了後だけ集計値を返すsampler。 */
export interface FramePerformanceSampler {
  readonly record: (timestampMilliseconds: number) => FramePerformanceSample | null;
}

export const PHYSICAL_GPU_SAMPLE_MILLISECONDS = 12_000;
export const PHYSICAL_GPU_WARMUP_MILLISECONDS = 2_000;

/** 昇順数列からnearest-rank寄りの決定的なquantileを返す。 */
function readQuantile(sortedValues: readonly number[], fraction: number): number {
  const index = Math.max(
    0,
    Math.min(sortedValues.length - 1, Math.floor((sortedValues.length - 1) * fraction)),
  );
  return sortedValues[index] ?? 0;
}

/** rAF timestampからwarm-upを除いたmedian、p10、mean fpsを1回だけ集計する。 */
export function createFramePerformanceSampler({
  sampleMilliseconds,
  warmupMilliseconds,
}: FramePerformanceSamplerOptions): FramePerformanceSampler {
  if (!Number.isFinite(warmupMilliseconds) || warmupMilliseconds < 0) {
    throw new Error('warmupMilliseconds must be a finite non-negative number');
  }
  if (!Number.isFinite(sampleMilliseconds) || sampleMilliseconds <= 0) {
    throw new Error('sampleMilliseconds must be a finite positive number');
  }

  let completedSample: FramePerformanceSample | null = null;
  let previousTimestamp: number | null = null;
  let sampleStartedAt: number | null = null;
  let warmupStartedAt: number | null = null;
  const frameIntervals: number[] = [];

  return {
    record(timestampMilliseconds: number): FramePerformanceSample | null {
      if (completedSample !== null) return completedSample;
      if (!Number.isFinite(timestampMilliseconds)) return null;

      warmupStartedAt ??= timestampMilliseconds;
      if (timestampMilliseconds - warmupStartedAt < warmupMilliseconds) return null;

      if (sampleStartedAt === null) {
        sampleStartedAt = timestampMilliseconds;
        previousTimestamp = timestampMilliseconds;
        return null;
      }
      if (previousTimestamp !== null && timestampMilliseconds <= previousTimestamp) return null;

      frameIntervals.push(timestampMilliseconds - (previousTimestamp ?? timestampMilliseconds));
      previousTimestamp = timestampMilliseconds;
      const durationMilliseconds = timestampMilliseconds - sampleStartedAt;
      if (durationMilliseconds < sampleMilliseconds) return null;

      const frameFps = frameIntervals
        .map((interval) => 1_000 / interval)
        .sort((left, right) => left - right);
      completedSample = {
        durationMilliseconds,
        frameCount: frameIntervals.length,
        meanFps: frameIntervals.length / durationMilliseconds * 1_000,
        medianFps: readQuantile(frameFps, 0.5),
        p10Fps: readQuantile(frameFps, 0.1),
      };
      return completedSample;
    },
  };
}

/** 空でないgpu-cert query valueが明示された場合だけ実機probeを有効にする。 */
export function isPhysicalGpuProbeEnabled(search: string): boolean {
  return (new URLSearchParams(search).get('gpu-cert') ?? '').trim().length > 0;
}

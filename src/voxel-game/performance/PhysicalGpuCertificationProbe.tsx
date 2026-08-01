import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { VoxelGameRenderTelemetryRef } from '../scene/VoxelGameScene';
import {
  createFramePerformanceSampler,
  PHYSICAL_GPU_SAMPLE_MILLISECONDS,
  PHYSICAL_GPU_WARMUP_MILLISECONDS,
  type FramePerformanceSample,
} from './physicalGpuProbe';

/** hidden DOMへ1回だけ出力する物理GPU認証結果。 */
export type PhysicalGpuProbeResult = FramePerformanceSample & {
  readonly measuredAt: string;
  readonly renderedFrames: number;
  readonly rendererCalls: number;
  readonly rendererName: string;
  readonly rendererVendor: string;
  readonly vehicleDrawCalls: number;
};

interface PhysicalGpuProbeProps {
  readonly enabled: boolean;
  readonly renderTelemetryRef: VoxelGameRenderTelemetryRef;
}

/** opt-in時だけrAFを12秒集計し、隔離browserから読めるhidden outputへ結果を公開する。 */
export function PhysicalGpuProbe({
  enabled,
  renderTelemetryRef,
}: PhysicalGpuProbeProps): ReactElement | null {
  const [result, setResult] = useState<PhysicalGpuProbeResult | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const sampler = createFramePerformanceSampler({
      sampleMilliseconds: PHYSICAL_GPU_SAMPLE_MILLISECONDS,
      warmupMilliseconds: PHYSICAL_GPU_WARMUP_MILLISECONDS,
    });
    let animationFrameId = 0;
    let cancelled = false;

    /** main worldのrAF timestampを集計し、完了時だけReactへ通知する。 */
    const recordFrame = (timestampMilliseconds: number): void => {
      if (cancelled) return;
      const sample = sampler.record(timestampMilliseconds);
      if (sample !== null) {
        setResult({
          ...sample,
          ...renderTelemetryRef.current,
          measuredAt: new Date().toISOString(),
        });
        return;
      }
      animationFrameId = window.requestAnimationFrame(recordFrame);
    };

    animationFrameId = window.requestAnimationFrame(recordFrame);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [enabled, renderTelemetryRef]);

  if (!enabled) return null;
  return (
    <output
      data-result={result === null ? '' : JSON.stringify(result)}
      data-status={result === null ? 'measuring' : 'complete'}
      data-testid="physical-gpu-probe"
      hidden
    />
  );
}

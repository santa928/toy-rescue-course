import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import type { ActionTargetMissionTelemetryRef } from '../scene/ActionTargetMission';

/** 実判定の保持時間だけを0〜1へ変換し、未接触や中断を進捗として見せない。 */
export function resolveActionHoldProgress(holds: ArrayLike<number>, requiredMilliseconds: number): number {
  if (!Number.isFinite(requiredMilliseconds) || requiredMilliseconds <= 0) return 0;
  let longest = 0;
  for (let index = 0; index < holds.length; index += 1) {
    if (Number.isFinite(holds[index])) longest = Math.max(longest, holds[index]);
  }
  return Math.min(1, Math.max(0, longest / requiredMilliseconds));
}

/** 既存scene telemetryから実作業中だけ表示する。独自タイマーや全HUDの再描画は使わない。 */
export function ActionHoldProgress({ telemetryRef, requiredMilliseconds }: {
  readonly telemetryRef: ActionTargetMissionTelemetryRef;
  readonly requiredMilliseconds: number;
}): ReactElement {
  const progressRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    /** 接触・保持が更新された次の描画で、塗りとアクセシブルな値を同期する。 */
    const sync = (): void => {
      const element = progressRef.current;
      if (element) {
        const progress = resolveActionHoldProgress(telemetryRef.current.holdMilliseconds, requiredMilliseconds);
        element.dataset.active = String(progress > 0);
        element.style.setProperty('--hold-progress', String(progress));
        element.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
      }
      frame = requestAnimationFrame(sync);
    };
    frame = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(frame);
  }, [requiredMilliseconds, telemetryRef]);
  return (
    <span className="action-hold-progress" data-active="false" role="progressbar"
      aria-label="おしごとのすすみぐあい" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} ref={progressRef}>
      <span aria-hidden="true" className="action-hold-progress__fill" />
    </span>
  );
}

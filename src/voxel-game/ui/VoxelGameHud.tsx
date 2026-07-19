import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type { MissionPhase } from '../domain/VoxelGameRuntime';
import type { VoxelGameControls } from '../input/useVoxelGameControls';
import { TouchJoystick } from './TouchJoystick';

interface VoxelGameHudProps {
  readonly controls: VoxelGameControls;
  readonly fullscreen: boolean;
  readonly fullscreenAvailable: boolean;
  readonly missionPhase: MissionPhase;
  readonly onToggleFullscreen: () => void;
}

/** mission phaseと幼児向けの短い仕事文言を固定対応する。 */
export const MISSION_LABELS: Readonly<Record<MissionPhase, string>> = {
  active: 'おみずをかけよう',
  assigned: '火のところへいこう',
  celebrating: 'できた！',
  freeRoam: 'じゆうにあそぼう',
};

/** 仕事、運転、放水、fullscreenをsafe-areaへ固定する玩具操作HUD。 */
export function VoxelGameHud({
  controls,
  fullscreen,
  fullscreenAvailable,
  missionPhase,
  onToggleFullscreen,
}: VoxelGameHudProps): ReactElement {
  const activeSprayPointerRef = useRef<number | null>(null);
  const sprayButtonRef = useRef<HTMLButtonElement>(null);
  const { sprayPressed } = controls;
  const { setSpray } = controls;

  /** active spray pointerとHUD同期済みcommandを一括解除する。 */
  const releaseSpray = useCallback((releaseCapture = true): void => {
    const pointerId = activeSprayPointerRef.current;
    activeSprayPointerRef.current = null;
    setSpray(false);
    const button = sprayButtonRef.current;
    if (!releaseCapture || pointerId === null || !button?.hasPointerCapture(pointerId)) return;
    try {
      button.releasePointerCapture(pointerId);
    } catch {
      // browserがcaptureを先に失っていてもcommand/aria解除は上で完了している。
    }
  }, [setSpray]);

  /** 最初のpointerだけをcaptureし、HUD同期済み放水commandを押下へする。 */
  const handleSprayPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (activeSprayPointerRef.current !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    activeSprayPointerRef.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // capture非対応時もpointer終端とblur cleanupで解除する。
    }
    setSpray(true);
  }, [setSpray]);

  /** active spray pointerのup/cancelだけを終了する。 */
  const handleSprayPointerEnd = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (activeSprayPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    releaseSpray(true);
  }, [releaseSpray]);

  /** pointer capture喪失でもcommandとariaを解除する。 */
  const handleSprayLostPointerCapture = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (activeSprayPointerRef.current !== event.pointerId) return;
    releaseSpray(false);
  }, [releaseSpray]);

  useEffect(() => {
    /** blur/hiddenでlocal pressed stateもcontrolsと同時に解除する。 */
    const releaseOnBlur = (): void => releaseSpray(true);
    const releaseOnVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') releaseSpray(true);
    };
    window.addEventListener('blur', releaseOnBlur);
    document.addEventListener('visibilitychange', releaseOnVisibilityChange);
    return () => {
      window.removeEventListener('blur', releaseOnBlur);
      document.removeEventListener('visibilitychange', releaseOnVisibilityChange);
      releaseSpray(true);
    };
  }, [releaseSpray]);

  const fullscreenLabel = !fullscreenAvailable
    ? '全画面は使えません'
    : fullscreen
      ? '全画面をおわる'
      : '全画面であそぶ';

  return (
    <aside aria-label="消防車の操作パネル" className="voxel-game-hud">
      <p aria-live="polite" className="mission-pill" data-phase={missionPhase}>
        <span aria-hidden="true" className="mission-pill__fire">
          <span />
          <span />
          <span />
        </span>
        <span className="mission-pill__label">{MISSION_LABELS[missionPhase]}</span>
      </p>
      <button
        aria-label={fullscreenLabel}
        aria-pressed={fullscreen}
        className="fullscreen-button"
        disabled={!fullscreenAvailable}
        onClick={onToggleFullscreen}
        type="button"
      >
        <span aria-hidden="true" className="fullscreen-button__glyph" />
        <span>{fullscreenAvailable ? (fullscreen ? 'もどる' : '全画面') : '全画面なし'}</span>
      </button>
      <TouchJoystick controls={controls} />
      <button
        aria-label="水を出す"
        aria-pressed={sprayPressed}
        className="spray-button"
        data-pressed={sprayPressed}
        onLostPointerCapture={handleSprayLostPointerCapture}
        onPointerCancel={handleSprayPointerEnd}
        onPointerDown={handleSprayPointerDown}
        onPointerUp={handleSprayPointerEnd}
        ref={sprayButtonRef}
        type="button"
      >
        <span aria-hidden="true" className="spray-button__glyph">
          <span />
          <span />
          <span />
        </span>
        <span className="spray-button__label">みず</span>
      </button>
    </aside>
  );
}

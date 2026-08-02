import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type { VoxelGameControls } from '../input/useVoxelGameControls';
import { resolveSwipePointer } from './touchPointerMath';
import type { SwipeOrigin } from './touchPointerMath';

interface FullscreenDrivePadProps {
  readonly controls: VoxelGameControls;
}

/** 既存の玩具レバーを待機中の左下位置へ戻す。 */
function resetPadPosition(pad: HTMLDivElement): void {
  pad.style.removeProperty('bottom');
  pad.style.removeProperty('left');
  pad.style.removeProperty('top');
  pad.style.removeProperty('transform');
}

/** 画面の任意位置から始めた単一pointerを浮動スティック入力へ変換する。 */
export function FullscreenDrivePad({ controls }: FullscreenDrivePadProps): ReactElement {
  const activePointerRef = useRef<number | null>(null);
  const originRef = useRef<SwipeOrigin | null>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const { setTouchStick } = controls;

  /** thumbを正規化済みstick位置へ移し、React renderを発生させない。 */
  const moveThumb = useCallback((x: number, y: number): void => {
    const pad = padRef.current;
    const thumb = thumbRef.current;
    if (!pad || !thumb) return;
    const travel = Math.max(0, (Math.min(pad.clientWidth, pad.clientHeight) - thumb.offsetWidth) / 2 - 8);
    thumb.style.transform = `translate(-50%, -50%) translate(${x * travel}px, ${y * travel}px)`;
  }, []);

  /** pointer座標を開始点からのstick commandとthumbへ同時反映する。 */
  const applyPointer = useCallback((clientX: number, clientY: number): void => {
    const origin = originRef.current;
    const pad = padRef.current;
    if (!origin || !pad) return;
    const maximumDistance = Math.min(pad.clientWidth, pad.clientHeight) / 2;
    const point = resolveSwipePointer(origin, clientX, clientY, maximumDistance);
    setTouchStick(point.x, point.y);
    moveThumb(point.x, point.y);
  }, [moveThumb, setTouchStick]);

  /** active pointerを解除し、command、thumb、浮動位置を全終了経路で初期化する。 */
  const releaseActivePointer = useCallback((releaseCapture = true): void => {
    const pointerId = activePointerRef.current;
    activePointerRef.current = null;
    originRef.current = null;
    const pad = padRef.current;
    const surface = surfaceRef.current;
    if (pad) {
      pad.dataset.active = 'false';
      resetPadPosition(pad);
    }
    if (surface) surface.dataset.active = 'false';
    setTouchStick(0, 0);
    moveThumb(0, 0);
    if (!releaseCapture || pointerId === null || !surface?.hasPointerCapture(pointerId)) return;
    try {
      surface.releasePointerCapture(pointerId);
    } catch {
      // captureはbrowser側で既に失われる場合があるため、停止状態だけを保証する。
    }
  }, [moveThumb, setTouchStick]);

  /** 最初のpointerをcaptureし、触れた画面位置へ玩具レバーを移す。 */
  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (
      activePointerRef.current !== null
      || (event.pointerType === 'mouse' && event.button !== 0)
      || !Number.isFinite(event.clientX)
      || !Number.isFinite(event.clientY)
    ) return;
    event.preventDefault();
    const origin = { x: event.clientX, y: event.clientY };
    activePointerRef.current = event.pointerId;
    originRef.current = origin;
    const pad = padRef.current;
    if (pad) {
      pad.dataset.active = 'true';
      pad.style.bottom = 'auto';
      pad.style.left = `${origin.x}px`;
      pad.style.top = `${origin.y}px`;
      pad.style.transform = 'translate(-50%, -50%)';
    }
    event.currentTarget.dataset.active = 'true';
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // capture非対応でもup/cancel/blur cleanupで解除する。
    }
    applyPointer(origin.x, origin.y);
  }, [applyPointer]);

  /** active pointerだけを開始点から追従させる。 */
  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    applyPointer(event.clientX, event.clientY);
  }, [applyPointer]);

  /** pointerup/cancelだけをcapture解除付きで終了する。 */
  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    releaseActivePointer(true);
  }, [releaseActivePointer]);

  /** browserがcaptureを失った場合もstickを停止する。 */
  const handleLostPointerCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (activePointerRef.current !== event.pointerId) return;
    releaseActivePointer(false);
  }, [releaseActivePointer]);

  useEffect(() => {
    /** focusまたはhidden時に見た目とcommandを同時解除する。 */
    const handleBlur = (): void => releaseActivePointer(true);
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') releaseActivePointer(true);
    };
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseActivePointer(true);
    };
  }, [releaseActivePointer]);

  return (
    <div
      className="touch-drive-surface"
      data-active="false"
      onLostPointerCapture={handleLostPointerCapture}
      onPointerCancel={handlePointerEnd}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      ref={surfaceRef}
    >
      <div
        aria-label="画面をスライドして運転"
        className="touch-joystick"
        data-active="false"
        ref={padRef}
      >
        <span aria-hidden="true" className="touch-joystick__track" />
        <span aria-hidden="true" className="touch-joystick__thumb" ref={thumbRef} />
        <span aria-hidden="true" className="touch-joystick__label">どこでも</span>
      </div>
    </div>
  );
}

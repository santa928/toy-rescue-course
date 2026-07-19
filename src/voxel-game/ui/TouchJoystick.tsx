import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type { VoxelGameControls } from '../input/useVoxelGameControls';
import { resolveJoystickPointer } from './touchPointerMath';

interface TouchJoystickProps {
  readonly controls: VoxelGameControls;
}

/** 単一pointerを車両stickへ変換し、thumbだけをDOM refで高頻度更新する。 */
export function TouchJoystick({ controls }: TouchJoystickProps): ReactElement {
  const activePointerRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const { setTouchStick } = controls;

  /** thumbを正規化済みstick位置へ移し、React renderを発生させない。 */
  const moveThumb = useCallback((x: number, y: number): void => {
    const root = rootRef.current;
    const thumb = thumbRef.current;
    if (!root || !thumb) return;
    const travel = Math.max(0, (Math.min(root.clientWidth, root.clientHeight) - thumb.offsetWidth) / 2 - 8);
    thumb.style.transform = `translate(-50%, -50%) translate(${x * travel}px, ${y * travel}px)`;
  }, []);

  /** pointer座標をstick commandとthumbへ同時反映する。 */
  const applyPointer = useCallback((clientX: number, clientY: number): void => {
    const root = rootRef.current;
    if (!root) return;
    const point = resolveJoystickPointer(root.getBoundingClientRect(), clientX, clientY);
    setTouchStick(point.x, point.y);
    moveThumb(point.x, point.y);
  }, [moveThumb, setTouchStick]);

  /** active pointerを解除し、全終了経路でstickとthumbを中央へ戻す。 */
  const releaseActivePointer = useCallback((releaseCapture = true): void => {
    const pointerId = activePointerRef.current;
    activePointerRef.current = null;
    const root = rootRef.current;
    if (root) root.dataset.active = 'false';
    setTouchStick(0, 0);
    moveThumb(0, 0);
    if (!releaseCapture || pointerId === null || !root?.hasPointerCapture(pointerId)) return;
    try {
      root.releasePointerCapture(pointerId);
    } catch {
      // captureはbrowser側で既に失われる場合があるため、中央復帰だけを保証する。
    }
  }, [moveThumb, setTouchStick]);

  /** 最初のpointerだけをcaptureしてstick操作を開始する。 */
  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (activePointerRef.current !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    activePointerRef.current = event.pointerId;
    event.currentTarget.dataset.active = 'true';
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // capture非対応でもup/cancel/blur cleanupで解除する。
    }
    applyPointer(event.clientX, event.clientY);
  }, [applyPointer]);

  /** active pointerだけを追従させる。 */
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

  /** browserがcaptureを失った場合もstickを中央へ戻す。 */
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
      aria-label="運転スティック"
      className="touch-joystick"
      data-active="false"
      onLostPointerCapture={handleLostPointerCapture}
      onPointerCancel={handlePointerEnd}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      ref={rootRef}
    >
      <span aria-hidden="true" className="touch-joystick__track" />
      <span aria-hidden="true" className="touch-joystick__thumb" ref={thumbRef} />
      <span aria-hidden="true" className="touch-joystick__label">うんてん</span>
    </div>
  );
}

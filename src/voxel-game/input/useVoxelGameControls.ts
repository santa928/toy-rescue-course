import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import {
  createControlState,
  setDigitalAction,
  setTouchStick as applyTouchStick,
  toDriveCommand,
} from './controlState';
import type { DigitalAction, DriveCommand } from './controlState';

/** ゲームUIとsceneが共有する、描画を起こさない入力制御API。 */
export interface VoxelGameControls {
  readonly commandRef: RefObject<DriveCommand>;
  readonly reset: () => void;
  readonly setSpray: (pressed: boolean) => void;
  readonly setTouchStick: (x: number, y: number) => void;
}

const KEY_ACTIONS: Readonly<Record<string, DigitalAction>> = {
  ArrowDown: 'backward',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'forward',
  KeyA: 'left',
  KeyD: 'right',
  KeyS: 'backward',
  KeyW: 'forward',
  Space: 'spray',
};

/** キーボードとタッチ操作をdevice非依存のcommand refとして公開する。 */
export function useVoxelGameControls(): VoxelGameControls {
  const stateRef = useRef(createControlState());
  const commandRef = useRef<DriveCommand>(toDriveCommand(stateRef.current));

  /** 状態と外部公開commandを同時に更新する。 */
  const commit = useCallback((nextState: ReturnType<typeof createControlState>) => {
    stateRef.current = nextState;
    commandRef.current = toDriveCommand(nextState);
  }, []);

  /** すべての入力を解除して、フォーカス喪失後も車両が動かないようにする。 */
  const reset = useCallback(() => {
    commit(createControlState());
  }, [commit]);

  /** 指定した離散操作の押下状態を更新する。 */
  const setAction = useCallback((action: DigitalAction, pressed: boolean) => {
    commit(setDigitalAction(stateRef.current, action, pressed));
  }, [commit]);

  /** タッチスティック位置を正規化して更新する。 */
  const setTouchStick = useCallback((x: number, y: number) => {
    commit(applyTouchStick(stateRef.current, x, y));
  }, [commit]);

  /** 放水ボタンの押下状態を更新する。 */
  const setSpray = useCallback((pressed: boolean) => {
    setAction('spray', pressed);
  }, [setAction]);

  useEffect(() => {
    /** 対応キーの押下を制御状態へ反映する。 */
    const handleKeyDown = (event: KeyboardEvent): void => {
      const action = KEY_ACTIONS[event.code];
      if (!action) return;
      event.preventDefault();
      setAction(action, true);
    };
    /** 対応キーの解放を制御状態へ反映する。 */
    const handleKeyUp = (event: KeyboardEvent): void => {
      const action = KEY_ACTIONS[event.code];
      if (!action) return;
      event.preventDefault();
      setAction(action, false);
    };
    /** タブが隠れた時点で押下状態を安全に解除する。 */
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') reset();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      reset();
    };
  }, [reset, setAction]);

  return useMemo(() => ({ commandRef, reset, setSpray, setTouchStick }), [reset, setSpray, setTouchStick]);
}

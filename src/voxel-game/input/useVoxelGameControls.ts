import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  /** HUDのaria/見た目へ同期する放水の現在状態。 */
  readonly sprayPressed: boolean;
}

/** browser APIに依存せずevent listenerを登録できる最小のtarget契約。 */
export interface VoxelGameControlEventTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/** 入力eventをcommand更新へ接続するために注入する依存群。 */
export interface VoxelGameControlEventBindings {
  readonly getVisibilityState: () => DocumentVisibilityState;
  readonly keyboardTarget: VoxelGameControlEventTarget;
  readonly onAction: (action: DigitalAction, pressed: boolean) => void;
  readonly onReset: () => void;
  readonly visibilityTarget: VoxelGameControlEventTarget;
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

/**
 * keyboardとvisibilityのeventを入力callbackへ束ね、解除時に必ずresetする。
 * browser実体を注入するため、DOMなしのtestでもlistener lifecycleを検証できる。
 */
export function bindVoxelGameControlEvents({
  getVisibilityState,
  keyboardTarget,
  onAction,
  onReset,
  visibilityTarget,
}: VoxelGameControlEventBindings): () => void {
  /** 対応キーの押下を制御状態へ反映する。 */
  const handleKeyDown = (event: Event): void => {
    const keyboardEvent = event as KeyboardEvent;
    const action = KEY_ACTIONS[keyboardEvent.code];
    if (!action) return;
    keyboardEvent.preventDefault();
    onAction(action, true);
  };
  /** 対応キーの解放を制御状態へ反映する。 */
  const handleKeyUp = (event: Event): void => {
    const keyboardEvent = event as KeyboardEvent;
    const action = KEY_ACTIONS[keyboardEvent.code];
    if (!action) return;
    keyboardEvent.preventDefault();
    onAction(action, false);
  };
  /** タブが隠れた時点で押下状態を安全に解除する。 */
  const handleVisibilityChange = (): void => {
    if (getVisibilityState() === 'hidden') onReset();
  };

  keyboardTarget.addEventListener('keydown', handleKeyDown);
  keyboardTarget.addEventListener('keyup', handleKeyUp);
  keyboardTarget.addEventListener('blur', onReset);
  visibilityTarget.addEventListener('visibilitychange', handleVisibilityChange);
  return () => {
    keyboardTarget.removeEventListener('keydown', handleKeyDown);
    keyboardTarget.removeEventListener('keyup', handleKeyUp);
    keyboardTarget.removeEventListener('blur', onReset);
    visibilityTarget.removeEventListener('visibilitychange', handleVisibilityChange);
    onReset();
  };
}

/** キーボードとタッチ操作をdevice非依存のcommand refとして公開する。 */
export function useVoxelGameControls(): VoxelGameControls {
  const stateRef = useRef(createControlState());
  const commandRef = useRef<DriveCommand>(toDriveCommand(stateRef.current));
  const [sprayPressed, setSprayPressed] = useState(commandRef.current.spray);

  /** 状態と外部公開commandを更新し、放水変化だけHUD再描画へ通知する。 */
  const commit = useCallback((nextState: ReturnType<typeof createControlState>) => {
    const previousSpray = commandRef.current.spray;
    stateRef.current = nextState;
    commandRef.current = toDriveCommand(nextState);
    if (previousSpray !== commandRef.current.spray) setSprayPressed(commandRef.current.spray);
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
    return bindVoxelGameControlEvents({
      getVisibilityState: () => document.visibilityState,
      keyboardTarget: window,
      onAction: setAction,
      onReset: reset,
      visibilityTarget: document,
    });
  }, [reset, setAction]);

  return useMemo(() => ({ commandRef, reset, setSpray, setTouchStick, sprayPressed }), [reset, setSpray, setTouchStick, sprayPressed]);
}

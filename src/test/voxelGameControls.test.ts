import { describe, expect, it } from 'vitest';
import { createControlState, setDigitalAction, setTouchStick, toDriveCommand } from '../voxel-game/input/controlState';
import { bindVoxelGameControlEvents } from '../voxel-game/input/useVoxelGameControls';

type Listener = (event: Event) => void;

/** DOMなしでlistenerの登録・解除と発火を検証する最小のEventTarget代替。 */
class FakeEventTarget {
  private readonly listeners = new Map<string, Set<Listener>>();

  /** 指定eventのlistenerを登録する。 */
  public addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  /** 指定eventのlistenerを解除する。 */
  public removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** 登録済みlistenerへテスト用eventを配送する。 */
  public dispatch(type: string, event: Event = {} as Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe('voxel game controls', () => {
  it('W+Aを画面上・左の長さ1のcommandへ正規化する', () => {
    let state = createControlState();
    state = setDigitalAction(state, 'forward', true);
    state = setDigitalAction(state, 'left', true);

    const command = toDriveCommand(state);
    expect(command).toEqual({ moveX: -Math.SQRT1_2, moveY: Math.SQRT1_2, primaryAction: false });
    expect(Math.hypot(command.moveX, command.moveY)).toBeCloseTo(1, 9);
    expect(command).not.toHaveProperty('steer');
    expect(command).not.toHaveProperty('throttle');
  });

  it.each([
    ['left', -1, 0],
    ['right', 1, 0],
    ['forward', 0, 1],
    ['backward', 0, -1],
  ] as const)('%sを対応する画面方向へ変換する', (action, moveX, moveY) => {
    const state = setDigitalAction(createControlState(), action, true);
    expect(toDriveCommand(state)).toEqual({ moveX, moveY, primaryAction: false });
  });

  it('touch stickをkeyboardより優先し、DOM上方向をmoveY正へ変換する', () => {
    const state = setTouchStick(createControlState(), 0.8, -0.6);
    expect(toDriveCommand(state)).toEqual({ moveX: 0.8, moveY: 0.6, primaryAction: false });
    expect(toDriveCommand(setTouchStick(state, 0.05, 0.05)))
      .toEqual({ moveX: 0, moveY: 0, primaryAction: false });
  });

  it('非有限touch値を停止commandへ正規化する', () => {
    const state = setTouchStick(createControlState(), Number.NaN, Number.POSITIVE_INFINITY);
    expect(toDriveCommand(state)).toEqual({ moveX: 0, moveY: 0, primaryAction: false });
  });

  it('touch stickを半径1へ収めて斜め最高速度を増やさない', () => {
    const command = toDriveCommand(setTouchStick(createControlState(), 2, -3));
    expect(command.moveX).toBeCloseTo(Math.SQRT1_2, 9);
    expect(command.moveY).toBeCloseTo(Math.SQRT1_2, 9);
    expect(Math.hypot(command.moveX, command.moveY)).toBeCloseTo(1, 9);
  });

  it('touch stickを中央へ解除した後はkeyboard入力へ戻る', () => {
    let state = setDigitalAction(createControlState(), 'forward', true);
    state = setTouchStick(state, 0.8, -0.6);
    state = setTouchStick(state, 0, 0);

    expect(toDriveCommand(state)).toEqual({ moveX: 0, moveY: 1, primaryAction: false });
  });

  it('keyboard、blur、hidden visibilityをcommand callbackへ反映する', () => {
    const keyboardTarget = new FakeEventTarget();
    const visibilityTarget = new FakeEventTarget();
    const actions: Array<readonly [string, boolean]> = [];
    let resets = 0;
    let visibilityState: DocumentVisibilityState = 'visible';
    bindVoxelGameControlEvents({
      getVisibilityState: () => visibilityState,
      keyboardTarget,
      onAction: (action, pressed) => actions.push([action, pressed]),
      onReset: () => { resets += 1; },
      visibilityTarget,
    });

    keyboardTarget.dispatch('keydown', { code: 'KeyW', preventDefault: () => undefined } as unknown as Event);
    keyboardTarget.dispatch('keyup', { code: 'KeyW', preventDefault: () => undefined } as unknown as Event);
    keyboardTarget.dispatch('keydown', { code: 'Space', preventDefault: () => undefined } as unknown as Event);
    keyboardTarget.dispatch('blur');
    visibilityState = 'hidden';
    visibilityTarget.dispatch('visibilitychange');

    expect(actions).toEqual([['forward', true], ['forward', false], ['primaryAction', true]]);
    expect(resets).toBe(2);
  });

  it('cleanup時にresetし、その後はeventへ反応しない', () => {
    const keyboardTarget = new FakeEventTarget();
    const visibilityTarget = new FakeEventTarget();
    const actions: Array<readonly [string, boolean]> = [];
    let resets = 0;
    const cleanup = bindVoxelGameControlEvents({
      getVisibilityState: () => 'hidden',
      keyboardTarget,
      onAction: (action, pressed) => actions.push([action, pressed]),
      onReset: () => { resets += 1; },
      visibilityTarget,
    });

    cleanup();
    keyboardTarget.dispatch('keydown', { code: 'ArrowUp', preventDefault: () => undefined } as unknown as Event);
    keyboardTarget.dispatch('blur');
    visibilityTarget.dispatch('visibilitychange');

    expect(actions).toEqual([]);
    expect(resets).toBe(1);
  });
});

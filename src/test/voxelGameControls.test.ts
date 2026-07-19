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
  it('前後と左右を-1から1へ正規化する', () => {
    let state = createControlState();
    state = setDigitalAction(state, 'forward', true);
    state = setDigitalAction(state, 'left', true);

    expect(toDriveCommand(state)).toEqual({ spray: false, steer: -1, throttle: 1 });
  });

  it('touch stickをkeyboardより優先し、dead zone内を0にする', () => {
    const state = setTouchStick(createControlState(), 0.8, -0.6);

    expect(toDriveCommand(state)).toEqual({ spray: false, steer: 0.8, throttle: 0.6 });
    expect(toDriveCommand(setTouchStick(state, 0.05, 0.05))).toEqual({ spray: false, steer: 0, throttle: 0 });
  });

  it('touch stickを入力可能な範囲へclampする', () => {
    const state = setTouchStick(createControlState(), 2, -3);

    expect(toDriveCommand(state)).toEqual({ spray: false, steer: 1, throttle: 1 });
  });

  it('touch stickを中央へ解除した後はkeyboard入力へ戻る', () => {
    let state = setDigitalAction(createControlState(), 'forward', true);
    state = setTouchStick(state, 0.8, -0.6);
    state = setTouchStick(state, 0, 0);

    expect(toDriveCommand(state)).toEqual({ spray: false, steer: 0, throttle: 1 });
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

    expect(actions).toEqual([['forward', true], ['forward', false], ['spray', true]]);
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

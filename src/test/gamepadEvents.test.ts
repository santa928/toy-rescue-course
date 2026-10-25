import { describe, expect, it, vi } from 'vitest';
import { bindGamepadEvents } from '../voxel-game/input/gamepadEvents';
import type { GamepadFrame } from '../voxel-game/input/gamepadControls';

/** RAFとブラウザeventを同期的に進める入力境界用fixture。 */
function fixture() {
  const windowTarget = new EventTarget();
  const documentTarget = new EventTarget();
  let nextFrame: FrameRequestCallback | undefined;
  let active = true;
  let buttons: number[] = [];
  let connected = true;
  let fail = false;
  let resetListener: () => void = () => undefined;
  const states: GamepadFrame[] = [];
  const reset = vi.fn(() => resetListener());
  const select = vi.fn();
  const dispose = bindGamepadEvents({
    keyboardTarget: windowTarget,
    visibilityTarget: documentTarget,
    isActive: () => active,
    readGamepads: () => {
      if (fail) throw new Error('denied');
      return connected ? [{ id: 'fake', index: 0, mapping: 'standard', connected: true, axes: [0, 0],
        buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: buttons.includes(index), value: Number(buttons.includes(index)) })),
      } as unknown as Gamepad] : [];
    },
    getContext: () => ({ canSwitchVehicle: true, selectedVehicleId: 'fire-truck' }),
    requestFrame: (callback) => { nextFrame = callback; return 1; },
    cancelFrame: () => { nextFrame = undefined; },
    onFrame: (state) => states.push(state),
    onReset: reset,
    onSelectVehicle: select,
    subscribeReset: (callback) => { resetListener = callback; return () => { resetListener = () => undefined; }; },
  });
  return {
    windowTarget, documentTarget, states, reset, select, dispose,
    frame: () => { const callback = nextFrame; nextFrame = undefined; callback?.(0); },
    setActive: (value: boolean) => { active = value; },
    setButtons: (value: number[]) => { buttons = value; },
    disconnect: () => { connected = false; },
    deny: () => { fail = true; },
    pending: () => nextFrame !== undefined,
    last: () => states.at(-1)!,
  };
}

describe('gamepad browser lifecycle', () => {
  it('blurでRAFと全入力を停止し、focus復帰後も押下を離すまで待つ', () => {
    const f = fixture();
    f.frame(); f.setButtons([0]); f.frame();
    expect(f.last().command.primaryAction).toBe(true);
    f.setActive(false); f.windowTarget.dispatchEvent(new Event('blur'));
    expect(f.last().command.primaryAction).toBe(false);
    expect(f.pending()).toBe(false);
    f.setActive(true); f.windowTarget.dispatchEvent(new Event('focus')); f.frame();
    expect(f.last().command.primaryAction).toBe(false);
    f.setButtons([]); f.frame(); f.setButtons([0]); f.frame();
    expect(f.last().command.primaryAction).toBe(true);
    f.dispose();
  });

  it('hiddenとpagehideで即停止し、visible/pageshowから安全に再開できる', () => {
    const f = fixture();
    f.frame(); f.setButtons([0]); f.frame();
    f.setActive(false); f.documentTarget.dispatchEvent(new Event('visibilitychange'));
    expect(f.last().command.primaryAction).toBe(false);
    expect(f.reset).toHaveBeenCalledOnce();
    f.setActive(true); f.documentTarget.dispatchEvent(new Event('visibilitychange')); f.frame();
    expect(f.last().status).toBe('release');
    f.windowTarget.dispatchEvent(new Event('pagehide'));
    expect(f.pending()).toBe(false);
    f.windowTarget.dispatchEvent(new Event('pageshow')); f.setButtons([]); f.frame();
    expect(f.last().status).toBe('ready');
    f.dispose();
  });

  it('切断eventだけでも即座に全入力をresetする', () => {
    const f = fixture();
    f.frame(); f.setButtons([0]); f.frame(); f.disconnect();
    f.windowTarget.dispatchEvent(new Event('gamepaddisconnected'));
    expect(f.last().command.primaryAction).toBe(false);
    expect(f.reset).toHaveBeenCalledOnce();
    f.frame();
    expect(f.last().status).toBe('disconnected');
    f.dispose();
  });

  it('API例外でも全入力を停止し、errorをUI状態へ変換する', () => {
    const f = fixture();
    f.frame(); f.setButtons([0]); f.frame(); f.deny(); f.frame();
    expect(f.last().status).toBe('unavailable');
    expect(f.last().command.primaryAction).toBe(false);
    expect(f.pending()).toBe(false);
    f.dispose();
  });

  it('cleanupでframe/listenerを解除し、再開eventを無視する', () => {
    const f = fixture();
    f.frame(); f.setButtons([0]); f.frame(); f.dispose();
    expect(f.last().command.primaryAction).toBe(false);
    expect(f.pending()).toBe(false);
    const count = f.states.length;
    f.windowTarget.dispatchEvent(new Event('focus'));
    f.windowTarget.dispatchEvent(new Event('gamepaddisconnected'));
    f.documentTarget.dispatchEvent(new Event('visibilitychange'));
    f.frame();
    expect(f.states.length).toBe(count);
  });
});

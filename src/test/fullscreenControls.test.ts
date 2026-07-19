import { describe, expect, it, vi } from 'vitest';
import {
  bindFullscreenControls,
  isFullscreenAvailable,
  toggleFullscreen,
} from '../voxel-game/input/fullscreenControls';

type Listener = (event: Event) => void;

/** DOMなしでfullscreen listener lifecycleを検証するEventTarget代替。 */
class FakeEventTarget {
  private readonly listeners = new Map<string, Set<Listener>>();

  public addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  public removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  public dispatch(type: string, event: Event = {} as Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe('fullscreen controls', () => {
  it('Fの初回keydownだけでfullscreenを要求しrepeatを無視する', async () => {
    const keyboardTarget = new FakeEventTarget();
    const fullscreenTarget = new FakeEventTarget();
    const requestFullscreen = vi.fn(async () => undefined);
    const preventDefault = vi.fn();
    const fullscreenDocument = {
      addEventListener: fullscreenTarget.addEventListener.bind(fullscreenTarget),
      documentElement: { requestFullscreen },
      exitFullscreen: vi.fn(async () => undefined),
      fullscreenElement: null,
      removeEventListener: fullscreenTarget.removeEventListener.bind(fullscreenTarget),
    };
    const cleanup = bindFullscreenControls({
      documentTarget: fullscreenDocument,
      keyboardTarget,
      onFullscreenChange: vi.fn(),
    });

    keyboardTarget.dispatch('keydown', { code: 'KeyF', preventDefault, repeat: false } as unknown as Event);
    keyboardTarget.dispatch('keydown', { code: 'KeyF', preventDefault, repeat: true } as unknown as Event);
    await Promise.resolve();

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('fullscreen中はexitし、request/exit拒否を未処理にしない', async () => {
    const requestFullscreen = vi.fn(async () => { throw new Error('request rejected'); });
    const exitFullscreen = vi.fn(async () => { throw new Error('exit rejected'); });
    const fullscreenDocument = {
      addEventListener: vi.fn(),
      documentElement: { requestFullscreen },
      exitFullscreen,
      fullscreenElement: null as Element | null,
      removeEventListener: vi.fn(),
    };

    await expect(toggleFullscreen(fullscreenDocument)).resolves.toBe(false);
    fullscreenDocument.fullscreenElement = {} as Element;
    await expect(toggleFullscreen(fullscreenDocument)).resolves.toBe(false);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('fullscreenchangeを通知しcleanup後はFにもchangeにも反応しない', async () => {
    const keyboardTarget = new FakeEventTarget();
    const fullscreenTarget = new FakeEventTarget();
    const onFullscreenChange = vi.fn();
    const requestFullscreen = vi.fn(async () => undefined);
    const fullscreenDocument = {
      addEventListener: fullscreenTarget.addEventListener.bind(fullscreenTarget),
      documentElement: { requestFullscreen },
      exitFullscreen: vi.fn(async () => undefined),
      fullscreenElement: null as Element | null,
      removeEventListener: fullscreenTarget.removeEventListener.bind(fullscreenTarget),
    };
    const cleanup = bindFullscreenControls({ documentTarget: fullscreenDocument, keyboardTarget, onFullscreenChange });
    fullscreenDocument.fullscreenElement = {} as Element;
    fullscreenTarget.dispatch('fullscreenchange');
    cleanup();
    fullscreenDocument.fullscreenElement = null;
    fullscreenTarget.dispatch('fullscreenchange');
    keyboardTarget.dispatch('keydown', { code: 'KeyF', preventDefault: vi.fn(), repeat: false } as unknown as Event);
    await Promise.resolve();

    expect(onFullscreenChange).toHaveBeenCalledTimes(1);
    expect(onFullscreenChange).toHaveBeenCalledWith(true);
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it('requestとexitの両APIがある場合だけ操作可能と判定する', () => {
    expect(isFullscreenAvailable({
      addEventListener: vi.fn(),
      documentElement: { requestFullscreen: vi.fn() },
      exitFullscreen: vi.fn(),
      fullscreenElement: null,
      removeEventListener: vi.fn(),
    })).toBe(true);
    expect(isFullscreenAvailable({
      addEventListener: vi.fn(),
      documentElement: {},
      exitFullscreen: vi.fn(),
      fullscreenElement: null,
      removeEventListener: vi.fn(),
    })).toBe(false);
  });
});

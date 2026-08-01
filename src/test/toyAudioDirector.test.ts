import { describe, expect, it, vi } from 'vitest';
import {
  ToyAudioDirector,
  type ToyAudioBackend,
  type ToyAudioContextState,
} from '../voxel-game/audio/ToyAudioDirector';
import type { ToyAudioMixFrame } from '../voxel-game/audio/toyAudioMix';
import type { ToyAudioCue } from '../voxel-game/audio/toyAudioEvents';

class FakeToyAudioBackend implements ToyAudioBackend {
  public readonly frames: ToyAudioMixFrame[] = [];
  public readonly cues: ToyAudioCue[] = [];
  public state: ToyAudioContextState = 'suspended';

  /** 適用されたframeを保存する。 */
  public applyFrame(frame: ToyAudioMixFrame): void {
    this.frames.push(frame);
  }

  /** close済み状態へ移す。 */
  public async close(): Promise<void> {
    this.state = 'closed';
  }

  /** 離散cueを保存する。 */
  public playCue(cue: ToyAudioCue): void {
    this.cues.push(cue);
  }

  /** running状態へ移す。 */
  public async resume(): Promise<void> {
    this.state = 'running';
  }

  /** suspended状態へ移す。 */
  public async suspend(): Promise<void> {
    this.state = 'suspended';
  }
}

/** 標準の毎frame入力を返す。 */
function frameInput() {
  return {
    elapsedSeconds: 1,
    primaryAction: true,
    speed: 3.7,
    vehicleId: 'police' as const,
  };
}

describe('ToyAudioDirector', () => {
  it('ユーザーが有効化するまでbackendを作らない', () => {
    const backendFactory = vi.fn(() => new FakeToyAudioBackend());
    const director = new ToyAudioDirector({ available: true, backendFactory });

    director.update(frameInput());

    expect(backendFactory).not.toHaveBeenCalled();
    expect(director.getTelemetry()).toMatchObject({
      actionKind: 'siren',
      contextState: 'locked',
      enabled: false,
      engineGain: 0,
    });
  });

  it('有効化、frame反映、OFF、再開、closeを同じbackendで行う', async () => {
    const backend = new FakeToyAudioBackend();
    const backendFactory = vi.fn(() => backend);
    const director = new ToyAudioDirector({ available: true, backendFactory });

    await expect(director.setEnabled(true)).resolves.toBe(true);
    director.update(frameInput());
    expect(backend.frames.at(-1)).toMatchObject({ actionKind: 'siren' });
    expect(backend.frames.at(-1)?.actionGainA).toBeGreaterThan(0);
    expect(director.getTelemetry()).toMatchObject({ contextState: 'running', enabled: true });

    await director.setVisible(false);
    expect(director.getTelemetry().contextState).toBe('suspended');
    await director.setVisible(true);
    expect(director.getTelemetry().contextState).toBe('running');
    await director.setEnabled(false);
    expect(director.getTelemetry()).toMatchObject({ contextState: 'suspended', enabled: false });

    await director.dispose();
    expect(backend.state).toBe('closed');
    expect(backendFactory).toHaveBeenCalledTimes(1);
  });

  it('有効中だけcueと対応振動を1回ずつ送る', async () => {
    const backend = new FakeToyAudioBackend();
    const vibrate = vi.fn(() => true);
    const director = new ToyAudioDirector({
      available: true,
      backendFactory: () => backend,
      vibrate,
    });

    director.playCue('target-complete');
    expect(backend.cues).toEqual([]);
    await director.setEnabled(true);
    director.playCue('vehicle-switch');
    director.playCue('target-complete');
    director.playCue('mission-complete');

    expect(backend.cues).toEqual([
      'vehicle-switch',
      'target-complete',
      'mission-complete',
    ]);
    expect(vibrate).toHaveBeenNthCalledWith(1, [22]);
    expect(vibrate).toHaveBeenNthCalledWith(2, [35, 24, 65]);
    expect(director.getTelemetry()).toMatchObject({
      cueCount: 3,
      lastCue: 'mission-complete',
      vibrationCount: 2,
    });
  });

  it('Audio非対応時は安全に無効のままにする', async () => {
    const backendFactory = vi.fn(() => new FakeToyAudioBackend());
    const director = new ToyAudioDirector({ available: false, backendFactory });

    await expect(director.setEnabled(true)).resolves.toBe(false);
    expect(backendFactory).not.toHaveBeenCalled();
    expect(director.getTelemetry()).toMatchObject({
      available: false,
      contextState: 'unavailable',
      enabled: false,
    });
  });
});

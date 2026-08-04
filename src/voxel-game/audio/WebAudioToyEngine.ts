import type {
  ToyAudioBackend,
  ToyAudioContextState,
} from './ToyAudioDirector';
import type { ToyAudioMixFrame } from './toyAudioMix';
import type { ToyAudioCue } from './toyAudioEvents';

interface ToyCueNote {
  readonly durationSeconds: number;
  readonly frequency: number;
  readonly gain: number;
  readonly offsetSeconds: number;
}

const CUE_NOTES: Readonly<Record<ToyAudioCue, readonly ToyCueNote[]>> = {
  'mission-complete': [
    { durationSeconds: 0.14, frequency: 523.25, gain: 0.052, offsetSeconds: 0 },
    { durationSeconds: 0.14, frequency: 659.25, gain: 0.056, offsetSeconds: 0.13 },
    { durationSeconds: 0.22, frequency: 783.99, gain: 0.06, offsetSeconds: 0.26 },
  ],
  'target-complete': [
    { durationSeconds: 0.11, frequency: 659.25, gain: 0.048, offsetSeconds: 0 },
    { durationSeconds: 0.16, frequency: 783.99, gain: 0.052, offsetSeconds: 0.1 },
  ],
  'vehicle-switch': [
    { durationSeconds: 0.09, frequency: 392, gain: 0.035, offsetSeconds: 0 },
    { durationSeconds: 0.12, frequency: 523.25, gain: 0.04, offsetSeconds: 0.08 },
  ],
};

/** AudioParamを有限値だけへ短い時定数で滑らかに追従させる。 */
function setSmoothValue(parameter: AudioParam, value: number, now: number): void {
  if (!Number.isFinite(value)) return;
  parameter.setTargetAtTime(value, now, 0.028);
}

/** 固定source 5本とgain 6本でpure mixを鳴らすbrowser Web Audio実装。 */
export class WebAudioToyEngine implements ToyAudioBackend {
  private readonly actionGainA: GainNode;
  private readonly actionGainB: GainNode;
  private readonly actionOscillatorA: OscillatorNode;
  private readonly actionOscillatorB: OscillatorNode;
  private readonly bgmGain: GainNode;
  private readonly bgmOscillator: OscillatorNode;
  private readonly engineGain: GainNode;
  private readonly engineOscillator: OscillatorNode;
  private readonly masterGain: GainNode;
  private readonly noiseGain: GainNode;
  private readonly noiseSource: AudioBufferSourceNode;
  private lastActionKind: ToyAudioMixFrame['actionKind'] | null = null;

  /** user activation内で受け取ったcontextへ固定graphを1度だけ構築する。 */
  public constructor(private readonly context: AudioContext) {
    this.masterGain = context.createGain();
    this.masterGain.gain.value = 0.68;
    this.masterGain.connect(context.destination);

    this.bgmGain = context.createGain();
    this.engineGain = context.createGain();
    this.actionGainA = context.createGain();
    this.actionGainB = context.createGain();
    this.noiseGain = context.createGain();
    for (const gain of [
      this.bgmGain,
      this.engineGain,
      this.actionGainA,
      this.actionGainB,
      this.noiseGain,
    ]) {
      gain.gain.value = 0;
      gain.connect(this.masterGain);
    }

    this.bgmOscillator = context.createOscillator();
    this.bgmOscillator.type = 'sine';
    this.bgmOscillator.connect(this.bgmGain);
    this.engineOscillator = context.createOscillator();
    this.engineOscillator.type = 'triangle';
    this.engineOscillator.connect(this.engineGain);
    this.actionOscillatorA = context.createOscillator();
    this.actionOscillatorA.type = 'sine';
    this.actionOscillatorA.connect(this.actionGainA);
    this.actionOscillatorB = context.createOscillator();
    this.actionOscillatorB.type = 'triangle';
    this.actionOscillatorB.connect(this.actionGainB);

    const noiseBuffer = context.createBuffer(
      1,
      Math.max(1, Math.floor(context.sampleRate)),
      context.sampleRate,
    );
    const noiseData = noiseBuffer.getChannelData(0);
    let noiseSeed = 0x91e10da5;
    for (let index = 0; index < noiseData.length; index += 1) {
      noiseSeed = (Math.imul(noiseSeed, 1_664_525) + 1_013_904_223) >>> 0;
      noiseData[index] = (noiseSeed / 0xffff_ffff) * 2 - 1;
    }
    this.noiseSource = context.createBufferSource();
    this.noiseSource.buffer = noiseBuffer;
    this.noiseSource.loop = true;
    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 1_800;
    noiseFilter.Q.value = 0.55;
    this.noiseSource.connect(noiseFilter);
    noiseFilter.connect(this.noiseGain);

    const startTime = context.currentTime;
    this.bgmOscillator.start(startTime);
    this.engineOscillator.start(startTime);
    this.actionOscillatorA.start(startTime);
    this.actionOscillatorB.start(startTime);
    this.noiseSource.start(startTime);
  }

  /** 実contextの現在stateをdirector契約へ返す。 */
  public get state(): ToyAudioContextState {
    return this.context.state;
  }

  /** pure scalar frameを固定nodeの周波数・gainへ滑らかに適用する。 */
  public applyFrame(frame: ToyAudioMixFrame): void {
    if (this.context.state === 'closed') return;
    const now = this.context.currentTime;
    if (frame.actionKind !== this.lastActionKind) {
      this.lastActionKind = frame.actionKind;
      this.actionOscillatorA.type = frame.actionKind === 'blade' ? 'sawtooth'
        : frame.actionKind === 'bucket' || frame.actionKind === 'siren' ? 'square'
          : 'sine';
      this.actionOscillatorB.type = frame.actionKind === 'care' || frame.actionKind === 'siren'
        ? 'sine'
        : 'triangle';
    }
    setSmoothValue(this.bgmOscillator.frequency, frame.bgmFrequency, now);
    setSmoothValue(this.engineOscillator.frequency, frame.engineFrequency, now);
    setSmoothValue(
      this.actionOscillatorA.frequency,
      frame.actionAttackGain > 0 ? frame.actionAttackFrequency : frame.actionFrequencyA,
      now,
    );
    setSmoothValue(this.actionOscillatorB.frequency, frame.actionFrequencyB, now);
    setSmoothValue(this.bgmGain.gain, frame.bgmGain, now);
    setSmoothValue(this.engineGain.gain, frame.engineGain, now);
    setSmoothValue(this.actionGainA.gain, frame.actionGainA + frame.actionAttackGain, now);
    setSmoothValue(this.actionGainB.gain, frame.actionGainB + frame.targetActionGain, now);
    setSmoothValue(this.noiseGain.gain, frame.noiseGain, now);
  }

  /** 離散event時だけ短命oscillatorで木琴風の短い音列を予約する。 */
  public playCue(cue: ToyAudioCue): void {
    if (this.context.state !== 'running') return;
    const now = this.context.currentTime;
    for (const note of CUE_NOTES[cue]) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const start = now + note.offsetSeconds;
      const attackEnd = start + Math.min(0.018, note.durationSeconds / 3);
      const end = start + note.durationSeconds;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(note.frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(note.gain, attackEnd);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(gain);
      gain.connect(this.masterGain);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(end + 0.01);
    }
  }

  /** suspended contextをuser activation内で再開する。 */
  public async resume(): Promise<void> {
    if (this.context.state === 'suspended' || this.context.state === 'interrupted') {
      await this.context.resume();
    }
  }

  /** running contextだけを停止し、固定graphは再利用できる状態で保つ。 */
  public async suspend(): Promise<void> {
    if (this.context.state === 'running') await this.context.suspend();
  }

  /** persistent sourceを停止し、contextと全nodeを解放する。 */
  public async close(): Promise<void> {
    if (this.context.state === 'closed') return;
    for (const source of [
      this.bgmOscillator,
      this.engineOscillator,
      this.actionOscillatorA,
      this.actionOscillatorB,
      this.noiseSource,
    ]) {
      try {
        source.stop();
      } catch {
        // sourceが既に停止済みでも残りのgraph解放を継続する。
      }
      source.disconnect();
    }
    await this.context.close();
  }
}

/** AudioContext constructorが存在するbrowserだけを対応扱いにする。 */
export function isBrowserToyAudioAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.AudioContext === 'function';
}

/** user activation内で新しいAudioContextと固定graphを生成する。 */
export function createBrowserToyAudioBackend(): ToyAudioBackend {
  if (!isBrowserToyAudioAvailable()) throw new Error('Web Audio is unavailable.');
  return new WebAudioToyEngine(new window.AudioContext());
}

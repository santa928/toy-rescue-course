import {
  createToyAudioMixFrame,
  type ToyAudioActionKind,
  type ToyAudioMixFrame,
  type ToyAudioMixInput,
} from './toyAudioMix';
import {
  getToyVibrationPattern,
  type ToyAudioCue,
} from './toyAudioEvents';

/** browser audio lifecycleをlocked/unavailable/errorまで含めて公開する状態。 */
export type ToyAudioContextState =
  | 'locked'
  | 'running'
  | 'suspended'
  | 'interrupted'
  | 'closed'
  | 'unavailable'
  | 'error';

/** Web Audio実装とunit fakeが共有する固定graph境界。 */
export interface ToyAudioBackend {
  readonly state: ToyAudioContextState;
  applyFrame(frame: ToyAudioMixFrame): void;
  close(): Promise<void>;
  playCue(cue: ToyAudioCue): void;
  resume(): Promise<void>;
  suspend(): Promise<void>;
}

/** HUDとE2Eへ公開する低頻度状態と最新mix scalar。 */
export interface ToyAudioTelemetry {
  readonly actionGain: number;
  readonly actionKind: ToyAudioActionKind;
  readonly activeVehicleId: ToyAudioMixInput['vehicleId'];
  readonly available: boolean;
  readonly bgmGain: number;
  readonly bgmStep: number;
  readonly contextState: ToyAudioContextState;
  readonly cueCount: number;
  readonly enabled: boolean;
  readonly engineGain: number;
  readonly lastCue: ToyAudioCue | null;
  readonly noiseGain: number;
  readonly vibrationCount: number;
}

/** directorへ注入するbrowser境界と対応可否。 */
export interface ToyAudioDirectorOptions {
  readonly available: boolean;
  readonly backendFactory: () => ToyAudioBackend;
  readonly vibrate?: (pattern: number[]) => boolean;
}

export type ToyAudioFrameInput = Omit<ToyAudioMixInput, 'enabled'>;

const INITIAL_FRAME_INPUT: ToyAudioFrameInput = {
  elapsedSeconds: 0,
  primaryAction: false,
  speed: 0,
  vehicleId: 'fire-truck',
};

/** user activation、固定graph、mission cue、振動をReact外で所有する。 */
export class ToyAudioDirector {
  private backend: ToyAudioBackend | null = null;
  private contextState: ToyAudioContextState;
  private cueCount = 0;
  private enabled = false;
  private lastCue: ToyAudioCue | null = null;
  private lastFrameInput = INITIAL_FRAME_INPUT;
  private lastMix = createToyAudioMixFrame({ ...INITIAL_FRAME_INPUT, enabled: false });
  private vibrationCount = 0;

  /** 対応可否とlazy backend factoryを保存し、AudioContextはまだ生成しない。 */
  public constructor(private readonly options: ToyAudioDirectorOptions) {
    this.contextState = options.available ? 'locked' : 'unavailable';
  }

  /** enabledと最新mixを変更不能telemetryとして返す。 */
  public getTelemetry(): ToyAudioTelemetry {
    return {
      actionGain: this.lastMix.actionGainA + this.lastMix.actionGainB,
      actionKind: this.lastMix.actionKind,
      activeVehicleId: this.lastFrameInput.vehicleId,
      available: this.options.available,
      bgmGain: this.lastMix.bgmGain,
      bgmStep: this.lastMix.bgmStep,
      contextState: this.contextState,
      cueCount: this.cueCount,
      enabled: this.enabled,
      engineGain: this.lastMix.engineGain,
      lastCue: this.lastCue,
      noiseGain: this.lastMix.noiseGain,
      vibrationCount: this.vibrationCount,
    };
  }

  /** user操作に応じて同じbackendをresume/suspendし、成功可否を返す。 */
  public async setEnabled(enabled: boolean): Promise<boolean> {
    if (!enabled) {
      this.enabled = false;
      this.applyCurrentFrame();
      if (this.backend && this.backend.state !== 'closed') {
        try {
          await this.backend.suspend();
          this.contextState = this.backend.state;
        } catch {
          this.contextState = 'error';
        }
      }
      return false;
    }
    if (!this.options.available) return false;

    try {
      this.backend ??= this.options.backendFactory();
      await this.backend.resume();
      this.contextState = this.backend.state;
      this.enabled = this.contextState === 'running';
      this.applyCurrentFrame();
      return this.enabled;
    } catch {
      this.enabled = false;
      this.contextState = 'error';
      return false;
    }
  }

  /** tab可視性に合わせ、有効設定を保ったままgraphだけ停止・再開する。 */
  public async setVisible(visible: boolean): Promise<void> {
    if (!this.enabled || !this.backend || this.backend.state === 'closed') return;
    try {
      if (visible) await this.backend.resume();
      else {
        this.applySilentFrame();
        await this.backend.suspend();
      }
      this.contextState = this.backend.state;
    } catch {
      this.contextState = 'error';
    }
  }

  /** 最新telemetry入力をpure mixへ変換し、生成済みgraphだけへ適用する。 */
  public update(input: ToyAudioFrameInput): void {
    this.lastFrameInput = input;
    this.applyCurrentFrame();
  }

  /** 有効かつrunning中だけ離散cueと対応振動を発火する。 */
  public playCue(cue: ToyAudioCue): void {
    if (!this.enabled || !this.backend || this.contextState !== 'running') return;
    this.backend.playCue(cue);
    this.lastCue = cue;
    this.cueCount += 1;
    const pattern = getToyVibrationPattern(cue);
    if (!pattern || !this.options.vibrate) return;
    try {
      if (this.options.vibrate(pattern)) this.vibrationCount += 1;
    } catch {
      // 端末設定や権限で拒否されても音とゲーム進行は継続する。
    }
  }

  /** 固定graphを閉じ、以後の再生を止める。 */
  public async dispose(): Promise<void> {
    this.enabled = false;
    if (!this.backend) return;
    try {
      this.applySilentFrame();
      await this.backend.close();
      this.contextState = this.backend.state;
    } catch {
      this.contextState = 'error';
    }
  }

  /** enabled状態を反映した最新frameを保存し、backendがあれば適用する。 */
  private applyCurrentFrame(): void {
    this.lastMix = createToyAudioMixFrame({
      ...this.lastFrameInput,
      enabled: this.enabled && this.contextState === 'running',
    });
    if (this.backend && this.backend.state !== 'closed') this.backend.applyFrame(this.lastMix);
  }

  /** 入力は維持してgainだけ0のframeをgraphへ適用する。 */
  private applySilentFrame(): void {
    this.lastMix = createToyAudioMixFrame({ ...this.lastFrameInput, enabled: false });
    if (this.backend && this.backend.state !== 'closed') this.backend.applyFrame(this.lastMix);
  }
}

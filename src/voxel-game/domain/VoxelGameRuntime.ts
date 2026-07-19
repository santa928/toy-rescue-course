export type MissionPhase = 'assigned' | 'active' | 'celebrating' | 'freeRoam';
export type BreakablePhase = 'intact' | 'broken';

export interface VoxelGameSignals {
  readonly atGarage: boolean;
  readonly sprayActive: boolean;
  readonly sprayOnFire: boolean;
}

export interface BreakableSnapshot {
  readonly id: string;
  readonly phase: BreakablePhase;
  readonly respawnRemainingMs: number;
}

export interface VoxelGameSnapshot {
  readonly blocks: readonly BreakableSnapshot[];
  readonly celebrationRemainingMs: number;
  readonly elapsedMs: number;
  readonly fireIntensity: number;
  readonly missionPhase: MissionPhase;
  readonly routeVisible: boolean;
  readonly signals: VoxelGameSignals;
}

export type VoxelGameSnapshotListener = (snapshot: VoxelGameSnapshot) => void;

export interface ManualClockFlag {
  current: boolean;
}

interface MutableBreakableState {
  clear: boolean;
  id: string;
  phase: BreakablePhase;
  respawnRemainingMs: number;
}

const EXTINGUISH_DURATION_MS = 2_500;
const CELEBRATION_DURATION_MS = 1_800;
const RESPAWN_DURATION_MS = 5_000;
const BREAK_IMPACT_THRESHOLD = 4;
const TIME_EPSILON_MS = 1e-6;
const FIXED_STEP_MS = 1_000 / 60;

/** 残り時間を0以上へ正規化し、丸め誤差として無視できる値を0にする。 */
function normalizeRemainingMilliseconds(value: number): number {
  return value <= TIME_EPSILON_MS ? 0 : value;
}

/** 正の有限時間を60Hz固定stepと最後の余りへ分け、合計時間を変えずに進める。 */
export function advanceInFixedSteps(
  milliseconds: number,
  advance: (deltaMs: number) => void,
): void {
  const totalMs = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
  if (totalMs === 0) return;

  const fullStepCount = Math.floor(totalMs / FIXED_STEP_MS);
  for (let step = 0; step < fullStepCount; step += 1) advance(FIXED_STEP_MS);

  const remainderMs = normalizeRemainingMilliseconds(totalMs - fullStepCount * FIXED_STEP_MS);
  if (remainderMs > 0) advance(remainderMs);
}

/** Reactへ公開する低頻度snapshot項目だけを比較できる署名へ変換する。 */
function createObservableSignature(snapshot: VoxelGameSnapshot): string {
  return `${snapshot.missionPhase}:${snapshot.fireIntensity}:${snapshot.blocks
    .map(({ id, phase }) => `${id}=${phase}`)
    .join(',')}`;
}

/** 消火ミッションと壊せる積み木を固定stepで進めるframework非依存runtime。 */
export class VoxelGameRuntime {
  private blocks: MutableBreakableState[];
  private celebrationRemainingMs = 0;
  private elapsedMs = 0;
  private extinguishRemainingMs = EXTINGUISH_DURATION_MS;
  private missionPhase: MissionPhase = 'assigned';
  private signals: VoxelGameSignals = { atGarage: false, sprayActive: false, sprayOnFire: false };
  private readonly listeners = new Set<VoxelGameSnapshotListener>();
  private observableSignature: string;

  /** @param blockIds 壊せる積み木として管理する一意な識別子の一覧。 */
  public constructor(blockIds: readonly string[]) {
    this.blocks = blockIds.map((id) => ({ clear: true, id, phase: 'intact', respawnRemainingMs: 0 }));
    this.observableSignature = createObservableSignature(this.getSnapshot());
  }

  /** mission・火・block phaseの変化通知を購読し、戻り値で安全に解除する。 */
  public subscribe(listener: VoxelGameSnapshotListener): () => void {
    if (this.listeners.size === 0) {
      this.observableSignature = createObservableSignature(this.getSnapshot());
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 入力・空間判定から得た現在signalを部分更新する。 */
  public setSignals(signals: Partial<VoxelGameSignals>): void {
    this.signals = { ...this.signals, ...signals };
  }

  /** 指定blockの復元領域から車両が離れているか更新する。 */
  public setBlockClear(id: string, clear: boolean): void {
    const block = this.blocks.find((entry) => entry.id === id);
    if (block) block.clear = clear;
  }

  /** 有効衝突を受けた指定blockを破壊状態へ移す。 */
  public registerBlockImpact(id: string, impactSpeed: number): void {
    const block = this.blocks.find((entry) => entry.id === id);
    if (!block || block.phase === 'broken' || impactSpeed < BREAK_IMPACT_THRESHOLD) return;
    block.phase = 'broken';
    block.respawnRemainingMs = RESPAWN_DURATION_MS;
  }

  /** runtimeを指定ミリ秒だけ決定的に進める。 */
  public advance(milliseconds: number): void {
    const deltaMs = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
    let extinguishedThisStep = false;
    this.elapsedMs += deltaMs;

    if ((this.missionPhase === 'assigned' || this.missionPhase === 'active') && this.signals.sprayActive) {
      this.missionPhase = 'active';
      if (this.signals.sprayOnFire) {
        this.extinguishRemainingMs = normalizeRemainingMilliseconds(this.extinguishRemainingMs - deltaMs);
        if (this.extinguishRemainingMs === 0) {
          this.missionPhase = 'celebrating';
          this.celebrationRemainingMs = CELEBRATION_DURATION_MS;
          extinguishedThisStep = true;
        }
      }
    }

    if (this.missionPhase === 'celebrating' && !extinguishedThisStep) {
      this.celebrationRemainingMs = normalizeRemainingMilliseconds(this.celebrationRemainingMs - deltaMs);
      if (this.celebrationRemainingMs === 0) this.missionPhase = 'freeRoam';
    } else if (this.missionPhase === 'freeRoam' && this.signals.atGarage) {
      this.resetMission();
    }

    for (const block of this.blocks) {
      if (block.phase !== 'broken') continue;
      block.respawnRemainingMs = normalizeRemainingMilliseconds(block.respawnRemainingMs - deltaMs);
      if (block.respawnRemainingMs === 0 && block.clear) block.phase = 'intact';
    }

    this.publishObservableChanges();
  }

  /** 消火仕事だけを初期状態へ戻す。 */
  public resetMission(): void {
    this.extinguishRemainingMs = EXTINGUISH_DURATION_MS;
    this.missionPhase = 'assigned';
    this.celebrationRemainingMs = 0;
    this.signals = { ...this.signals, atGarage: false, sprayOnFire: false };
  }

  /** 外部へ変更不能な現在snapshotを返す。 */
  public getSnapshot(): VoxelGameSnapshot {
    return {
      blocks: this.blocks.map(({ id, phase, respawnRemainingMs }) => ({ id, phase, respawnRemainingMs })),
      celebrationRemainingMs: this.celebrationRemainingMs,
      elapsedMs: this.elapsedMs,
      fireIntensity: Math.max(0, Math.min(1, this.extinguishRemainingMs / EXTINGUISH_DURATION_MS)),
      missionPhase: this.missionPhase,
      routeVisible: this.missionPhase === 'assigned' || this.missionPhase === 'active',
      signals: { ...this.signals },
    };
  }

  /** 高頻度timerを除く公開項目が変わったときだけ現在snapshotを通知する。 */
  private publishObservableChanges(): void {
    const snapshot = this.getSnapshot();
    const nextSignature = createObservableSignature(snapshot);
    if (nextSignature === this.observableSignature) return;
    this.observableSignature = nextSignature;
    for (const listener of this.listeners) listener(snapshot);
  }
}

/** 手動clock直後の1frameをskipし、それ以外の通常deltaを最大50msで進める。 */
export function advanceRuntimeFrame(
  runtime: VoxelGameRuntime,
  manualClockFlag: ManualClockFlag,
  deltaSeconds: number,
): void {
  if (manualClockFlag.current) {
    manualClockFlag.current = false;
    return;
  }
  runtime.advance(Math.min(deltaSeconds, 0.05) * 1_000);
}

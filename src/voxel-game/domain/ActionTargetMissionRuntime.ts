import type { MissionPhase } from './VoxelGameRuntime';

/** 外部へ公開する共通主操作仕事の1対象状態。 */
export interface ActionTargetSnapshot {
  readonly completed: boolean;
  readonly id: string;
}

/** framework非依存の共通主操作仕事状態。 */
export interface ActionTargetMissionSnapshot {
  readonly celebrationRemainingMs: number;
  readonly completedCount: number;
  readonly elapsedMs: number;
  readonly missionPhase: MissionPhase;
  readonly routeVisible: boolean;
  readonly targetCount: number;
  readonly targets: readonly ActionTargetSnapshot[];
}

const CELEBRATION_DURATION_MS = 1_800;

/** 対象IDを変更前に検証し、外部配列から切り離したcopyを返す。 */
function requireValidTargetIds(targetIds: readonly string[]): readonly string[] {
  if (targetIds.length === 0) throw new Error('Action target mission requires targets');
  const seen = new Set<string>();
  for (const id of targetIds) {
    if (id.trim().length === 0) {
      throw new Error('Action target mission requires non-empty target ids');
    }
    if (seen.has(id)) throw new Error(`Duplicate action target id: ${id}`);
    seen.add(id);
  }
  return [...targetIds];
}

/** 主操作対象の冪等進捗、成功、自由走行、帰庫再開を管理するpure runtime。 */
export class ActionTargetMissionRuntime {
  private atGarage = false;
  private atWorksite = false;
  private celebrationRemainingMs = 0;
  private readonly completedIds = new Set<string>();
  private elapsedMs = 0;
  private missionPhase: MissionPhase = 'assigned';
  private targetIds: readonly string[];

  /** 一意で空でない対象IDを受け取り、仕事の初期状態を作る。 */
  public constructor(targetIds: readonly string[]) {
    this.targetIds = requireValidTargetIds(targetIds);
  }

  /** 次仕事の対象IDへ同じruntimeを再割当し、全進捗を開始状態へ戻す。 */
  public assignTargets(targetIds: readonly string[]): void {
    const nextTargetIds = requireValidTargetIds(targetIds);
    this.targetIds = nextTargetIds;
    this.resetMission();
  }

  /** 車両が中央車庫の仕事再開領域にいるか同期する。 */
  public setAtGarage(atGarage: boolean): void {
    this.atGarage = atGarage;
  }

  /** 車両が現在仕事の目的地区へ入ったか同期する。 */
  public setAtWorksite(atWorksite: boolean): void {
    this.atWorksite = atWorksite;
  }

  /** 未完了の既知対象を1回だけ完了し、状態を変えた場合だけtrueを返す。 */
  public registerTargetCompletion(id: string): boolean {
    if (
      !this.targetIds.includes(id)
      || this.completedIds.has(id)
      || this.missionPhase === 'celebrating'
      || this.missionPhase === 'freeRoam'
    ) {
      return false;
    }

    this.completedIds.add(id);
    if (this.completedIds.size === this.targetIds.length) {
      this.missionPhase = 'celebrating';
      this.celebrationRemainingMs = CELEBRATION_DURATION_MS;
    } else {
      this.missionPhase = 'active';
    }
    return true;
  }

  /** runtimeを有限の正時間だけ進め、成功演出と帰庫再開を決定的に処理する。 */
  public advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
    this.elapsedMs += milliseconds;

    if (this.missionPhase === 'assigned' && this.atWorksite) {
      this.missionPhase = 'active';
    }
    if (this.missionPhase === 'celebrating') {
      this.celebrationRemainingMs = Math.max(0, this.celebrationRemainingMs - milliseconds);
      if (this.celebrationRemainingMs === 0) this.missionPhase = 'freeRoam';
    } else if (this.missionPhase === 'freeRoam' && this.atGarage) {
      this.resetMission();
    }
  }

  /** 対象、演出、空間signalを仕事開始状態へ戻す。 */
  public resetMission(): void {
    this.atGarage = false;
    this.atWorksite = false;
    this.celebrationRemainingMs = 0;
    this.completedIds.clear();
    this.missionPhase = 'assigned';
  }

  /** 外部で変更できない現在の仕事snapshotを返す。 */
  public getSnapshot(): ActionTargetMissionSnapshot {
    return {
      celebrationRemainingMs: this.celebrationRemainingMs,
      completedCount: this.completedIds.size,
      elapsedMs: this.elapsedMs,
      missionPhase: this.missionPhase,
      routeVisible: this.missionPhase === 'assigned' || this.missionPhase === 'active',
      targetCount: this.targetIds.length,
      targets: this.targetIds.map((id) => ({ completed: this.completedIds.has(id), id })),
    };
  }
}

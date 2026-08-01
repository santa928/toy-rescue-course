import type { MissionPhase } from './VoxelGameRuntime';

/** 外部へ公開する1つの工事がれきの処理状態。 */
export interface BulldozerDebrisSnapshot {
  readonly cleared: boolean;
  readonly id: string;
}

/** framework非依存のブルドーザー仕事状態。 */
export interface BulldozerMissionSnapshot {
  readonly celebrationRemainingMs: number;
  readonly clearedCount: number;
  readonly debris: readonly BulldozerDebrisSnapshot[];
  readonly elapsedMs: number;
  readonly missionPhase: MissionPhase;
  readonly routeVisible: boolean;
  readonly targetCount: number;
}

const CELEBRATION_DURATION_MS = 1_800;

/** 3がれきの冪等進捗、成功、自由走行、帰庫再開を管理するpure runtime。 */
export class BulldozerMissionRuntime {
  private atGarage = false;
  private atWorksite = false;
  private celebrationRemainingMs = 0;
  private readonly clearedIds = new Set<string>();
  private readonly debrisIds: readonly string[];
  private elapsedMs = 0;
  private missionPhase: MissionPhase = 'assigned';

  /** 一意で空でないがれきIDを受け取り、仕事の初期状態を作る。 */
  public constructor(debrisIds: readonly string[]) {
    const seen = new Set<string>();
    for (const id of debrisIds) {
      if (seen.has(id)) throw new Error(`Duplicate bulldozer debris id: ${id}`);
      seen.add(id);
    }
    if (debrisIds.length === 0) throw new Error('Bulldozer mission requires debris');
    this.debrisIds = [...debrisIds];
  }

  /** 車両が中央車庫の仕事再開領域にいるか同期する。 */
  public setAtGarage(atGarage: boolean): void {
    this.atGarage = atGarage;
  }

  /** 車両が西の工事地区へ入ったか同期する。 */
  public setAtWorksite(atWorksite: boolean): void {
    this.atWorksite = atWorksite;
  }

  /** 未処理の既知がれきを1回だけ片付け、状態を変えた場合だけtrueを返す。 */
  public registerDebrisClear(id: string): boolean {
    if (
      !this.debrisIds.includes(id)
      || this.clearedIds.has(id)
      || this.missionPhase === 'celebrating'
      || this.missionPhase === 'freeRoam'
    ) {
      return false;
    }

    this.clearedIds.add(id);
    if (this.clearedIds.size === this.debrisIds.length) {
      this.missionPhase = 'celebrating';
      this.celebrationRemainingMs = CELEBRATION_DURATION_MS;
    } else {
      this.missionPhase = 'active';
    }
    return true;
  }

  /** runtimeを有限の正時間だけ進め、成功演出と帰庫再開を決定的に処理する。 */
  public advance(milliseconds: number): void {
    const deltaMs = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
    if (deltaMs === 0) return;
    this.elapsedMs += deltaMs;

    if (this.missionPhase === 'assigned' && this.atWorksite) {
      this.missionPhase = 'active';
    }
    if (this.missionPhase === 'celebrating') {
      this.celebrationRemainingMs = Math.max(0, this.celebrationRemainingMs - deltaMs);
      if (this.celebrationRemainingMs === 0) this.missionPhase = 'freeRoam';
    } else if (this.missionPhase === 'freeRoam' && this.atGarage) {
      this.resetMission();
    }
  }

  /** がれき、演出、空間signalを仕事開始状態へ戻す。 */
  public resetMission(): void {
    this.atGarage = false;
    this.atWorksite = false;
    this.celebrationRemainingMs = 0;
    this.clearedIds.clear();
    this.missionPhase = 'assigned';
  }

  /** 外部で変更できない現在の仕事snapshotを返す。 */
  public getSnapshot(): BulldozerMissionSnapshot {
    return {
      celebrationRemainingMs: this.celebrationRemainingMs,
      clearedCount: this.clearedIds.size,
      debris: this.debrisIds.map((id) => ({ cleared: this.clearedIds.has(id), id })),
      elapsedMs: this.elapsedMs,
      missionPhase: this.missionPhase,
      routeVisible: this.missionPhase === 'assigned' || this.missionPhase === 'active',
      targetCount: this.debrisIds.length,
    };
  }
}

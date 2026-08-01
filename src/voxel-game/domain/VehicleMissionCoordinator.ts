import {
  advanceInFixedSteps,
  VoxelGameRuntime,
  type ManualClockFlag,
  type MissionPhase,
  type VoxelGameSignals,
  type VoxelGameSnapshot,
} from './VoxelGameRuntime';
import {
  BulldozerMissionRuntime,
  type BulldozerMissionSnapshot,
} from './BulldozerMissionRuntime';
import {
  canSwitchVehicle,
  getVehicleDefinition,
  type VehicleId,
  type VehicleMissionId,
  type VehicleSwitchContext,
} from './vehicleDefinitions';

/** 車種coordinatorのadvance直前に最新空間signalを同期するcallback。 */
export type VehicleMissionBeforeAdvance = () => void;

/** HUDとtelemetryが車種に依存せず読む現在仕事。 */
export interface VehicleMissionSnapshot {
  readonly destinationDistrict: 'fire' | 'blocks';
  readonly id: VehicleMissionId;
  readonly objectiveLabel: string;
  readonly phase: MissionPhase;
  readonly progress: { readonly current: number; readonly target: number };
  readonly routeVisible: boolean;
  readonly vehicleId: VehicleId;
}

/** 選択車両、共有消防runtime、工事runtimeをまとめた外部snapshot。 */
export interface VehicleMissionCoordinatorSnapshot {
  readonly bulldozer: BulldozerMissionSnapshot;
  readonly fire: VoxelGameSnapshot;
  readonly mission: VehicleMissionSnapshot;
  readonly selectedVehicleId: VehicleId;
}

export type VehicleMissionCoordinatorListener = (
  snapshot: VehicleMissionCoordinatorSnapshot,
) => void;

/** 車両位置から同期する車庫と工事地区の低頻度signal。 */
export interface VehicleMissionSpatialSignals {
  readonly atBulldozerWorksite: boolean;
  readonly atGarage: boolean;
}

/** 消防仕事snapshotを車種共通の表示契約へ変換する。 */
function createFireMissionSnapshot(snapshot: VoxelGameSnapshot): VehicleMissionSnapshot {
  const completed = snapshot.missionPhase === 'celebrating' || snapshot.missionPhase === 'freeRoam';
  const labels: Readonly<Record<MissionPhase, string>> = {
    active: 'おみずをかけよう',
    assigned: '火のところへいこう',
    celebrating: 'できた！',
    freeRoam: 'じゆうにあそぼう',
  };
  return {
    destinationDistrict: 'fire',
    id: 'fire-rescue',
    objectiveLabel: labels[snapshot.missionPhase],
    phase: snapshot.missionPhase,
    progress: { current: completed ? 1 : 0, target: 1 },
    routeVisible: snapshot.routeVisible,
    vehicleId: 'fire-truck',
  };
}

/** 工事仕事snapshotを残り数つきの車種共通表示契約へ変換する。 */
function createBulldozerMissionSnapshot(
  snapshot: BulldozerMissionSnapshot,
): VehicleMissionSnapshot {
  const remaining = snapshot.targetCount - snapshot.clearedCount;
  const labels: Readonly<Record<MissionPhase, string>> = {
    active: `がれき あと${remaining}こ`,
    assigned: 'こうじげんばへ いこう',
    celebrating: 'できた！',
    freeRoam: 'じゆうにあそぼう',
  };
  return {
    destinationDistrict: 'blocks',
    id: 'debris-clearance',
    objectiveLabel: labels[snapshot.missionPhase],
    phase: snapshot.missionPhase,
    progress: { current: snapshot.clearedCount, target: snapshot.targetCount },
    routeVisible: snapshot.routeVisible,
    vehicleId: 'bulldozer',
  };
}

/** Reactへ通知する離散状態だけを安定した比較文字列へ変換する。 */
function createObservableSignature(snapshot: VehicleMissionCoordinatorSnapshot): string {
  return [
    snapshot.selectedVehicleId,
    snapshot.mission.phase,
    snapshot.mission.progress.current,
    snapshot.mission.progress.target,
  ].join(':');
}

/** 共有積み木runtimeを温存しながら選択車両の専用仕事だけを作動させる。 */
export class VehicleMissionCoordinator {
  public readonly bulldozerRuntime: BulldozerMissionRuntime;
  public readonly fireRuntime: VoxelGameRuntime;
  private readonly listeners = new Set<VehicleMissionCoordinatorListener>();
  private observableSignature: string;
  private selectedVehicleId: VehicleId = 'fire-truck';

  /** 共有積み木IDと工事がれきIDから両仕事runtimeを1回だけ作る。 */
  public constructor(blockIds: readonly string[], debrisIds: readonly string[]) {
    this.fireRuntime = new VoxelGameRuntime(blockIds);
    this.bulldozerRuntime = new BulldozerMissionRuntime(debrisIds);
    this.observableSignature = createObservableSignature(this.getSnapshot());
  }

  /** 離散的な車種・phase・進捗変更を購読し、戻り値で解除する。 */
  public subscribe(listener: VehicleMissionCoordinatorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 車庫内停止中だけ別車種へ切り替え、選択先仕事を開始状態へ戻す。 */
  public selectVehicle(id: unknown, context: VehicleSwitchContext): boolean {
    const nextVehicleId = getVehicleDefinition(id).id;
    if (!canSwitchVehicle(context) || nextVehicleId === this.selectedVehicleId) return false;

    this.selectedVehicleId = nextVehicleId;
    this.fireRuntime.setSignals({ atGarage: false, sprayActive: false, sprayOnFire: false });
    this.bulldozerRuntime.setAtGarage(false);
    this.bulldozerRuntime.setAtWorksite(false);
    if (nextVehicleId === 'fire-truck') this.fireRuntime.resetMission();
    else this.bulldozerRuntime.resetMission();
    this.publishObservableChanges();
    return true;
  }

  /** 選択中消防車だけへ放水signalを渡し、他車種では強制解除する。 */
  public setFireSignals(
    signals: Pick<VoxelGameSignals, 'sprayActive' | 'sprayOnFire'>,
  ): void {
    this.fireRuntime.setSignals(this.selectedVehicleId === 'fire-truck'
      ? signals
      : { sprayActive: false, sprayOnFire: false });
  }

  /** 車庫・工事地区signalを選択中仕事だけへ同期する。 */
  public setSpatialSignals(signals: VehicleMissionSpatialSignals): void {
    const bulldozerSelected = this.selectedVehicleId === 'bulldozer';
    this.fireRuntime.setSignals({
      atGarage: this.selectedVehicleId === 'fire-truck' && signals.atGarage,
    });
    this.bulldozerRuntime.setAtGarage(bulldozerSelected && signals.atGarage);
    this.bulldozerRuntime.setAtWorksite(
      bulldozerSelected && signals.atBulldozerWorksite,
    );
  }

  /** ブルドーザー選択中だけがれき除去を登録し、離散進捗を通知する。 */
  public registerDebrisClear(id: string): boolean {
    if (this.selectedVehicleId !== 'bulldozer') return false;
    const changed = this.bulldozerRuntime.registerDebrisClear(id);
    if (changed) this.publishObservableChanges();
    return changed;
  }

  /** 共有積み木timerと選択中の専用仕事を同じ有限時間だけ進める。 */
  public advance(milliseconds: number): void {
    this.fireRuntime.advance(milliseconds);
    if (this.selectedVehicleId === 'bulldozer') {
      this.bulldozerRuntime.advance(milliseconds);
    }
    this.publishObservableChanges();
  }

  /** 選択車両と両runtimeの変更不能な現在snapshotを返す。 */
  public getSnapshot(): VehicleMissionCoordinatorSnapshot {
    const fire = this.fireRuntime.getSnapshot();
    const bulldozer = this.bulldozerRuntime.getSnapshot();
    return {
      bulldozer,
      fire,
      mission: this.selectedVehicleId === 'fire-truck'
        ? createFireMissionSnapshot(fire)
        : createBulldozerMissionSnapshot(bulldozer),
      selectedVehicleId: this.selectedVehicleId,
    };
  }

  /** observable signatureが変わった場合だけ現在snapshotを全購読者へ配送する。 */
  private publishObservableChanges(): void {
    const snapshot = this.getSnapshot();
    const signature = createObservableSignature(snapshot);
    if (signature === this.observableSignature) return;
    this.observableSignature = signature;
    for (const listener of this.listeners) listener(snapshot);
  }
}

/** 正の有限時間を固定stepで進め、直後の通常frame skipを予約する。 */
export function advanceVehicleMissionManualClock(
  coordinator: VehicleMissionCoordinator,
  manualClockFlag: ManualClockFlag,
  milliseconds: number,
  beforeAdvance?: VehicleMissionBeforeAdvance,
): void {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
  manualClockFlag.current = true;
  beforeAdvance?.();
  advanceInFixedSteps(milliseconds, (deltaMs) => coordinator.advance(deltaMs));
}

/** 手動clock直後だけskipし、通常frameを最大50msで進める。 */
export function advanceVehicleMissionFrame(
  coordinator: VehicleMissionCoordinator,
  manualClockFlag: ManualClockFlag,
  deltaSeconds: number,
  beforeAdvance?: VehicleMissionBeforeAdvance,
): void {
  if (manualClockFlag.current) {
    manualClockFlag.current = false;
    return;
  }
  beforeAdvance?.();
  coordinator.advance(Math.min(Math.max(0, deltaSeconds), 0.05) * 1_000);
}

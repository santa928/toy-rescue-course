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
  ActionTargetMissionRuntime,
  type ActionTargetMissionSnapshot,
} from './ActionTargetMissionRuntime';
import {
  canSwitchVehicle,
  getVehicleDefinition,
  type VehicleId,
  type VehicleMissionId,
  type VehicleSwitchContext,
} from './vehicleDefinitions';
import { JobDeck, normalizeJobSeed } from './JobDeck';
import {
  VEHICLE_JOBS,
  type AmbulanceVehicleJobDefinition,
  type BulldozerVehicleJobDefinition,
  type ExcavatorVehicleJobDefinition,
  type FireVehicleJobDefinition,
  type VehicleJobId,
} from './vehicleJobs';

/** 車種coordinatorのadvance直前に最新空間signalを同期するcallback。 */
export type VehicleMissionBeforeAdvance = () => void;

/** HUDとtelemetryが車種に依存せず読む現在仕事。 */
export interface VehicleMissionSnapshot {
  readonly destinationDistrict: 'fire' | 'blocks' | 'park' | 'south';
  readonly id: VehicleMissionId;
  readonly jobCycle: number;
  readonly jobId: VehicleJobId;
  readonly jobLabel: string;
  readonly objectiveLabel: string;
  readonly phase: MissionPhase;
  readonly progress: { readonly current: number; readonly target: number };
  readonly routeVisible: boolean;
  readonly vehicleId: VehicleId;
}

/** 選択車両、共有消防runtime、工事runtimeをまとめた外部snapshot。 */
export interface VehicleMissionCoordinatorSnapshot {
  readonly ambulance: ActionTargetMissionSnapshot;
  readonly bulldozer: BulldozerMissionSnapshot;
  readonly currentJobs: {
    readonly ambulance: AmbulanceVehicleJobDefinition;
    readonly bulldozer: BulldozerVehicleJobDefinition;
    readonly excavator: ExcavatorVehicleJobDefinition;
    readonly fire: FireVehicleJobDefinition;
  };
  readonly excavator: ActionTargetMissionSnapshot;
  readonly fire: VoxelGameSnapshot;
  readonly jobSeed: number;
  readonly mission: VehicleMissionSnapshot;
  readonly selectedVehicleId: VehicleId;
}

export type VehicleMissionCoordinatorListener = (
  snapshot: VehicleMissionCoordinatorSnapshot,
) => void;

/** 車両位置から同期する車庫と工事地区の低頻度signal。 */
export interface VehicleMissionSpatialSignals {
  readonly atActionTargetWorksite?: boolean;
  readonly atBulldozerWorksite: boolean;
  readonly atGarage: boolean;
}

/** coordinator初期化時に外部境界から渡す再現用設定。 */
export interface VehicleMissionCoordinatorOptions {
  readonly jobSeed?: unknown;
  readonly rotateJobsOnCompletion?: boolean;
}

/** 消防仕事snapshotを車種共通の表示契約へ変換する。 */
function createFireMissionSnapshot(
  snapshot: VoxelGameSnapshot,
  job: FireVehicleJobDefinition,
  jobCycle: number,
): VehicleMissionSnapshot {
  const completed = snapshot.missionPhase === 'celebrating' || snapshot.missionPhase === 'freeRoam';
  const labels: Readonly<Record<MissionPhase, string>> = {
    active: 'おみずをかけよう',
    assigned: job.label,
    celebrating: 'できた！',
    freeRoam: 'じゆうにあそぼう',
  };
  return {
    destinationDistrict: 'fire',
    id: 'fire-rescue',
    jobCycle,
    jobId: job.id,
    jobLabel: job.label,
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
  job: BulldozerVehicleJobDefinition,
  jobCycle: number,
): VehicleMissionSnapshot {
  const remaining = snapshot.targetCount - snapshot.clearedCount;
  const labels: Readonly<Record<MissionPhase, string>> = {
    active: `がれき あと${remaining}こ`,
    assigned: job.label,
    celebrating: 'できた！',
    freeRoam: 'じゆうにあそぼう',
  };
  return {
    destinationDistrict: 'blocks',
    id: 'debris-clearance',
    jobCycle,
    jobId: job.id,
    jobLabel: job.label,
    objectiveLabel: labels[snapshot.missionPhase],
    phase: snapshot.missionPhase,
    progress: { current: snapshot.clearedCount, target: snapshot.targetCount },
    routeVisible: snapshot.routeVisible,
    vehicleId: 'bulldozer',
  };
}

/** ショベル仕事snapshotを残り土山数つきの車種共通表示契約へ変換する。 */
function createExcavatorMissionSnapshot(
  snapshot: ActionTargetMissionSnapshot,
  job: ExcavatorVehicleJobDefinition,
  jobCycle: number,
): VehicleMissionSnapshot {
  const remaining = snapshot.targetCount - snapshot.completedCount;
  const labels: Readonly<Record<MissionPhase, string>> = {
    active: `つち あと${remaining}こ`,
    assigned: job.label,
    celebrating: 'できた！',
    freeRoam: 'じゆうにあそぼう',
  };
  return {
    destinationDistrict: 'blocks',
    id: 'soil-digging',
    jobCycle,
    jobId: job.id,
    jobLabel: job.label,
    objectiveLabel: labels[snapshot.missionPhase],
    phase: snapshot.missionPhase,
    progress: { current: snapshot.completedCount, target: snapshot.targetCount },
    routeVisible: snapshot.routeVisible,
    vehicleId: 'excavator',
  };
}

/** 救急仕事snapshotを患者1体の手当て進捗へ変換する。 */
function createAmbulanceMissionSnapshot(
  snapshot: ActionTargetMissionSnapshot,
  job: AmbulanceVehicleJobDefinition,
  jobCycle: number,
): VehicleMissionSnapshot {
  const labels: Readonly<Record<MissionPhase, string>> = {
    active: 'てあてをしよう',
    assigned: job.label,
    celebrating: 'できた！',
    freeRoam: 'じゆうにあそぼう',
  };
  return {
    destinationDistrict: 'park',
    id: 'patient-care',
    jobCycle,
    jobId: job.id,
    jobLabel: job.label,
    objectiveLabel: labels[snapshot.missionPhase],
    phase: snapshot.missionPhase,
    progress: { current: snapshot.completedCount, target: snapshot.targetCount },
    routeVisible: snapshot.routeVisible,
    vehicleId: 'ambulance',
  };
}

/** Reactへ通知する離散状態だけを安定した比較文字列へ変換する。 */
function createObservableSignature(snapshot: VehicleMissionCoordinatorSnapshot): string {
  return [
    snapshot.selectedVehicleId,
    snapshot.mission.phase,
    snapshot.mission.progress.current,
    snapshot.mission.progress.target,
    snapshot.mission.jobId,
    snapshot.mission.jobCycle,
  ].join(':');
}

/** 共有積み木runtimeを温存しながら選択車両の専用仕事だけを作動させる。 */
export class VehicleMissionCoordinator {
  public readonly ambulanceRuntime: ActionTargetMissionRuntime;
  public readonly bulldozerRuntime: BulldozerMissionRuntime;
  public readonly excavatorRuntime: ActionTargetMissionRuntime;
  public readonly fireRuntime: VoxelGameRuntime;
  public readonly jobSeed: number;
  private currentAmbulanceJob: AmbulanceVehicleJobDefinition;
  private currentBulldozerJob: BulldozerVehicleJobDefinition;
  private currentExcavatorJob: ExcavatorVehicleJobDefinition;
  private currentFireJob: FireVehicleJobDefinition;
  private readonly bulldozerJobDeck: JobDeck<BulldozerVehicleJobDefinition>;
  private readonly ambulanceJobDeck: JobDeck<AmbulanceVehicleJobDefinition>;
  private ambulanceJobCycle = 1;
  private bulldozerJobCycle = 1;
  private readonly excavatorJobDeck: JobDeck<ExcavatorVehicleJobDefinition>;
  private excavatorJobCycle = 1;
  private readonly fireJobDeck: JobDeck<FireVehicleJobDefinition>;
  private fireJobCycle = 1;
  private readonly listeners = new Set<VehicleMissionCoordinatorListener>();
  private observableSignature: string;
  private readonly rotateJobsOnCompletion: boolean;
  private selectedVehicleId: VehicleId = 'fire-truck';

  /** 共有積み木IDとsession seedから両仕事runtimeと独立job deckを1回だけ作る。 */
  public constructor(
    blockIds: readonly string[],
    options: VehicleMissionCoordinatorOptions = {},
  ) {
    this.jobSeed = normalizeJobSeed(options.jobSeed ?? 1);
    this.rotateJobsOnCompletion = options.rotateJobsOnCompletion ?? false;
    this.fireJobDeck = new JobDeck(VEHICLE_JOBS['fire-truck'], this.jobSeed);
    this.ambulanceJobDeck = new JobDeck(VEHICLE_JOBS.ambulance, this.jobSeed);
    this.bulldozerJobDeck = new JobDeck(VEHICLE_JOBS.bulldozer, this.jobSeed);
    this.excavatorJobDeck = new JobDeck(VEHICLE_JOBS.excavator, this.jobSeed);
    this.currentFireJob = this.fireJobDeck.draw();
    this.currentAmbulanceJob = this.ambulanceJobDeck.draw();
    this.currentBulldozerJob = this.bulldozerJobDeck.draw();
    this.currentExcavatorJob = this.excavatorJobDeck.draw();
    this.fireRuntime = new VoxelGameRuntime(blockIds);
    this.ambulanceRuntime = new ActionTargetMissionRuntime(
      this.currentAmbulanceJob.targets.map(({ id }) => id),
    );
    this.bulldozerRuntime = new BulldozerMissionRuntime(
      this.currentBulldozerJob.debris.map(({ id }) => id),
    );
    this.excavatorRuntime = new ActionTargetMissionRuntime(
      this.currentExcavatorJob.targets.map(({ id }) => id),
    );
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
    this.excavatorRuntime.setAtGarage(false);
    this.excavatorRuntime.setAtWorksite(false);
    this.ambulanceRuntime.setAtGarage(false);
    this.ambulanceRuntime.setAtWorksite(false);
    if (nextVehicleId === 'fire-truck') this.fireRuntime.resetMission();
    else if (nextVehicleId === 'bulldozer') this.bulldozerRuntime.resetMission();
    else if (nextVehicleId === 'excavator') this.excavatorRuntime.resetMission();
    else this.ambulanceRuntime.resetMission();
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
    const excavatorSelected = this.selectedVehicleId === 'excavator';
    const ambulanceSelected = this.selectedVehicleId === 'ambulance';
    this.fireRuntime.setSignals({
      atGarage: this.selectedVehicleId === 'fire-truck' && signals.atGarage,
    });
    this.bulldozerRuntime.setAtGarage(bulldozerSelected && signals.atGarage);
    this.bulldozerRuntime.setAtWorksite(
      bulldozerSelected && signals.atBulldozerWorksite,
    );
    this.excavatorRuntime.setAtGarage(excavatorSelected && signals.atGarage);
    this.excavatorRuntime.setAtWorksite(
      excavatorSelected
      && (signals.atActionTargetWorksite ?? signals.atBulldozerWorksite),
    );
    this.ambulanceRuntime.setAtGarage(ambulanceSelected && signals.atGarage);
    this.ambulanceRuntime.setAtWorksite(
      ambulanceSelected
      && (signals.atActionTargetWorksite ?? signals.atBulldozerWorksite),
    );
  }

  /** ブルドーザー選択中だけがれき除去を登録し、離散進捗を通知する。 */
  public registerDebrisClear(id: string): boolean {
    if (this.selectedVehicleId !== 'bulldozer') return false;
    const changed = this.bulldozerRuntime.registerDebrisClear(id);
    if (changed) this.publishObservableChanges();
    return changed;
  }

  /** 選択中のアクション対象車だけ仕事完了を登録し、離散進捗を通知する。 */
  public registerActionTargetCompletion(id: string): boolean {
    const runtime = this.selectedVehicleId === 'excavator'
      ? this.excavatorRuntime
      : this.selectedVehicleId === 'ambulance'
        ? this.ambulanceRuntime
        : null;
    if (!runtime) return false;
    const changed = runtime.registerTargetCompletion(id);
    if (changed) this.publishObservableChanges();
    return changed;
  }

  /** 共有積み木timerと選択中の専用仕事を同じ有限時間だけ進める。 */
  public advance(milliseconds: number): void {
    const firePhaseBeforeAdvance = this.fireRuntime.getSnapshot().missionPhase;
    const bulldozerPhaseBeforeAdvance = this.bulldozerRuntime.getSnapshot().missionPhase;
    const excavatorPhaseBeforeAdvance = this.excavatorRuntime.getSnapshot().missionPhase;
    const ambulancePhaseBeforeAdvance = this.ambulanceRuntime.getSnapshot().missionPhase;
    this.fireRuntime.advance(milliseconds);
    if (this.selectedVehicleId === 'bulldozer') {
      this.bulldozerRuntime.advance(milliseconds);
    }
    if (this.selectedVehicleId === 'excavator') {
      this.excavatorRuntime.advance(milliseconds);
    }
    if (this.selectedVehicleId === 'ambulance') {
      this.ambulanceRuntime.advance(milliseconds);
    }
    const firePhaseAfterAdvance = this.fireRuntime.getSnapshot().missionPhase;
    const bulldozerPhaseAfterAdvance = this.bulldozerRuntime.getSnapshot().missionPhase;
    const excavatorPhaseAfterAdvance = this.excavatorRuntime.getSnapshot().missionPhase;
    const ambulancePhaseAfterAdvance = this.ambulanceRuntime.getSnapshot().missionPhase;
    if (
      this.selectedVehicleId === 'fire-truck'
      && this.rotateJobsOnCompletion
      && firePhaseBeforeAdvance === 'freeRoam'
      && firePhaseAfterAdvance === 'assigned'
    ) {
      this.currentFireJob = this.fireJobDeck.draw();
      this.fireJobCycle += 1;
    }
    if (
      this.selectedVehicleId === 'bulldozer'
      && this.rotateJobsOnCompletion
      && bulldozerPhaseBeforeAdvance === 'freeRoam'
      && bulldozerPhaseAfterAdvance === 'assigned'
    ) {
      this.currentBulldozerJob = this.bulldozerJobDeck.draw();
      this.bulldozerJobCycle += 1;
      this.bulldozerRuntime.assignDebris(
        this.currentBulldozerJob.debris.map(({ id }) => id),
      );
    }
    if (
      this.selectedVehicleId === 'excavator'
      && this.rotateJobsOnCompletion
      && excavatorPhaseBeforeAdvance === 'freeRoam'
      && excavatorPhaseAfterAdvance === 'assigned'
    ) {
      this.currentExcavatorJob = this.excavatorJobDeck.draw();
      this.excavatorJobCycle += 1;
      this.excavatorRuntime.assignTargets(
        this.currentExcavatorJob.targets.map(({ id }) => id),
      );
    }
    if (
      this.selectedVehicleId === 'ambulance'
      && this.rotateJobsOnCompletion
      && ambulancePhaseBeforeAdvance === 'freeRoam'
      && ambulancePhaseAfterAdvance === 'assigned'
    ) {
      this.currentAmbulanceJob = this.ambulanceJobDeck.draw();
      this.ambulanceJobCycle += 1;
      this.ambulanceRuntime.assignTargets(
        this.currentAmbulanceJob.targets.map(({ id }) => id),
      );
    }
    this.publishObservableChanges();
  }

  /** 選択車両と両runtimeの変更不能な現在snapshotを返す。 */
  public getSnapshot(): VehicleMissionCoordinatorSnapshot {
    const fire = this.fireRuntime.getSnapshot();
    const bulldozer = this.bulldozerRuntime.getSnapshot();
    const excavator = this.excavatorRuntime.getSnapshot();
    const ambulance = this.ambulanceRuntime.getSnapshot();
    return {
      ambulance,
      bulldozer,
      currentJobs: {
        ambulance: this.currentAmbulanceJob,
        bulldozer: this.currentBulldozerJob,
        excavator: this.currentExcavatorJob,
        fire: this.currentFireJob,
      },
      excavator,
      fire,
      jobSeed: this.jobSeed,
      mission: this.selectedVehicleId === 'fire-truck'
        ? createFireMissionSnapshot(fire, this.currentFireJob, this.fireJobCycle)
        : this.selectedVehicleId === 'bulldozer'
          ? createBulldozerMissionSnapshot(
            bulldozer,
            this.currentBulldozerJob,
            this.bulldozerJobCycle,
          )
          : this.selectedVehicleId === 'excavator'
            ? createExcavatorMissionSnapshot(
              excavator,
              this.currentExcavatorJob,
              this.excavatorJobCycle,
            )
            : createAmbulanceMissionSnapshot(
              ambulance,
              this.currentAmbulanceJob,
              this.ambulanceJobCycle,
            ),
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

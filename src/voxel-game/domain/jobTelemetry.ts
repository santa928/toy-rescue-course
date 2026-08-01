import type { WorldPoint } from '../scene/productionWorldMap';
import type { VehicleMissionCoordinatorSnapshot } from './VehicleMissionCoordinator';
import type { VehicleJobId } from './vehicleJobs';

/** render hookが公開する現在仕事の再現情報と実判定対象。 */
export interface MissionJobTelemetry {
  readonly jobCycle: number;
  readonly jobId: VehicleJobId;
  readonly jobLabel: string;
  readonly jobSeed: number;
  readonly targetPositions: readonly WorldPoint[];
}

/** coordinatorの選択仕事だけからHUD識別情報とscene判定座標を複製して返す。 */
export function buildMissionJobTelemetry(
  snapshot: VehicleMissionCoordinatorSnapshot,
): MissionJobTelemetry {
  const targetPositions = snapshot.selectedVehicleId === 'fire-truck'
    ? [snapshot.currentJobs.fire.sprayTarget]
    : snapshot.currentJobs.bulldozer.debris.map(({ position }) => position);
  return {
    jobCycle: snapshot.mission.jobCycle,
    jobId: snapshot.mission.jobId,
    jobLabel: snapshot.mission.jobLabel,
    jobSeed: snapshot.jobSeed,
    targetPositions: targetPositions.map((position) => [...position] as WorldPoint),
  };
}

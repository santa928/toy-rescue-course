import type { WorldPoint } from '../scene/productionWorldMap';
import { GARAGE_POSITION } from '../scene/worldLayout';
import type { VehicleMissionCoordinatorSnapshot } from './VehicleMissionCoordinator';
import type { VehicleId } from './vehicleDefinitions';

/** HUDとおしごとマップが共有する、幼児向けの具体的な任務案内。 */
export interface VehicleMissionGuidance {
  readonly completionLabel: string;
  readonly instructionLabel: string;
  readonly targetLabel: string;
  readonly targetPosition: WorldPoint;
}

const ACTIVE_INSTRUCTIONS: Readonly<Record<VehicleId, string>> = {
  ambulance: 'ひとのそばで とまり てあてをおす',
  bulldozer: 'がれきへ ブレードでぶつかる',
  excavator: 'つちのまえで とまり バケットをおす',
  'fire-truck': '火のちかくで ほうすいをなが押し',
  police: 'あおいゲートを サイレンでとおる',
};

const ACTIVE_TARGET_LABELS: Readonly<Record<VehicleId, string>> = {
  ambulance: 'けがをした ひと',
  bulldozer: 'つぎの がれき',
  excavator: 'つぎの つち',
  'fire-truck': '火',
  police: 'つぎの ゲート',
};

/** 完了IDを飛ばし、定義順で最初の未完了対象位置を返す。 */
function findNextTargetPosition(
  targets: readonly { readonly id: string; readonly position: WorldPoint }[],
  completed: readonly { readonly completed?: boolean; readonly cleared?: boolean; readonly id: string }[],
): WorldPoint {
  const completedIds = new Set(
    completed
      .filter(({ completed: isCompleted, cleared }) => isCompleted === true || cleared === true)
      .map(({ id }) => id),
  );
  return targets.find(({ id }) => !completedIds.has(id))?.position
    ?? targets[0]?.position
    ?? GARAGE_POSITION;
}

/** 選択車種の現在仕事から、次に向かうべき実ターゲット位置を解決する。 */
function resolveActiveTargetPosition(snapshot: VehicleMissionCoordinatorSnapshot): WorldPoint {
  if (snapshot.selectedVehicleId === 'fire-truck') {
    return snapshot.currentJobs.fire.sprayTarget;
  }
  if (snapshot.selectedVehicleId === 'bulldozer') {
    return findNextTargetPosition(
      snapshot.currentJobs.bulldozer.debris,
      snapshot.bulldozer.debris,
    );
  }
  if (snapshot.selectedVehicleId === 'excavator') {
    return findNextTargetPosition(
      snapshot.currentJobs.excavator.targets,
      snapshot.excavator.targets,
    );
  }
  if (snapshot.selectedVehicleId === 'ambulance') {
    return findNextTargetPosition(
      snapshot.currentJobs.ambulance.targets,
      snapshot.ambulance.targets,
    );
  }
  return findNextTargetPosition(
    snapshot.currentJobs.police.targets,
    snapshot.police.targets,
  );
}

/** coordinator snapshotを対象・操作・達成数が一読できる幼児向け案内へ変換する。 */
export function buildMissionGuidance(
  snapshot: VehicleMissionCoordinatorSnapshot,
): VehicleMissionGuidance {
  const { mission, selectedVehicleId } = snapshot;
  const completionLabel = `クリア ${mission.progress.current}/${mission.progress.target}`;
  const returningToGarage = mission.phase === 'celebrating' || mission.phase === 'freeRoam';

  if (returningToGarage) {
    return {
      completionLabel,
      instructionLabel: 'しゃこへもどると つぎのおしごと',
      targetLabel: 'ちゅうおうしゃこ',
      targetPosition: GARAGE_POSITION,
    };
  }

  return {
    completionLabel,
    instructionLabel: ACTIVE_INSTRUCTIONS[selectedVehicleId],
    targetLabel: ACTIVE_TARGET_LABELS[selectedVehicleId],
    targetPosition: resolveActiveTargetPosition(snapshot),
  };
}

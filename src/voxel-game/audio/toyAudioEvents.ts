import type { VehicleMissionSnapshot } from '../domain/VehicleMissionCoordinator';
import type { VehicleId } from '../domain/vehicleDefinitions';

/** mission差分から生成する短い玩具音cue。 */
export type ToyAudioCue = 'vehicle-switch' | 'target-complete' | 'mission-complete';

/** audio event判定に必要なcoordinator snapshotの最小構造。 */
export interface ToyAudioEventSnapshot {
  readonly mission: Pick<
    VehicleMissionSnapshot,
    'jobCycle' | 'jobId' | 'phase' | 'progress'
  >;
  readonly selectedVehicleId: VehicleId;
}

/** 前後snapshotから乗り換え、対象完了、仕事完了を重複なしで導出する。 */
export function deriveToyAudioEvents(
  previous: ToyAudioEventSnapshot,
  current: ToyAudioEventSnapshot,
): readonly ToyAudioCue[] {
  if (previous.selectedVehicleId !== current.selectedVehicleId) return ['vehicle-switch'];
  if (
    previous.mission.jobCycle !== current.mission.jobCycle
    || previous.mission.jobId !== current.mission.jobId
  ) return [];

  const events: ToyAudioCue[] = [];
  if (current.mission.progress.current > previous.mission.progress.current) {
    events.push('target-complete');
  }
  if (previous.mission.phase !== 'celebrating' && current.mission.phase === 'celebrating') {
    events.push('mission-complete');
  }
  return events;
}

/** 対象／仕事完了へだけ短いtouch振動patternを割り当てる。 */
export function getToyVibrationPattern(cue: ToyAudioCue): number[] | null {
  if (cue === 'target-complete') return [22];
  if (cue === 'mission-complete') return [35, 24, 65];
  return null;
}

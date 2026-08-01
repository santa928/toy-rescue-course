import { describe, expect, it } from 'vitest';
import type { VehicleMissionCoordinatorSnapshot } from '../voxel-game/domain/VehicleMissionCoordinator';
import {
  deriveToyAudioEvents,
  getToyVibrationPattern,
  type ToyAudioEventSnapshot,
} from '../voxel-game/audio/toyAudioEvents';

/** audio event判定に必要な最小mission snapshotを返す。 */
function snapshot(
  overrides: {
    readonly current?: number;
    readonly jobCycle?: number;
    readonly jobId?: VehicleMissionCoordinatorSnapshot['mission']['jobId'];
    readonly phase?: VehicleMissionCoordinatorSnapshot['mission']['phase'];
    readonly selectedVehicleId?: VehicleMissionCoordinatorSnapshot['selectedVehicleId'];
    readonly target?: number;
  } = {},
): ToyAudioEventSnapshot {
  return {
    mission: {
      jobCycle: overrides.jobCycle ?? 1,
      jobId: overrides.jobId ?? 'fire-side',
      phase: overrides.phase ?? 'active',
      progress: {
        current: overrides.current ?? 0,
        target: overrides.target ?? 3,
      },
    },
    selectedVehicleId: overrides.selectedVehicleId ?? 'fire-truck',
  };
}

describe('deriveToyAudioEvents', () => {
  it('同じsnapshotではeventを重複させない', () => {
    const current = snapshot();
    expect(deriveToyAudioEvents(current, current)).toEqual([]);
  });

  it('車両変更時は乗り換えだけを通知し、別仕事の進捗差を誤検出しない', () => {
    expect(deriveToyAudioEvents(
      snapshot({ current: 2 }),
      snapshot({ current: 0, jobId: 'debris-north', selectedVehicleId: 'bulldozer' }),
    )).toEqual(['vehicle-switch']);
  });

  it('同じ仕事の進捗増加を対象完了として1回通知する', () => {
    expect(deriveToyAudioEvents(
      snapshot({ current: 0 }),
      snapshot({ current: 1 }),
    )).toEqual(['target-complete']);
  });

  it('celebratingへの遷移は最終対象と仕事完了を順番に通知する', () => {
    expect(deriveToyAudioEvents(
      snapshot({ current: 2, phase: 'active' }),
      snapshot({ current: 3, phase: 'celebrating' }),
    )).toEqual(['target-complete', 'mission-complete']);
  });

  it('job cycle変更に伴う進捗resetを完了扱いにしない', () => {
    expect(deriveToyAudioEvents(
      snapshot({ current: 3, phase: 'freeRoam' }),
      snapshot({ current: 0, jobCycle: 2, jobId: 'fire-window-left', phase: 'assigned' }),
    )).toEqual([]);
  });
});

describe('getToyVibrationPattern', () => {
  it('対象と仕事完了だけに短いpatternを割り当てる', () => {
    expect(getToyVibrationPattern('vehicle-switch')).toBeNull();
    expect(getToyVibrationPattern('target-complete')).toEqual([22]);
    expect(getToyVibrationPattern('mission-complete')).toEqual([35, 24, 65]);
  });
});

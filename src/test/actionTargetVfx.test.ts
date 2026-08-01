import { describe, expect, it } from 'vitest';
import { ActionTargetMissionRuntime } from '../voxel-game/domain/ActionTargetMissionRuntime';
import {
  ACTION_TARGET_ACCENT_POOL_SIZE,
  ACTION_TARGET_BODY_POOL_SIZE,
  ACTION_TARGET_PARTICLE_POOL_SIZE,
  ACTION_TARGET_ROUTE_POOL_SIZE,
  ACTION_TARGET_STAR_POOL_SIZE,
  createActionTargetVfxFrame,
  updateActionTargetVfxFrame,
  type ActionTargetVfxJob,
} from '../voxel-game/scene/actionTargetVfx';
import {
  ACTION_TARGET_MISSION_DRAW_CALLS,
  createActionTargetMissionTelemetry,
} from '../voxel-game/scene/ActionTargetMission';

const JOB: ActionTargetVfxJob = {
  kind: 'soil',
  routeMarkers: Array.from({ length: 7 }, (_, index) => [index, 0.25, 0] as const),
  targets: [
    { id: 'soil-a', position: [2, 0.7, 3], radius: 1.1 },
    { id: 'soil-b', position: [5, 0.7, 3], radius: 1.1 },
    { id: 'soil-c', position: [8, 0.7, 3], radius: 1.1 },
  ],
};

describe('action target VFX', () => {
  it('共通sceneを固定5 batchと非active telemetryで開始する', () => {
    expect(ACTION_TARGET_MISSION_DRAW_CALLS).toBe(5);
    expect(createActionTargetMissionTelemetry()).toMatchObject({
      activeParticleCount: 0,
      completedCount: 0,
      routeMarkerCount: 0,
      starVoxelCount: 0,
      targetAccentVoxelCount: 0,
      targetBodyVoxelCount: 0,
    });
  });

  it('最大3対象のbody、accent、particle、route、star slotを1回だけ確保する', () => {
    const frame = createActionTargetVfxFrame();

    expect(frame.targetBodies).toHaveLength(ACTION_TARGET_BODY_POOL_SIZE);
    expect(frame.targetAccents).toHaveLength(ACTION_TARGET_ACCENT_POOL_SIZE);
    expect(frame.particles).toHaveLength(ACTION_TARGET_PARTICLE_POOL_SIZE);
    expect(frame.routeMarkers).toHaveLength(ACTION_TARGET_ROUTE_POOL_SIZE);
    expect(frame.stars).toHaveLength(ACTION_TARGET_STAR_POOL_SIZE);
  });

  it('未完了の土山3個と7道しるべだけをactual座標へ表示する', () => {
    const frame = createActionTargetVfxFrame();
    const runtime = new ActionTargetMissionRuntime(JOB.targets.map(({ id }) => id));

    updateActionTargetVfxFrame(frame, runtime.getSnapshot(), new Float64Array(3).fill(-1), 0, JOB, true);

    expect(frame.targetBodies.filter(({ active }) => active)).toHaveLength(18);
    expect(frame.targetAccents.filter(({ active }) => active)).toHaveLength(9);
    expect(frame.routeMarkers.filter(({ active }) => active)).toHaveLength(7);
    expect(frame.particles.some(({ active }) => active)).toBe(false);
    expect(frame.stars.some(({ active }) => active)).toBe(false);
  });

  it('完了対象を隠して粒を流し、disabledでは全slotを非activeにする', () => {
    const frame = createActionTargetVfxFrame();
    const runtime = new ActionTargetMissionRuntime(JOB.targets.map(({ id }) => id));
    runtime.registerTargetCompletion('soil-a');
    const completionTimes = new Float64Array([-1, -1, -1]);
    completionTimes[0] = 1;

    updateActionTargetVfxFrame(frame, runtime.getSnapshot(), completionTimes, 1.2, JOB, true);
    expect(frame.targetBodies.filter(({ active }) => active)).toHaveLength(12);
    expect(frame.particles.some(({ active }) => active)).toBe(true);

    updateActionTargetVfxFrame(frame, runtime.getSnapshot(), completionTimes, 1.2, JOB, false);
    expect([
      ...frame.targetBodies,
      ...frame.targetAccents,
      ...frame.particles,
      ...frame.routeMarkers,
      ...frame.stars,
    ].some(({ active }) => active)).toBe(false);
  });

  it('celebrating中だけ3対象の中心へ12個の成功星を表示する', () => {
    const frame = createActionTargetVfxFrame();
    const runtime = new ActionTargetMissionRuntime(JOB.targets.map(({ id }) => id));
    for (const { id } of JOB.targets) runtime.registerTargetCompletion(id);

    updateActionTargetVfxFrame(frame, runtime.getSnapshot(), new Float64Array(3), 2, JOB, true);

    expect(frame.stars.filter(({ active }) => active)).toHaveLength(12);
    expect(frame.celebrationCenter).toEqual([5, 1.4, 3]);
  });
});

import { describe, expect, it } from 'vitest';
import { ActionTargetMissionRuntime } from '../voxel-game/domain/ActionTargetMissionRuntime';
import { VEHICLE_DEFINITIONS } from '../voxel-game/domain/vehicleDefinitions';
import {
  ACTION_TARGET_ACCENT_POOL_SIZE,
  ACTION_TARGET_BODY_POOL_SIZE,
  ACTION_TARGET_DYNAMIC_FRUSTUM_CULLED,
  ACTION_TARGET_PARTICLE_POOL_SIZE,
  ACTION_TARGET_ROUTE_POOL_SIZE,
  ACTION_TARGET_STAR_POOL_SIZE,
  createActionTargetVfxFrame,
  getCheckpointAccentOrder,
  getPatientGlyphKinds,
  getPatientRecoveryPose,
  updateActionTargetVfxFrame,
  type ActionTargetVfxJob,
} from '../voxel-game/scene/actionTargetVfx';
import {
  ACTION_TARGET_COMBINED_EMISSIVE_INTENSITY,
  ACTION_TARGET_MATERIAL_USES_GEOMETRY_VERTEX_COLORS,
  ACTION_TARGET_MISSION_DRAW_CALLS,
  createActionTargetInstanceColorArray,
  createActionTargetMissionTelemetry,
} from '../voxel-game/scene/ActionTargetMission';

const JOB: ActionTargetVfxJob = {
  routeMarkers: Array.from({ length: 7 }, (_, index) => [index, 0.25, 0] as const),
  targetKind: 'soil',
  targets: [
    { id: 'soil-a', position: [2, 0.7, 3], radius: 1.1 },
    { id: 'soil-b', position: [5, 0.7, 3], radius: 1.1 },
    { id: 'soil-c', position: [8, 0.7, 3], radius: 1.1 },
  ],
};

const PATIENT_JOB: ActionTargetVfxJob = {
  routeMarkers: Array.from({ length: 7 }, (_, index) => [0, 0.25, -index] as const),
  targetKind: 'patient',
  targets: [{ id: 'patient-a', position: [2, 0.7, -3], radius: 0.6 }],
};

const CHECKPOINT_JOB: ActionTargetVfxJob = {
  routeMarkers: Array.from({ length: 7 }, (_, index) => [0, 0.25, index] as const),
  targetKind: 'checkpoint',
  targets: [
    { id: 'checkpoint-a', position: [0, 0.7, 17], radius: 0.75 },
    { id: 'checkpoint-b', position: [0, 0.7, 24], radius: 0.75 },
    { id: 'checkpoint-c', position: [0, 0.7, 31], radius: 0.75 },
  ],
};

describe('action target VFX', () => {
  it('共通sceneを固定2 batchと非active telemetryで開始する', () => {
    expect(ACTION_TARGET_MISSION_DRAW_CALLS).toBe(2);
    expect(ACTION_TARGET_COMBINED_EMISSIVE_INTENSITY).toBe(0.08);
    expect(ACTION_TARGET_DYNAMIC_FRUSTUM_CULLED).toBe(false);
    expect(createActionTargetMissionTelemetry()).toMatchObject({
      activeParticleCount: 0,
      completedCount: 0,
      routeMarkerCount: 0,
      starVoxelCount: 0,
      targetAccentVoxelCount: 0,
      targetBodyVoxelCount: 0,
    });
  });

  it('後から現れるparticleも黒化しない初期instance colorを持つ', () => {
    const colors = createActionTargetInstanceColorArray(ACTION_TARGET_PARTICLE_POOL_SIZE);

    expect(colors).toHaveLength(ACTION_TARGET_PARTICLE_POOL_SIZE * 3);
    expect([...colors].every((component) => component === 1)).toBe(true);
    expect(ACTION_TARGET_MATERIAL_USES_GEOMETRY_VERTEX_COLORS).toBe(false);
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

  it('土山接触中は9粒をbucketへ吸引し、hold進捗で上段から土山を縮める', () => {
    const frame = createActionTargetVfxFrame();
    const runtime = new ActionTargetMissionRuntime(JOB.targets.map(({ id }) => id));
    const completionTimes = new Float64Array(3).fill(-1);

    updateActionTargetVfxFrame(
      frame,
      runtime.getSnapshot(),
      completionTimes,
      0.4,
      JOB,
      true,
    );
    const initialScaleY = frame.targetBodies
      .filter(({ sourceIndex }) => sourceIndex === 0)
      .reduce((sum, { scale }) => sum + scale[1], 0);

    updateActionTargetVfxFrame(
      frame,
      runtime.getSnapshot(),
      completionTimes,
      0.6,
      JOB,
      true,
      {
        actionCycleProgress: 0.45,
        contactPoint: [3.2, 0.85, 3],
        forward: [1, 0, 0],
        holdProgress: 0.6,
        sourceIndex: 0,
      },
    );

    expect(frame.particles.filter(({ active, sourceIndex }) => (
      active && sourceIndex === 0
    )).length).toBeGreaterThan(6);
    expect(frame.particles.filter(({ active, sourceIndex }) => (
      active && sourceIndex !== 0
    ))).toHaveLength(0);
    const dugScaleY = frame.targetBodies
      .filter(({ sourceIndex }) => sourceIndex === 0)
      .reduce((sum, { scale }) => sum + scale[1], 0);
    expect(dugScaleY).toBeLessThan(initialScaleY);
  });

  it('掘削cycle後半は土粒をbucketから車体横へ放物線で運ぶ', () => {
    const frame = createActionTargetVfxFrame();
    const runtime = new ActionTargetMissionRuntime(JOB.targets.map(({ id }) => id));

    updateActionTargetVfxFrame(
      frame,
      runtime.getSnapshot(),
      new Float64Array(3).fill(-1),
      0.7,
      JOB,
      true,
      {
        actionCycleProgress: 0.75,
        contactPoint: [3.2, 0.85, 3],
        forward: [1, 0, 0],
        holdProgress: 0.75,
        sourceIndex: 0,
      },
    );

    const particles = frame.particles.filter(({ active }) => active);
    expect(particles.length).toBeGreaterThan(6);
    expect(particles.some(({ position }) => position[1] > 1)).toBe(true);
    expect(particles.some(({ position }) => position[2] !== 3)).toBe(true);
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

  it('患者は手当前に横たわり、完了後は粒を出しながら起き上がって残る', () => {
    const frame = createActionTargetVfxFrame();
    const runtime = new ActionTargetMissionRuntime(['patient-a']);
    const completionTimes = new Float64Array([-1, -1, -1]);

    updateActionTargetVfxFrame(frame, runtime.getSnapshot(), completionTimes, 1, PATIENT_JOB, true);
    const lyingHeadY = frame.targetBodies[0].position[1];
    expect(frame.targetBodies.filter(({ active }) => active)).toHaveLength(6);

    runtime.registerTargetCompletion('patient-a');
    completionTimes[0] = 1;
    updateActionTargetVfxFrame(frame, runtime.getSnapshot(), completionTimes, 1.8, PATIENT_JOB, true);

    expect(frame.targetBodies.filter(({ active }) => active)).toHaveLength(6);
    expect(frame.targetBodies[0].position[1]).toBeGreaterThan(lyingHeadY);
    expect(frame.particles.some(({ active }) => active)).toBe(true);
  });

  it('手当てhold中は患者周囲の赤白10粒ringを0.2から1.8へ上げる', () => {
    const frame = createActionTargetVfxFrame();
    const runtime = new ActionTargetMissionRuntime(['patient-a']);

    updateActionTargetVfxFrame(
      frame,
      runtime.getSnapshot(),
      new Float64Array(3).fill(-1),
      0.7,
      PATIENT_JOB,
      true,
      {
        actionCycleProgress: 0.7,
        contactPoint: [3, 0.85, -3],
        forward: [1, 0, 0],
        holdProgress: 0.7,
        sourceIndex: 0,
      },
    );

    const ring = frame.particles.filter(({ active }) => active);
    expect(ring).toHaveLength(10);
    expect(ring.every(({ position }) => position[1] > PATIENT_JOB.targets[0].position[1] + 0.2))
      .toBe(true);
    expect(getPatientGlyphKinds(0.7)).toEqual(expect.arrayContaining(['cross', 'heart']));
  });

  it('患者は完了直後0.92倍へ縮み、赤白heart／crossを出して0.65秒後に立つ', () => {
    expect(getPatientRecoveryPose(true, 1, 1.06)).toMatchObject({
      rise: 0,
      scaleY: 0.92,
    });
    expect(getPatientRecoveryPose(true, 1, 1.65)).toEqual({ rise: 1, scaleY: 1 });

    const frame = createActionTargetVfxFrame();
    const runtime = new ActionTargetMissionRuntime(['patient-a']);
    runtime.registerTargetCompletion('patient-a');
    const completionTimes = new Float64Array([1, -1, -1]);
    updateActionTargetVfxFrame(
      frame,
      runtime.getSnapshot(),
      completionTimes,
      1.06,
      PATIENT_JOB,
      true,
    );

    expect(frame.particles.filter(({ active }) => active)).toHaveLength(10);
    expect(new Set(frame.particles.filter(({ active }) => active)
      .map(({ position }) => Math.round(position[0] * 10) / 10)).size).toBeGreaterThan(3);
  });

  it('巡回門3つを赤青accent付きで表示し、通過済み門だけ粒へ変える', () => {
    const frame = createActionTargetVfxFrame();
    const runtime = new ActionTargetMissionRuntime(CHECKPOINT_JOB.targets.map(({ id }) => id));
    const completionTimes = new Float64Array([-1, -1, -1]);

    updateActionTargetVfxFrame(
      frame,
      runtime.getSnapshot(),
      completionTimes,
      1,
      CHECKPOINT_JOB,
      true,
    );
    expect(frame.targetBodies.filter(({ active }) => active)).toHaveLength(18);
    expect(frame.targetAccents.filter(({ active }) => active)).toHaveLength(9);

    const leftPost = frame.targetBodies[0];
    const rightPost = frame.targetBodies[1];
    const gateInnerWidth = (
      rightPost.position[0] - rightPost.scale[0] / 2
      - (leftPost.position[0] + leftPost.scale[0] / 2)
    );
    const police = VEHICLE_DEFINITIONS.find(({ id }) => id === 'police');
    expect(police).toBeDefined();
    const policeWidth = (police?.collider.halfExtents[0] ?? 0) * 2;
    expect(gateInnerWidth).toBeGreaterThan(policeWidth);

    runtime.registerTargetCompletion('checkpoint-a');
    completionTimes[0] = 1;
    updateActionTargetVfxFrame(
      frame,
      runtime.getSnapshot(),
      completionTimes,
      1.2,
      CHECKPOINT_JOB,
      true,
    );
    expect(frame.targetBodies.filter(({ active }) => active)).toHaveLength(12);
    expect(frame.particles.some(({ active }) => active)).toBe(true);
  });

  it('巡回門はhold進捗に合わせて3つのaccentを入口から中央へ順に点灯する', () => {
    expect(getCheckpointAccentOrder(0)).toEqual([]);
    expect(getCheckpointAccentOrder(0.34)).toEqual([0]);
    expect(getCheckpointAccentOrder(0.6)).toEqual([0, 1]);
    expect(getCheckpointAccentOrder(1)).toEqual([0, 1, 2]);

    const frame = createActionTargetVfxFrame();
    const runtime = new ActionTargetMissionRuntime(CHECKPOINT_JOB.targets.map(({ id }) => id));
    updateActionTargetVfxFrame(
      frame,
      runtime.getSnapshot(),
      new Float64Array(3).fill(-1),
      0.15,
      CHECKPOINT_JOB,
      true,
      {
        actionCycleProgress: 0.3,
        contactPoint: [0, 0.7, 16.7],
        forward: [0, 0, 1],
        holdProgress: 0.6,
        sourceIndex: 0,
      },
    );

    const firstGate = frame.targetAccents.filter(({ sourceIndex }) => sourceIndex === 0);
    expect(firstGate[0].scale[0]).toBeGreaterThan(firstGate[2].scale[0]);
    expect(firstGate[1].scale[0]).toBeGreaterThan(firstGate[2].scale[0]);
  });

  it('巡回門完了時は赤青10粒が左右対称のarchへ広がり1秒で白へ収束する', () => {
    const frame = createActionTargetVfxFrame();
    const runtime = new ActionTargetMissionRuntime(CHECKPOINT_JOB.targets.map(({ id }) => id));
    runtime.registerTargetCompletion('checkpoint-a');
    const completionTimes = new Float64Array([1, -1, -1]);

    updateActionTargetVfxFrame(
      frame,
      runtime.getSnapshot(),
      completionTimes,
      1.1,
      CHECKPOINT_JOB,
      true,
    );
    const earlyArch = frame.particles.filter(({ active, sourceIndex }) => (
      active && sourceIndex === 0
    ));
    expect(earlyArch).toHaveLength(10);
    expect(earlyArch.some(({ position }) => position[0] < -1)).toBe(true);
    expect(earlyArch.some(({ position }) => position[0] > 1)).toBe(true);
    expect(Math.max(...earlyArch.map(({ position }) => position[1]))).toBeGreaterThan(2.4);
    expect(earlyArch.every(({ colorMixToWhite }) => colorMixToWhite < 0.2)).toBe(true);

    updateActionTargetVfxFrame(
      frame,
      runtime.getSnapshot(),
      completionTimes,
      1.9,
      CHECKPOINT_JOB,
      true,
    );
    expect(frame.particles.filter(({ active, sourceIndex }) => (
      active && sourceIndex === 0
    )).every(({ colorMixToWhite }) => colorMixToWhite > 0.8)).toBe(true);
  });
});

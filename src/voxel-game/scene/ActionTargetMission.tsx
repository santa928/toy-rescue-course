import { useRef } from 'react';
import type { MutableRefObject, ReactElement, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type {
  ActionTargetMissionRuntime,
  ActionTargetMissionSnapshot,
} from '../domain/ActionTargetMissionRuntime';
import {
  advanceActionTargetHold,
  getActionTargetContactPoint,
  isActionTargetContact,
  type ActionTargetInteraction,
} from '../domain/actionTargetContact';
import type { DriveCommand } from '../input/controlState';
import type { VehicleTelemetryRef } from './VehicleController';
import {
  ACTION_TARGET_ACCENT_POOL_SIZE,
  ACTION_TARGET_BODY_POOL_SIZE,
  ACTION_TARGET_PARTICLE_POOL_SIZE,
  ACTION_TARGET_ROUTE_POOL_SIZE,
  ACTION_TARGET_STAR_POOL_SIZE,
  createActionTargetVfxFrame,
  updateActionTargetVfxFrame,
  type ActionTargetKind,
  type ActionTargetVfxFrame,
  type ActionTargetVfxJob,
  type ActionTargetVoxelTransform,
} from './actionTargetVfx';

export const ACTION_TARGET_MISSION_DRAW_CALLS = 5;

/** 共通sceneが読む仕事ID、対象、接触条件。 */
export interface ActionTargetMissionJob extends ActionTargetVfxJob {
  readonly id: string;
  readonly interaction: ActionTargetInteraction;
}

/** text telemetryへ公開する共通仕事VFXのactual固定pool状態。 */
export interface ActionTargetMissionTelemetry {
  activeParticleCount: number;
  readonly contactPoint: [number, number, number];
  completedCount: number;
  readonly frame: ActionTargetVfxFrame;
  readonly holdMilliseconds: Float64Array;
  routeMarkerCount: number;
  starVoxelCount: number;
  targetAccentVoxelCount: number;
  targetBodyVoxelCount: number;
}

export type ActionTargetMissionTelemetryRef = MutableRefObject<ActionTargetMissionTelemetry>;

interface ActionTargetMissionProps {
  readonly commandRef: RefObject<DriveCommand>;
  readonly enabled: boolean;
  readonly job: ActionTargetMissionJob;
  readonly registerTargetCompletion: (id: string) => boolean;
  readonly runtime: ActionTargetMissionRuntime;
  readonly snapshotRef: MutableRefObject<ActionTargetMissionSnapshot>;
  readonly telemetryRef: ActionTargetMissionTelemetryRef;
  readonly vehicleTelemetryRef: VehicleTelemetryRef;
}

const UNIT_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const BODY_COLORS: Readonly<Record<ActionTargetKind, string>> = {
  checkpoint: '#27344c',
  patient: '#f3eee3',
  soil: '#9a5d2f',
};
const ACCENT_COLORS: Readonly<Record<ActionTargetKind, readonly [string, string]>> = {
  checkpoint: ['#e33a32', '#1769ff'],
  patient: ['#d92d24', '#f5b8b3'],
  soil: ['#d89a32', '#858b94'],
};
const ACCENT_INSTANCE_COLORS: Readonly<Record<
  ActionTargetKind,
  readonly [THREE.Color, THREE.Color]
>> = {
  checkpoint: [new THREE.Color(ACCENT_COLORS.checkpoint[0]), new THREE.Color(ACCENT_COLORS.checkpoint[1])],
  patient: [new THREE.Color(ACCENT_COLORS.patient[0]), new THREE.Color(ACCENT_COLORS.patient[1])],
  soil: [new THREE.Color(ACCENT_COLORS.soil[0]), new THREE.Color(ACCENT_COLORS.soil[1])],
};
const PARTICLE_COLORS: Readonly<Record<ActionTargetKind, string>> = {
  checkpoint: '#8ec5ff',
  patient: '#ffffff',
  soil: '#b8743c',
};
const ROUTE_COLORS: Readonly<Record<ActionTargetKind, string>> = {
  checkpoint: '#4a9cff',
  patient: '#ef5b55',
  soil: '#f59e0b',
};

/** 外部refへ渡せる、全固定slotを確保済みの初期telemetryを返す。 */
export function createActionTargetMissionTelemetry(): ActionTargetMissionTelemetry {
  return {
    activeParticleCount: 0,
    completedCount: 0,
    contactPoint: [0, -40, 0],
    frame: createActionTargetVfxFrame(),
    holdMilliseconds: new Float64Array(3),
    routeMarkerCount: 0,
    starVoxelCount: 0,
    targetAccentVoxelCount: 0,
    targetBodyVoxelCount: 0,
  };
}

/** 固定transform群を1つのInstancedMeshへin-place転送する。 */
function applyTransforms(
  mesh: THREE.InstancedMesh | null,
  transforms: readonly ActionTargetVoxelTransform[],
  matrix: THREE.Matrix4,
  colors: readonly [THREE.Color, THREE.Color] | null = null,
): void {
  if (!mesh) return;
  let instanceIndex = 0;
  for (const transform of transforms) {
    if (!transform.active) continue;
    matrix.makeScale(transform.scale[0], transform.scale[1], transform.scale[2]);
    matrix.setPosition(transform.position[0], transform.position[1], transform.position[2]);
    mesh.setMatrixAt(instanceIndex, matrix);
    if (colors) mesh.setColorAt(instanceIndex, colors[transform.slot % 2]);
    instanceIndex += 1;
  }
  mesh.count = instanceIndex;
  mesh.instanceMatrix.needsUpdate = true;
  if (colors && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** 固定slot群を1つのInstancedMeshとして描画する。 */
function VoxelPool({
  color,
  count,
  emissive = false,
  meshRef,
  vertexColors = false,
}: {
  readonly color: string;
  readonly count: number;
  readonly emissive?: boolean;
  readonly meshRef: RefObject<THREE.InstancedMesh | null>;
  readonly vertexColors?: boolean;
}): ReactElement {
  return (
    <instancedMesh args={[UNIT_GEOMETRY, undefined, count]} dispose={null} ref={meshRef}>
      <meshLambertMaterial
        color={color}
        emissive={emissive ? color : undefined}
        emissiveIntensity={emissive ? 0.22 : 0}
        vertexColors={vertexColors}
      />
    </instancedMesh>
  );
}

/** 追加3車種の対象、粒、道しるべ、成功星を固定5 batchで描画する。 */
export function ActionTargetMission({
  commandRef,
  enabled,
  job,
  registerTargetCompletion,
  runtime,
  snapshotRef,
  telemetryRef,
  vehicleTelemetryRef,
}: ActionTargetMissionProps): ReactElement {
  const targetBodyRef = useRef<THREE.InstancedMesh>(null);
  const targetAccentRef = useRef<THREE.InstancedMesh>(null);
  const particleRef = useRef<THREE.InstancedMesh>(null);
  const routeRef = useRef<THREE.InstancedMesh>(null);
  const starRef = useRef<THREE.InstancedMesh>(null);
  const matrixRef = useRef<THREE.Matrix4 | null>(null);
  if (matrixRef.current === null) matrixRef.current = new THREE.Matrix4();
  const completionTimesRef = useRef<Float64Array | null>(null);
  if (completionTimesRef.current === null) {
    completionTimesRef.current = new Float64Array(3);
    completionTimesRef.current.fill(-1);
  }
  const activeJobIdRef = useRef(job.id);

  useFrame(({ clock }, deltaSeconds) => {
    const completionTimes = completionTimesRef.current;
    const matrix = matrixRef.current;
    if (!completionTimes || !matrix) return;
    const telemetry = telemetryRef.current;
    if (activeJobIdRef.current !== job.id) {
      activeJobIdRef.current = job.id;
      completionTimes.fill(-1);
      telemetry.holdMilliseconds.fill(0);
    }

    let snapshot = snapshotRef.current;
    const vehicle = vehicleTelemetryRef.current;
    const contactPoint = getActionTargetContactPoint(
      vehicle,
      job.interaction.forwardOffset,
      telemetry.contactPoint,
    );
    for (let index = 0; index < job.targets.length; index += 1) {
      const source = job.targets[index];
      const state = snapshot.targets[index];
      if (!source || !state) continue;
      if (!state.completed) completionTimes[index] = -1;
      else if (completionTimes[index] < 0) completionTimes[index] = clock.elapsedTime;

      const contactActive = enabled && !state.completed && isActionTargetContact({
        actionActive: commandRef.current.primaryAction,
        contactPoint,
        interaction: job.interaction,
        speed: vehicle.speed,
        targetPosition: source.position,
        targetRadius: source.radius,
      });
      telemetry.holdMilliseconds[index] = advanceActionTargetHold(
        telemetry.holdMilliseconds[index],
        contactActive,
        deltaSeconds * 1_000,
        job.interaction.holdDurationMs,
      );
      if (telemetry.holdMilliseconds[index] < job.interaction.holdDurationMs) continue;
      if (registerTargetCompletion(source.id)) {
        completionTimes[index] = clock.elapsedTime;
        telemetry.holdMilliseconds[index] = 0;
        snapshot = runtime.getSnapshot();
        snapshotRef.current = snapshot;
      }
    }

    updateActionTargetVfxFrame(
      telemetry.frame,
      snapshot,
      completionTimes,
      clock.elapsedTime,
      job,
      enabled,
    );
    applyTransforms(targetBodyRef.current, telemetry.frame.targetBodies, matrix);
    applyTransforms(
      targetAccentRef.current,
      telemetry.frame.targetAccents,
      matrix,
      ACCENT_INSTANCE_COLORS[job.targetKind],
    );
    applyTransforms(particleRef.current, telemetry.frame.particles, matrix);
    applyTransforms(routeRef.current, telemetry.frame.routeMarkers, matrix);
    applyTransforms(starRef.current, telemetry.frame.stars, matrix);

    telemetry.completedCount = snapshot.completedCount;
    telemetry.activeParticleCount = 0;
    telemetry.routeMarkerCount = 0;
    telemetry.starVoxelCount = 0;
    telemetry.targetAccentVoxelCount = 0;
    telemetry.targetBodyVoxelCount = 0;
    for (const transform of telemetry.frame.particles) {
      telemetry.activeParticleCount += Number(transform.active);
    }
    for (const transform of telemetry.frame.routeMarkers) {
      telemetry.routeMarkerCount += Number(transform.active);
    }
    for (const transform of telemetry.frame.stars) {
      telemetry.starVoxelCount += Number(transform.active);
    }
    for (const transform of telemetry.frame.targetAccents) {
      telemetry.targetAccentVoxelCount += Number(transform.active);
    }
    for (const transform of telemetry.frame.targetBodies) {
      telemetry.targetBodyVoxelCount += Number(transform.active);
    }
  });

  return (
    <group>
      <VoxelPool
        color={BODY_COLORS[job.targetKind]}
        count={ACTION_TARGET_BODY_POOL_SIZE}
        meshRef={targetBodyRef}
      />
      <VoxelPool
        color="#ffffff"
        count={ACTION_TARGET_ACCENT_POOL_SIZE}
        meshRef={targetAccentRef}
        vertexColors
      />
      <VoxelPool
        color={PARTICLE_COLORS[job.targetKind]}
        count={ACTION_TARGET_PARTICLE_POOL_SIZE}
        meshRef={particleRef}
      />
      <VoxelPool
        color={ROUTE_COLORS[job.targetKind]}
        count={ACTION_TARGET_ROUTE_POOL_SIZE}
        emissive
        meshRef={routeRef}
      />
      <VoxelPool
        color="#fff1a6"
        count={ACTION_TARGET_STAR_POOL_SIZE}
        emissive
        meshRef={starRef}
      />
    </group>
  );
}

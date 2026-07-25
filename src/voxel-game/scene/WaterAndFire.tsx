import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  CuboidCollider,
  RigidBody,
  type RapierCollider,
} from '@react-three/rapier';
import * as THREE from 'three';
import type { VoxelGameRuntime, VoxelGameSnapshot } from '../domain/VoxelGameRuntime';
import { resolveSprayTarget } from '../domain/sprayTargeting';
import type { DriveCommand } from '../input/controlState';
import type { VehicleTelemetry, VehicleTelemetryRef } from './VehicleController';
import {
  createWaterFlowFrame,
  WATER_INSTANCE_COUNT,
  type WaterInstanceTransform,
} from './waterFlow';
import { scaleToHalfExtents } from './worldCollisionLayout';
import { FIRE_POSITION } from './worldLayout';

export interface VoxelBox {
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
}

interface StaticVoxelBatchProps {
  readonly boxes: readonly VoxelBox[];
  readonly color: string;
  readonly emissive?: string;
}

interface WaterAndFireProps {
  readonly commandRef: RefObject<DriveCommand>;
  readonly missionTelemetryRef: MissionTelemetryRef;
  readonly runtime: VoxelGameRuntime;
  readonly telemetryRef: VehicleTelemetryRef;
}

interface FireHazardColliderProps {
  readonly enabled: boolean;
}

/**
 * 描画とtext telemetryで共有する放水照準・VFX状態。elapsed値は秒単位で、
 * stream/splashのpure transformを同一時刻から再現するために保持する。
 */
export interface MissionTelemetry {
  readonly direction: readonly [number, number, number];
  readonly distance: number;
  readonly nozzleOrigin: readonly [number, number, number];
  readonly sprayActive: boolean;
  readonly sprayElapsedSeconds: number;
  readonly sprayOnFire: boolean;
  readonly splashElapsedSeconds: number;
  readonly targeted: boolean;
}

export type MissionTelemetryRef = React.MutableRefObject<MissionTelemetry>;

interface MissionVisualState {
  readonly celebrating: boolean;
  readonly fireHazardEnabled: boolean;
  readonly fireLayerCount: number;
  readonly routeVisible: boolean;
}

/** VFX時計を進める入力。elapsed値とdeltaは秒単位で扱う。 */
export interface WaterVfxClockInput {
  readonly deltaSeconds: number;
  readonly resetEvent: boolean;
  readonly sprayActive: boolean;
  readonly sprayElapsedSeconds: number;
  readonly sprayOnFire: boolean;
  readonly splashElapsedSeconds: number;
}

/** VFX描画とtext telemetryに書き戻す、秒単位の放水・飛沫経過時計。 */
export interface WaterVfxClock {
  readonly sprayElapsedSeconds: number;
  readonly splashElapsedSeconds: number;
}

const NOZZLE_FORWARD_OFFSET = 1.7;
const NOZZLE_HEIGHT = 2.15;
const WATER_TARGET_STOP_OFFSET = 1.9;
const WATER_SPLASH_CYCLE_SECONDS = 0.22;
const WATER_BLUE_INSTANCE_COUNT = 22;
const WATER_WHITE_INSTANCE_COUNT = WATER_INSTANCE_COUNT - WATER_BLUE_INSTANCE_COUNT;

const ROUTE_POSITIONS: readonly (readonly [number, number, number])[] = [
  [0, 0.26, 16.2], [3, 0.26, 16.2], [6, 0.26, 15], [9, 0.26, 15],
  [12, 0.26, 15], [15, 0.26, 13], [15, 0.26, 10], [15, 0.26, 7],
  [15, 0.26, 4], [15, 0.26, 1], [15, 0.26, -3], [14, 0.26, -8],
] as const;

export const ROUTE_BOXES: readonly VoxelBox[] = ROUTE_POSITIONS.map(([x, , z]) => ({
  position: [x, 0.26, z],
  scale: [0.62, 0.12, 0.62],
}));

export const FIRE_HAZARD_BOX: VoxelBox = {
  position: [12.9, 0.9, -9.1],
  scale: [1.2, 1.8, 1.2],
};

export const FIRE_LAYER_POSITIONS: readonly (readonly [number, number, number])[] = [
  [12.9, 0.75, -9.1],
  [12.95, 1.5, -9.02],
  [12.9, 2.15, -9.1],
];

export const FIRE_LAYER_BOXES: readonly VoxelBox[] = [
  { position: FIRE_LAYER_POSITIONS[0], scale: [1.15, 1.15, 1.15] },
  { position: FIRE_LAYER_POSITIONS[1], scale: [0.92, 1.25, 0.92] },
  { position: FIRE_LAYER_POSITIONS[2], scale: [0.68, 1.12, 0.68] },
];

export const CELEBRATION_STAR_CENTERS: readonly (readonly [number, number, number])[] = [
  [10.8, 1, -4], [8.5, 1.2, -4.4], [17, 1, -4.8],
  [10, 1.8, -5.2], [17.25, 3, -8], [14.8, 1.7, -6],
];

/** 5つのcubeで十字型の星を作る。 */
function createStarBoxes(centers: readonly (readonly [number, number, number])[]): readonly VoxelBox[] {
  return centers.flatMap(([x, y, z]) => [
    { position: [x, y, z], scale: [0.46, 0.46, 0.46] },
    { position: [x - 0.48, y, z], scale: [0.32, 0.32, 0.32] },
    { position: [x + 0.48, y, z], scale: [0.32, 0.32, 0.32] },
    { position: [x, y - 0.48, z], scale: [0.32, 0.32, 0.32] },
    { position: [x, y + 0.48, z], scale: [0.32, 0.32, 0.32] },
  ] as VoxelBox[]);
}

export const CELEBRATION_STAR_GROUPS: readonly (readonly VoxelBox[])[] = CELEBRATION_STAR_CENTERS
  .map((center) => createStarBoxes([center]));
const YELLOW_STAR_BOXES = CELEBRATION_STAR_GROUPS.filter((_, index) => index % 2 === 0).flat();
const WHITE_STAR_BOXES = CELEBRATION_STAR_GROUPS.filter((_, index) => index % 2 === 1).flat();

/** 有限な正の火勢だけを進入防止対象とする。 */
export function isFireHazardEnabled(fireIntensity: number): boolean {
  return Number.isFinite(fireIntensity) && fireIntensity > 0;
}

interface ColliderEnabledPort {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
}

/** 実Rapier colliderへenabled差分だけを反映する。 */
export function syncColliderEnabled(
  collider: ColliderEnabledPort,
  enabled: boolean,
): void {
  if (collider.isEnabled() !== enabled) collider.setEnabled(enabled);
}

/** 1個のfixed colliderを再利用し、低頻度な火勢変化だけをRapierへ同期する。 */
export function FireHazardCollider({ enabled }: FireHazardColliderProps): ReactElement {
  const colliderRef = useRef<RapierCollider>(null);

  useLayoutEffect(() => {
    const collider = colliderRef.current;
    if (collider) syncColliderEnabled(collider, enabled);
  }, [enabled]);

  return (
    <RigidBody colliders={false} type="fixed">
      <CuboidCollider
        args={scaleToHalfExtents(FIRE_HAZARD_BOX.scale)}
        position={FIRE_HAZARD_BOX.position}
        ref={colliderRef}
      />
    </RigidBody>
  );
}

/** 同色の静的cubeを1つのInstancedMeshへまとめる。 */
function StaticVoxelBatch({ boxes, color, emissive }: StaticVoxelBatchProps): ReactElement {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    boxes.forEach((box, index) => {
      position.fromArray(box.position);
      scale.fromArray(box.scale);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [boxes]);

  return (
    <instancedMesh args={[undefined, undefined, boxes.length]} ref={meshRef}>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial color={color} emissive={emissive} emissiveIntensity={emissive ? 0.5 : 0} />
    </instancedMesh>
  );
}

/** 連続値の火勢を仕様どおり0〜3層へ変換する。 */
export function getFireLayerCount(intensity: number): number {
  if (intensity > 0.66) return 3;
  if (intensity > 0.33) return 2;
  if (intensity > 0) return 1;
  return 0;
}

/** 車両telemetryからnozzle起点を作り、放水表示と消火signalを同じ照準結果へ束ねる。 */
export function resolveWaterAndFireFrame(
  telemetry: VehicleTelemetry,
  command: DriveCommand,
  sprayElapsedSeconds = 0,
  splashElapsedSeconds = 0,
): MissionTelemetry {
  const horizontalLength = Math.hypot(telemetry.forward[0], telemetry.forward[2]) || 1;
  const forward: readonly [number, number, number] = [
    telemetry.forward[0] / horizontalLength,
    0,
    telemetry.forward[2] / horizontalLength,
  ];
  const nozzleOrigin: readonly [number, number, number] = [
    telemetry.position[0] + forward[0] * NOZZLE_FORWARD_OFFSET,
    telemetry.position[1] + NOZZLE_HEIGHT,
    telemetry.position[2] + forward[2] * NOZZLE_FORWARD_OFFSET,
  ];
  const target = resolveSprayTarget(nozzleOrigin, forward, FIRE_POSITION);
  return {
    direction: target.direction,
    distance: target.distance,
    nozzleOrigin,
    sprayActive: command.spray,
    sprayElapsedSeconds,
    sprayOnFire: command.spray && target.targeted,
    splashElapsedSeconds,
    targeted: target.targeted,
  };
}

/** vehicle resetまたはfreeRoamからassignedへの任務開始でVFX時計をリセットする。 */
export function isWaterVfxResetEvent(
  previousResetCount: number,
  currentResetCount: number,
  previousMissionPhase: VoxelGameSnapshot['missionPhase'],
  currentMissionPhase: VoxelGameSnapshot['missionPhase'],
): boolean {
  return previousResetCount !== currentResetCount
    || (previousMissionPhase === 'freeRoam' && currentMissionPhase === 'assigned');
}

/** reset・放水・照準状態を加味して、描画用の2本のVFX時計を決定的に進める。 */
export function advanceWaterVfxClock(input: WaterVfxClockInput): WaterVfxClock {
  const sprayBaseSeconds = input.resetEvent ? 0 : input.sprayElapsedSeconds;
  const splashBaseSeconds = input.resetEvent ? 0 : input.splashElapsedSeconds;

  return {
    sprayElapsedSeconds: input.sprayActive ? sprayBaseSeconds + input.deltaSeconds : 0,
    splashElapsedSeconds: input.sprayOnFire
      ? (splashBaseSeconds + input.deltaSeconds) % WATER_SPLASH_CYCLE_SECONDS
      : 0,
  };
}

/** runtime snapshotからReactで切り替える低頻度な表示・衝突状態だけを取り出す。 */
function selectMissionVisualState(snapshot: VoxelGameSnapshot): MissionVisualState {
  return {
    celebrating: snapshot.missionPhase === 'celebrating',
    fireHazardEnabled: isFireHazardEnabled(snapshot.fireIntensity),
    fireLayerCount: getFireLayerCount(snapshot.fireIntensity),
    routeVisible: snapshot.routeVisible,
  };
}

/** targeted時は奥の判定座標を越えず、camera側のvisible fireで水を止める。 */
export function getWaterVisibleDistance(distance: number, targeted: boolean): number {
  return targeted
    ? Math.max(0, Math.min(6, distance - WATER_TARGET_STOP_OFFSET))
    : 6;
}

/** 色別の固定poolへ、水流pure transformをslot順に反映する。 */
function updateWaterBatch(
  mesh: THREE.InstancedMesh | null,
  color: WaterInstanceTransform['color'],
  instances: readonly WaterInstanceTransform[],
  sprayActive: boolean,
): void {
  if (!mesh) return;
  mesh.visible = sprayActive;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const colorInstances = instances.filter((instance) => instance.color === color);
  colorInstances.forEach((instance, index) => {
    position.fromArray(instance.position);
    scale.setScalar(instance.active ? instance.scale : 0);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

/** 純ボクセルの3段階炎、stream 24＋splash 8を2色固定poolで描く水、道しるべ、成功星を描画する。 */
export function WaterAndFire({
  commandRef,
  missionTelemetryRef,
  runtime,
  telemetryRef,
}: WaterAndFireProps): ReactElement {
  const [visualState, setVisualState] = useState(() => selectMissionVisualState(runtime.getSnapshot()));
  const blueWaterRef = useRef<THREE.InstancedMesh>(null);
  const whiteWaterRef = useRef<THREE.InstancedMesh>(null);
  const sprayElapsedRef = useRef(0);
  const splashElapsedRef = useRef(0);
  const previousResetCountRef = useRef<number | null>(null);
  const previousMissionPhaseRef = useRef<VoxelGameSnapshot['missionPhase'] | null>(null);

  useEffect(() => runtime.subscribe((snapshot) => {
    const next = selectMissionVisualState(snapshot);
    setVisualState((current) => (
      current.celebrating === next.celebrating
      && current.fireHazardEnabled === next.fireHazardEnabled
      && current.fireLayerCount === next.fireLayerCount
      && current.routeVisible === next.routeVisible
        ? current
        : next
    ));
  }), [runtime]);

  useFrame((_state, delta) => {
    const missionSnapshot = runtime.getSnapshot();
    const resetEvent = previousResetCountRef.current !== null && previousMissionPhaseRef.current !== null
      && isWaterVfxResetEvent(
        previousResetCountRef.current,
        telemetryRef.current.resetCount,
        previousMissionPhaseRef.current,
        missionSnapshot.missionPhase,
      );
    previousResetCountRef.current = telemetryRef.current.resetCount;
    previousMissionPhaseRef.current = missionSnapshot.missionPhase;

    const preview = resolveWaterAndFireFrame(telemetryRef.current, commandRef.current);
    const clock = advanceWaterVfxClock({
      deltaSeconds: delta,
      resetEvent,
      sprayActive: preview.sprayActive,
      sprayElapsedSeconds: sprayElapsedRef.current,
      sprayOnFire: preview.sprayOnFire,
      splashElapsedSeconds: splashElapsedRef.current,
    });
    sprayElapsedRef.current = clock.sprayElapsedSeconds;
    splashElapsedRef.current = clock.splashElapsedSeconds;
    const missionTelemetry = { ...preview, ...clock };
    const frame = createWaterFlowFrame({
      direction: missionTelemetry.direction,
      nozzleOrigin: missionTelemetry.nozzleOrigin,
      splashElapsedSeconds: missionTelemetry.splashElapsedSeconds,
      sprayActive: missionTelemetry.sprayActive,
      sprayElapsedSeconds: missionTelemetry.sprayElapsedSeconds,
      targeted: missionTelemetry.targeted,
      visibleDistance: getWaterVisibleDistance(missionTelemetry.distance, missionTelemetry.targeted),
    });
    missionTelemetryRef.current = missionTelemetry;
    runtime.setSignals({
      sprayActive: missionTelemetry.sprayActive,
      sprayOnFire: missionTelemetry.sprayOnFire,
    });
    updateWaterBatch(blueWaterRef.current, 'blue', frame.instances, missionTelemetry.sprayActive);
    updateWaterBatch(whiteWaterRef.current, 'white', frame.instances, missionTelemetry.sprayActive);
  }, -1);

  return (
    <group>
      <FireHazardCollider enabled={visualState.fireHazardEnabled} />
      {visualState.fireLayerCount >= 1 ? (
        <mesh position={FIRE_LAYER_BOXES[0].position}>
          <boxGeometry args={FIRE_LAYER_BOXES[0].scale} />
          <meshLambertMaterial color="#ffd23f" emissive="#ef7d22" emissiveIntensity={0.48} />
        </mesh>
      ) : null}
      {visualState.fireLayerCount >= 2 ? (
        <mesh position={FIRE_LAYER_BOXES[1].position}>
          <boxGeometry args={FIRE_LAYER_BOXES[1].scale} />
          <meshLambertMaterial color="#f47c20" emissive="#ef4c23" emissiveIntensity={0.42} />
        </mesh>
      ) : null}
      {visualState.fireLayerCount >= 3 ? (
        <mesh position={FIRE_LAYER_BOXES[2].position}>
          <boxGeometry args={FIRE_LAYER_BOXES[2].scale} />
          <meshLambertMaterial color="#ef4c23" emissive="#f47c20" emissiveIntensity={0.38} />
        </mesh>
      ) : null}
      <instancedMesh
        args={[undefined, undefined, WATER_BLUE_INSTANCE_COUNT]}
        frustumCulled={false}
        ref={blueWaterRef}
        visible={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color="#67c7df" emissive="#3ba6c4" emissiveIntensity={0.2} />
      </instancedMesh>
      <instancedMesh
        args={[undefined, undefined, WATER_WHITE_INSTANCE_COUNT]}
        frustumCulled={false}
        ref={whiteWaterRef}
        visible={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color="#f2fbff" />
      </instancedMesh>
      {visualState.routeVisible ? <StaticVoxelBatch boxes={ROUTE_BOXES} color="#ffd23f" emissive="#d49d16" /> : null}
      {visualState.celebrating ? (
        <group>
          <StaticVoxelBatch boxes={YELLOW_STAR_BOXES} color="#ffd23f" emissive="#d49d16" />
          <StaticVoxelBatch boxes={WHITE_STAR_BOXES} color="#fff8dc" />
        </group>
      ) : null}
    </group>
  );
}

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
  createWaterFlowPath,
  createWaterFlowFrame,
  WATER_INSTANCE_COUNT,
  type WaterFlowPath,
  type WaterInstanceTransform,
} from './waterFlow';
import {
  advanceFireVoxelElapsedSeconds,
  createFireVoxelFrame,
  FIRE_ROLE_CAPACITY,
  updateFireVoxelFrame,
  type FireVoxelFrame,
  type FireVoxelRole,
  type FireVoxelTransform,
} from './fireVfx';
import { scaleToHalfExtents } from './worldCollisionLayout';
import { FIRE_SPRAY_TARGET_POSITION } from './worldLayout';

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

/** 低頻度な火勢状態を常設Rapier colliderへ渡すcomponent入力。 */
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
  readonly waterPath: WaterFlowPath;
}

export type MissionTelemetryRef = React.MutableRefObject<MissionTelemetry>;

/** runtime購読からReactへ反映する低頻度な表示・hazard状態。 */
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

/** enabled差分同期に必要な実Rapier collider境界の最小契約。 */
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

/** 遅延attachと低頻度な火勢変化の両方を、常設する1個のfixed colliderへ同期する。 */
export function FireHazardCollider({ enabled }: FireHazardColliderProps): ReactElement {
  const colliderRef = useRef<RapierCollider>(null);

  useEffect(() => {
    const collider = colliderRef.current;
    if (collider) syncColliderEnabled(collider, enabled);
  }, [enabled]);

  return (
    <RigidBody colliders={false} type="fixed">
      <CuboidCollider
        args={scaleToHalfExtents(FIRE_HAZARD_BOX.scale)}
        position={FIRE_HAZARD_BOX.position}
        ref={(collider: RapierCollider | null) => {
          colliderRef.current = collider;
          if (collider) syncColliderEnabled(collider, enabled);
        }}
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

export type FireFrameUpdateMode = 'skip' | 'update' | 'zero';

/** 火勢段階から、matrix更新・消火時zero転送・継続停止をpureに判定する。 */
export function selectFireFrameUpdateMode(
  previousLayerCount: number,
  nextLayerCount: number,
): FireFrameUpdateMode {
  if (nextLayerCount > 0) return 'update';
  return previousLayerCount > 0 ? 'zero' : 'skip';
}

/** 炎3 batchが共有するThree.js計算object。component mount時に一度だけ作る。 */
export interface FireBatchScratch {
  readonly matrix: THREE.Matrix4;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  readonly scale: THREE.Vector3;
}

/** 炎matrix転送で再利用するscratch object群を作る。 */
export function createFireBatchScratch(): FireBatchScratch {
  return {
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
  };
}

/** 全18 transformから同色slotだけを固定batch順へ転送する。 */
export function updateFireBatch(
  mesh: THREE.InstancedMesh | null,
  role: FireVoxelRole,
  instances: readonly FireVoxelTransform[],
  scratch: FireBatchScratch,
): void {
  if (!mesh) return;
  let batchIndex = 0;
  let visible = false;

  for (const instance of instances) {
    if (instance.role !== role) continue;
    scratch.position.fromArray(instance.position);
    if (instance.active) {
      scratch.scale.fromArray(instance.scale);
    } else {
      scratch.scale.set(0, 0, 0);
    }
    scratch.matrix.compose(
      scratch.position,
      scratch.quaternion,
      scratch.scale,
    );
    mesh.setMatrixAt(batchIndex, scratch.matrix);
    visible ||= instance.active;
    batchIndex += 1;
  }
  mesh.visible = visible;
  mesh.instanceMatrix.needsUpdate = true;
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
  const target = resolveSprayTarget(nozzleOrigin, forward, FIRE_SPRAY_TARGET_POSITION);
  const waterPath = createWaterFlowPath({
    initialDirection: target.direction,
    nozzleOrigin,
    targetPosition: FIRE_SPRAY_TARGET_POSITION,
    targeted: target.targeted,
  });
  return {
    direction: target.direction,
    distance: target.distance,
    nozzleOrigin,
    sprayActive: command.spray,
    sprayElapsedSeconds,
    sprayOnFire: command.spray && target.targeted,
    splashElapsedSeconds,
    targeted: target.targeted,
    waterPath,
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
  const outerFireRef = useRef<THREE.InstancedMesh>(null);
  const middleFireRef = useRef<THREE.InstancedMesh>(null);
  const coreFireRef = useRef<THREE.InstancedMesh>(null);
  const fireElapsedRef = useRef(0);
  const fireFrameRef = useRef<FireVoxelFrame | null>(null);
  const fireBatchScratchRef = useRef<FireBatchScratch | null>(null);
  const previousFireLayerCountRef = useRef(0);
  const sprayElapsedRef = useRef(0);
  const splashElapsedRef = useRef(0);
  const previousResetCountRef = useRef<number | null>(null);
  const previousMissionPhaseRef = useRef<VoxelGameSnapshot['missionPhase'] | null>(null);
  const fireFrame = fireFrameRef.current
    ?? createFireVoxelFrame({ elapsedSeconds: 0, layerCount: 0 });
  const fireBatchScratch = fireBatchScratchRef.current ?? createFireBatchScratch();
  fireFrameRef.current = fireFrame;
  fireBatchScratchRef.current = fireBatchScratch;

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
    const fireLayerCount = getFireLayerCount(missionSnapshot.fireIntensity);
    const fireUpdateMode = selectFireFrameUpdateMode(
      previousFireLayerCountRef.current,
      fireLayerCount,
    );
    if (fireUpdateMode !== 'skip') {
      if (fireUpdateMode === 'update') {
        fireElapsedRef.current = advanceFireVoxelElapsedSeconds(
          fireElapsedRef.current,
          delta,
        );
      }
      updateFireVoxelFrame(
        fireFrame,
        fireElapsedRef.current,
        fireLayerCount,
      );
      updateFireBatch(
        outerFireRef.current,
        'outer',
        fireFrame.instances,
        fireBatchScratch,
      );
      updateFireBatch(
        middleFireRef.current,
        'middle',
        fireFrame.instances,
        fireBatchScratch,
      );
      updateFireBatch(
        coreFireRef.current,
        'core',
        fireFrame.instances,
        fireBatchScratch,
      );
    }
    previousFireLayerCountRef.current = fireLayerCount;
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
      path: missionTelemetry.waterPath,
      splashElapsedSeconds: missionTelemetry.splashElapsedSeconds,
      sprayActive: missionTelemetry.sprayActive,
      sprayElapsedSeconds: missionTelemetry.sprayElapsedSeconds,
      targeted: missionTelemetry.targeted,
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
      <instancedMesh
        args={[undefined, undefined, FIRE_ROLE_CAPACITY.outer]}
        frustumCulled={false}
        ref={outerFireRef}
        visible={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color="#ef3b24" emissive="#a51d16" emissiveIntensity={0.48} />
      </instancedMesh>
      <instancedMesh
        args={[undefined, undefined, FIRE_ROLE_CAPACITY.middle]}
        frustumCulled={false}
        ref={middleFireRef}
        visible={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color="#ff7a1a" emissive="#ef3b24" emissiveIntensity={0.55} />
      </instancedMesh>
      <instancedMesh
        args={[undefined, undefined, FIRE_ROLE_CAPACITY.core]}
        frustumCulled={false}
        ref={coreFireRef}
        visible={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color="#fff2a6" emissive="#ffb11b" emissiveIntensity={0.62} />
      </instancedMesh>
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

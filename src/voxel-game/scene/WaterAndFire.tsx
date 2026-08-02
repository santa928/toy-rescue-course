import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  CuboidCollider,
  RigidBody,
  type RapierCollider,
} from '@react-three/rapier';
import * as THREE from 'three';
import type { VoxelGameRuntime, VoxelGameSnapshot } from '../domain/VoxelGameRuntime';
import type { FireVehicleJobDefinition } from '../domain/vehicleJobs';
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
import {
  CELEBRATION_STAR_CENTER_POSITIONS,
  FIRE_POSITION,
  FIRE_ROUTE_MARKER_POSITIONS,
  FIRE_SPRAY_TARGET_POSITION,
} from './worldLayout';

export interface VoxelBox {
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
}

/** 火災照準点から導出したhazardと3層の炎の相対配置。 */
export interface FireAnchorLayout {
  readonly hazardBox: VoxelBox;
  readonly layerPositions: readonly (readonly [number, number, number])[];
}

/** 1件の消防仕事から描画・衝突・telemetryへ共有するscene配置。 */
export interface FireJobSceneLayout {
  readonly fireAnchorOffset: readonly [number, number, number];
  readonly firePosition: readonly [number, number, number];
  readonly guideBoxes: readonly VoxelBox[];
  readonly hazardBox: VoxelBox;
  readonly layerBoxes: readonly VoxelBox[];
  readonly layerPositions: readonly (readonly [number, number, number])[];
  readonly routeBoxes: readonly VoxelBox[];
  readonly starGroups: readonly (readonly VoxelBox[])[];
  readonly targetBeaconBoxes: readonly VoxelBox[];
  readonly whiteStarBoxes: readonly VoxelBox[];
  readonly yellowStarBoxes: readonly VoxelBox[];
}

interface StaticVoxelBatchProps {
  readonly boxes: readonly VoxelBox[];
  readonly color: string;
  readonly emissive?: string;
}

interface WaterAndFireProps {
  readonly commandRef: RefObject<DriveCommand>;
  readonly enabled: boolean;
  readonly job: FireVehicleJobDefinition;
  readonly missionTelemetryRef: MissionTelemetryRef;
  readonly runtime: VoxelGameRuntime;
  readonly telemetryRef: VehicleTelemetryRef;
}

/** 低頻度な火勢状態を常設Rapier colliderへ渡すcomponent入力。 */
interface FireHazardColliderProps {
  readonly box?: VoxelBox;
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

/** route座標を薄い非solid cubeへ変換する。 */
function createRouteBoxes(
  positions: readonly (readonly [number, number, number])[],
): readonly VoxelBox[] {
  return positions.map((position) => ({
    position,
    scale: [0.62, 0.12, 0.62],
  }));
}

export const ROUTE_BOXES: readonly VoxelBox[] = createRouteBoxes(FIRE_ROUTE_MARKER_POSITIONS);

const FIRE_HAZARD_POSITION_OFFSET = [0, -0.55, 0] as const;
const FIRE_LAYER_POSITION_OFFSETS = [
  [0, -0.7, 0],
  [0.05, 0.05, 0.08],
  [0, 0.7, 0],
] as const;
const FIRE_TARGET_BEACON_OFFSETS = [
  [-0.72, 3.6, 0],
  [0, 3.6, 0],
  [0.72, 3.6, 0],
  [-0.36, 3.05, 0],
  [0.36, 3.05, 0],
  [0, 2.45, 0],
] as const;

/** map座標へ局所offsetを加え、authoring精度の小数へ正規化する。 */
function addFirePositionOffset(
  anchor: readonly [number, number, number],
  offset: readonly [number, number, number],
): readonly [number, number, number] {
  return [
    Number((anchor[0] + offset[0]).toFixed(6)),
    Number((anchor[1] + offset[1]).toFixed(6)),
    Number((anchor[2] + offset[2]).toFixed(6)),
  ];
}

/** 火災建物越しにも見える、spray target基準の黄色い下向き矢印を作る。 */
export function createFireTargetBeaconBoxes(
  sprayTarget: readonly [number, number, number],
): readonly VoxelBox[] {
  return FIRE_TARGET_BEACON_OFFSETS.map((offset) => ({
    position: addFirePositionOffset(sprayTarget, offset),
    scale: [0.52, 0.52, 0.52],
  }));
}

/** spray targetを唯一のanchorとしてhazardと炎3層のworld配置を導出する。 */
export function createFireAnchorLayout(
  sprayTarget: readonly [number, number, number],
): FireAnchorLayout {
  return {
    hazardBox: {
      position: addFirePositionOffset(sprayTarget, FIRE_HAZARD_POSITION_OFFSET),
      scale: [1.2, 1.8, 1.2],
    },
    layerPositions: FIRE_LAYER_POSITION_OFFSETS.map((offset) => (
      addFirePositionOffset(sprayTarget, offset)
    )),
  };
}

const FIRE_ANCHOR_LAYOUT = createFireAnchorLayout(FIRE_SPRAY_TARGET_POSITION);

export const FIRE_HAZARD_BOX: VoxelBox = FIRE_ANCHOR_LAYOUT.hazardBox;

export const FIRE_LAYER_POSITIONS = FIRE_ANCHOR_LAYOUT.layerPositions;

export const FIRE_LAYER_BOXES: readonly VoxelBox[] = [
  { position: FIRE_LAYER_POSITIONS[0], scale: [1.15, 1.15, 1.15] },
  { position: FIRE_LAYER_POSITIONS[1], scale: [0.92, 1.25, 0.92] },
  { position: FIRE_LAYER_POSITIONS[2], scale: [0.68, 1.12, 0.68] },
];

export const CELEBRATION_STAR_CENTERS: readonly (readonly [number, number, number])[] =
  CELEBRATION_STAR_CENTER_POSITIONS;

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

/** canonical targetとの差分を小数誤差なくworld座標へ加算する。 */
function createFireAnchorOffset(
  sprayTarget: readonly [number, number, number],
): readonly [number, number, number] {
  return sprayTarget.map((coordinate, axis) => Number((
    coordinate - FIRE_SPRAY_TARGET_POSITION[axis]
  ).toFixed(6))) as [number, number, number];
}

/** 消防仕事のtargetから炎・hazard・route・成功星を一括して導出する。 */
export function createFireJobSceneLayout(job: FireVehicleJobDefinition): FireJobSceneLayout {
  const anchor = createFireAnchorLayout(job.sprayTarget);
  const fireAnchorOffset = createFireAnchorOffset(job.sprayTarget);
  const starGroups = job.celebrationStarCenters.map((center) => createStarBoxes([center]));
  const layerBoxes = [
    { position: anchor.layerPositions[0], scale: FIRE_LAYER_BOXES[0].scale },
    { position: anchor.layerPositions[1], scale: FIRE_LAYER_BOXES[1].scale },
    { position: anchor.layerPositions[2], scale: FIRE_LAYER_BOXES[2].scale },
  ];
  const routeBoxes = createRouteBoxes(job.routeMarkers);
  const targetBeaconBoxes = createFireTargetBeaconBoxes(job.sprayTarget);
  return {
    fireAnchorOffset,
    firePosition: addFirePositionOffset(FIRE_POSITION, fireAnchorOffset),
    guideBoxes: [...routeBoxes, ...targetBeaconBoxes],
    hazardBox: anchor.hazardBox,
    layerBoxes,
    layerPositions: anchor.layerPositions,
    routeBoxes,
    starGroups,
    targetBeaconBoxes,
    whiteStarBoxes: starGroups.filter((_, index) => index % 2 === 1).flat(),
    yellowStarBoxes: starGroups.filter((_, index) => index % 2 === 0).flat(),
  };
}

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
export function FireHazardCollider({
  box = FIRE_HAZARD_BOX,
  enabled,
}: FireHazardColliderProps): ReactElement {
  const colliderRef = useRef<RapierCollider>(null);

  useEffect(() => {
    const collider = colliderRef.current;
    if (collider) syncColliderEnabled(collider, enabled);
  }, [enabled]);

  return (
    <RigidBody colliders={false} type="fixed">
      <CuboidCollider
        args={scaleToHalfExtents(box.scale)}
        position={box.position}
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
  positionOffset: readonly [number, number, number] = [0, 0, 0],
): void {
  if (!mesh) return;
  let batchIndex = 0;
  let visible = false;

  for (const instance of instances) {
    if (instance.role !== role) continue;
    scratch.position.set(
      instance.position[0] + positionOffset[0],
      instance.position[1] + positionOffset[1],
      instance.position[2] + positionOffset[2],
    );
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
  enabled = true,
  sprayTarget: readonly [number, number, number] = FIRE_SPRAY_TARGET_POSITION,
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
  const target = resolveSprayTarget(nozzleOrigin, forward, sprayTarget);
  const waterPath = createWaterFlowPath({
    initialDirection: target.direction,
    nozzleOrigin,
    targetPosition: sprayTarget,
    targeted: target.targeted,
  });
  const sprayActive = enabled && command.primaryAction;
  return {
    direction: target.direction,
    distance: target.distance,
    nozzleOrigin,
    sprayActive,
    sprayElapsedSeconds,
    sprayOnFire: sprayActive && target.targeted,
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
  enabled,
  job,
  missionTelemetryRef,
  runtime,
  telemetryRef,
}: WaterAndFireProps): ReactElement {
  const layout = useMemo(() => createFireJobSceneLayout(job), [job]);
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
        layout.fireAnchorOffset,
      );
      updateFireBatch(
        middleFireRef.current,
        'middle',
        fireFrame.instances,
        fireBatchScratch,
        layout.fireAnchorOffset,
      );
      updateFireBatch(
        coreFireRef.current,
        'core',
        fireFrame.instances,
        fireBatchScratch,
        layout.fireAnchorOffset,
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

    const preview = resolveWaterAndFireFrame(
      telemetryRef.current,
      commandRef.current,
      0,
      0,
      enabled,
      job.sprayTarget,
    );
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
      <FireHazardCollider
        box={layout.hazardBox}
        enabled={visualState.fireHazardEnabled}
        key={job.id}
      />
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
      {enabled && visualState.routeVisible ? <StaticVoxelBatch boxes={layout.guideBoxes} color="#ffd23f" emissive="#d49d16" /> : null}
      {enabled && visualState.celebrating ? (
        <group>
          <StaticVoxelBatch boxes={layout.yellowStarBoxes} color="#ffd23f" emissive="#d49d16" />
          <StaticVoxelBatch boxes={layout.whiteStarBoxes} color="#fff8dc" />
        </group>
      ) : null}
    </group>
  );
}

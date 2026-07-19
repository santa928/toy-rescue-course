import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { VoxelGameRuntime, VoxelGameSnapshot } from '../domain/VoxelGameRuntime';
import { resolveSprayTarget } from '../domain/sprayTargeting';
import type { DriveCommand } from '../input/controlState';
import type { VehicleTelemetry, VehicleTelemetryRef } from './VehicleController';
import { FIRE_POSITION } from './worldLayout';

interface VoxelBox {
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

export interface MissionTelemetry {
  readonly direction: readonly [number, number, number];
  readonly distance: number;
  readonly nozzleOrigin: readonly [number, number, number];
  readonly sprayActive: boolean;
  readonly sprayOnFire: boolean;
  readonly targeted: boolean;
}

export type MissionTelemetryRef = React.MutableRefObject<MissionTelemetry>;

interface MissionVisualState {
  readonly celebrating: boolean;
  readonly fireLayerCount: number;
  readonly routeVisible: boolean;
}

const NOZZLE_FORWARD_OFFSET = 1.7;
const NOZZLE_HEIGHT = 2.15;
const WATER_CUBE_COUNT = 18;
const WATER_CUBE_SCALE = new THREE.Vector3(0.18, 0.18, 0.18);
const WATER_BLUE_INDICES = Array.from({ length: WATER_CUBE_COUNT }, (_, index) => index)
  .filter((index) => index % 3 !== 2);
const WATER_WHITE_INDICES = Array.from({ length: WATER_CUBE_COUNT }, (_, index) => index)
  .filter((index) => index % 3 === 2);

const ROUTE_POSITIONS: readonly (readonly [number, number, number])[] = [
  [3, 0.52, 15], [6, 0.52, 15], [9, 0.52, 15], [12, 0.52, 15],
  [15, 0.52, 13], [15, 0.52, 10], [15, 0.52, 7], [15, 0.52, 4],
  [15, 0.52, 1], [15, 0.52, -2], [15, 0.52, -6], [14, 0.52, -10],
] as const;

const ROUTE_BOXES: readonly VoxelBox[] = ROUTE_POSITIONS.map((position) => ({
  position,
  scale: [0.62, 0.62, 0.62],
}));

export const FIRE_LAYER_POSITIONS: readonly (readonly [number, number, number])[] = [
  [12.9, 1.75, -9.8],
  [12.95, 2.65, -9.72],
  [12.9, 3.5, -9.8],
];

export const CELEBRATION_STAR_CENTERS: readonly (readonly [number, number, number])[] = [
  [10.8, 3.2, -4], [12.4, 3.4, -4.4], [14, 3.2, -4.8],
  [11.2, 4, -5.2], [13, 4.1, -5.6], [14.8, 3.9, -6],
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

const YELLOW_STAR_BOXES = createStarBoxes(CELEBRATION_STAR_CENTERS.filter((_, index) => index % 2 === 0));
const WHITE_STAR_BOXES = createStarBoxes(CELEBRATION_STAR_CENTERS.filter((_, index) => index % 2 === 1));

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
    sprayOnFire: command.spray && target.targeted,
    targeted: target.targeted,
  };
}

/** runtime snapshotからReactで切り替える3種類の低頻度表示状態だけを取り出す。 */
function selectMissionVisualState(snapshot: VoxelGameSnapshot): MissionVisualState {
  return {
    celebrating: snapshot.missionPhase === 'celebrating',
    fireLayerCount: getFireLayerCount(snapshot.fireIntensity),
    routeVisible: snapshot.routeVisible,
  };
}

/** 放水cubeをnozzleから照準方向へ最大18個配置する。 */
function updateWaterBatch(
  mesh: THREE.InstancedMesh | null,
  indices: readonly number[],
  telemetry: MissionTelemetry,
): void {
  if (!mesh) return;
  mesh.visible = telemetry.sprayActive;
  if (!telemetry.sprayActive) return;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const visibleDistance = telemetry.targeted ? Math.min(6, telemetry.distance) : 6;
  indices.forEach((waterIndex, instanceIndex) => {
    const distance = ((waterIndex + 1) / WATER_CUBE_COUNT) * visibleDistance;
    position.set(
      telemetry.nozzleOrigin[0] + telemetry.direction[0] * distance,
      telemetry.nozzleOrigin[1] + telemetry.direction[1] * distance,
      telemetry.nozzleOrigin[2] + telemetry.direction[2] * distance,
    );
    matrix.compose(position, quaternion, WATER_CUBE_SCALE);
    mesh.setMatrixAt(instanceIndex, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

/** 純ボクセルの3段階炎、最大18cubeの水、道しるべ、成功星を描画する。 */
export function WaterAndFire({
  commandRef,
  missionTelemetryRef,
  runtime,
  telemetryRef,
}: WaterAndFireProps): ReactElement {
  const [visualState, setVisualState] = useState(() => selectMissionVisualState(runtime.getSnapshot()));
  const blueWaterRef = useRef<THREE.InstancedMesh>(null);
  const whiteWaterRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => runtime.subscribe((snapshot) => {
    const next = selectMissionVisualState(snapshot);
    setVisualState((current) => (
      current.celebrating === next.celebrating
      && current.fireLayerCount === next.fireLayerCount
      && current.routeVisible === next.routeVisible
        ? current
        : next
    ));
  }), [runtime]);

  useFrame(() => {
    const missionTelemetry = resolveWaterAndFireFrame(telemetryRef.current, commandRef.current);
    missionTelemetryRef.current = missionTelemetry;
    runtime.setSignals({
      sprayActive: missionTelemetry.sprayActive,
      sprayOnFire: missionTelemetry.sprayOnFire,
    });
    updateWaterBatch(blueWaterRef.current, WATER_BLUE_INDICES, missionTelemetry);
    updateWaterBatch(whiteWaterRef.current, WATER_WHITE_INDICES, missionTelemetry);
  }, -1);

  return (
    <group>
      {visualState.fireLayerCount >= 1 ? (
        <mesh position={FIRE_LAYER_POSITIONS[0]}>
          <boxGeometry args={[1.15, 1.15, 1.15]} />
          <meshLambertMaterial color="#ffd23f" emissive="#ef7d22" emissiveIntensity={0.48} />
        </mesh>
      ) : null}
      {visualState.fireLayerCount >= 2 ? (
        <mesh position={FIRE_LAYER_POSITIONS[1]}>
          <boxGeometry args={[0.92, 1.25, 0.92]} />
          <meshLambertMaterial color="#f47c20" emissive="#ef4c23" emissiveIntensity={0.42} />
        </mesh>
      ) : null}
      {visualState.fireLayerCount >= 3 ? (
        <mesh position={FIRE_LAYER_POSITIONS[2]}>
          <boxGeometry args={[0.68, 1.12, 0.68]} />
          <meshLambertMaterial color="#ef4c23" emissive="#f47c20" emissiveIntensity={0.38} />
        </mesh>
      ) : null}
      <instancedMesh
        args={[undefined, undefined, WATER_BLUE_INDICES.length]}
        frustumCulled={false}
        ref={blueWaterRef}
        visible={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color="#67c7df" emissive="#3ba6c4" emissiveIntensity={0.2} />
      </instancedMesh>
      <instancedMesh
        args={[undefined, undefined, WATER_WHITE_INDICES.length]}
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

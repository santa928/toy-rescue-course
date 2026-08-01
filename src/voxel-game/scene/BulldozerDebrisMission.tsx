import { useRef } from 'react';
import type { MutableRefObject, ReactElement, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { BulldozerMissionSnapshot } from '../domain/BulldozerMissionRuntime';
import type { VehicleMissionCoordinator } from '../domain/VehicleMissionCoordinator';
import type { VehicleId } from '../domain/vehicleDefinitions';
import type { VehicleTelemetryRef } from './VehicleController';
import type { WorldPoint } from './productionWorldMap';
import {
  BULLDOZER_DEBRIS,
} from './worldLayout';
import {
  createBulldozerVfxFrame,
  hideBulldozerTransform,
  updateBulldozerVfxFrame,
  type BulldozerVfxFrame,
  type BulldozerVfxPaletteId,
  type BulldozerVoxelTransform,
} from './bulldozerVfx';

/** blade接触のpure判定へ渡す車種、入力、速度、位置。 */
export interface BulldozerDebrisContact {
  actionActive: boolean;
  bladeCenter: WorldPoint;
  debrisPosition: WorldPoint;
  debrisRadius: number;
  speed: number;
  vehicleId: VehicleId;
}

/** blade中心計算に必要な車両telemetryの最小契約。 */
export interface BladeTelemetrySource {
  readonly forward: WorldPoint;
  readonly position: WorldPoint;
}

/** text telemetryへ公開する工事VFXのactual固定pool状態。 */
export interface BulldozerMissionTelemetry {
  activeChipCount: number;
  readonly bladeCenter: [number, number, number];
  clearedCount: number;
  debrisVisibleVoxelCount: number;
  readonly frame: BulldozerVfxFrame;
  routeMarkerCount: number;
  starVoxelCount: number;
}

export type BulldozerMissionTelemetryRef = MutableRefObject<BulldozerMissionTelemetry>;
export type BulldozerMissionSnapshotRef = MutableRefObject<BulldozerMissionSnapshot>;

interface BulldozerDebrisMissionProps {
  readonly actionActiveRef: RefObject<boolean>;
  readonly coordinator: VehicleMissionCoordinator;
  readonly enabled: boolean;
  readonly missionTelemetryRef: BulldozerMissionTelemetryRef;
  readonly snapshotRef: BulldozerMissionSnapshotRef;
  readonly vehicleId: VehicleId;
  readonly vehicleTelemetryRef: VehicleTelemetryRef;
}

const BLADE_CONTACT_RADIUS = 0.75;
const MINIMUM_CLEAR_SPEED = 0.6;
const UNIT_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const PALETTE_COLORS: Readonly<Record<BulldozerVfxPaletteId, string>> = {
  crate: '#d89a32',
  route: '#f59e0b',
  star: '#fff1a6',
  stone: '#858b94',
  timber: '#9a5d2f',
};

/** 車両中心と前方からworld-spaceのblade中心を返す。 */
export function getBladeCenter(
  telemetry: BladeTelemetrySource,
  target: [number, number, number] = [0, 0, 0],
): WorldPoint {
  target[0] = telemetry.position[0] + telemetry.forward[0] * 1.75;
  target[1] = telemetry.position[1] + 0.35;
  target[2] = telemetry.position[2] + telemetry.forward[2] * 1.75;
  return target;
}

/** ブルドーザーの作動中bladeが十分な速度でがれきへ触れたか判定する。 */
export function shouldClearDebris(contact: BulldozerDebrisContact): boolean {
  if (
    contact.vehicleId !== 'bulldozer'
    || !contact.actionActive
    || !Number.isFinite(contact.speed)
    || contact.speed < MINIMUM_CLEAR_SPEED
    || !Number.isFinite(contact.debrisRadius)
    || contact.debrisRadius <= 0
    || !contact.bladeCenter.every(Number.isFinite)
    || !contact.debrisPosition.every(Number.isFinite)
  ) {
    return false;
  }
  return Math.hypot(
    contact.bladeCenter[0] - contact.debrisPosition[0],
    contact.bladeCenter[2] - contact.debrisPosition[2],
  ) <= contact.debrisRadius + BLADE_CONTACT_RADIUS;
}

/** 外部refへ渡せる、全固定slotを確保済みの初期telemetryを返す。 */
export function createBulldozerMissionTelemetry(): BulldozerMissionTelemetry {
  return {
    activeChipCount: 0,
    bladeCenter: [0, -40, 0],
    clearedCount: 0,
    debrisVisibleVoxelCount: 0,
    frame: createBulldozerVfxFrame(),
    routeMarkerCount: 0,
    starVoxelCount: 0,
  };
}

/** palette一致slotだけを1つのInstancedMeshへin-place転送する。 */
function applyPaletteTransforms(
  mesh: THREE.InstancedMesh | null,
  transforms: readonly BulldozerVoxelTransform[],
  palette: BulldozerVfxPaletteId,
  matrix: THREE.Matrix4,
): void {
  if (!mesh) return;
  let instanceIndex = 0;
  for (const transform of transforms) {
    if (transform.palette !== palette) continue;
    matrix.makeScale(transform.scale[0], transform.scale[1], transform.scale[2]);
    matrix.setPosition(transform.position[0], transform.position[1], transform.position[2]);
    mesh.setMatrixAt(instanceIndex, matrix);
    instanceIndex += 1;
  }
  mesh.count = instanceIndex;
  mesh.instanceMatrix.needsUpdate = true;
}

/** 固定slot群を指定paletteの1 meshとして描画する。 */
function VoxelPool({
  count,
  meshRef,
  palette,
}: {
  readonly count: number;
  readonly meshRef: RefObject<THREE.InstancedMesh | null>;
  readonly palette: BulldozerVfxPaletteId;
}): ReactElement {
  return (
    <instancedMesh args={[UNIT_GEOMETRY, undefined, count]} dispose={null} ref={meshRef}>
      <meshLambertMaterial
        color={PALETTE_COLORS[palette]}
        emissive={palette === 'star' ? '#d97706' : undefined}
        emissiveIntensity={palette === 'star' ? 0.24 : 0}
      />
    </instancedMesh>
  );
}

/** がれき、流れるchip、道しるべ、成功星を固定poolで描画し、1 frame最大1塊を片付ける。 */
export function BulldozerDebrisMission({
  actionActiveRef,
  coordinator,
  enabled,
  missionTelemetryRef,
  snapshotRef,
  vehicleId,
  vehicleTelemetryRef,
}: BulldozerDebrisMissionProps): ReactElement {
  const debrisTimberRef = useRef<THREE.InstancedMesh>(null);
  const debrisStoneRef = useRef<THREE.InstancedMesh>(null);
  const debrisCrateRef = useRef<THREE.InstancedMesh>(null);
  const chipTimberRef = useRef<THREE.InstancedMesh>(null);
  const chipStoneRef = useRef<THREE.InstancedMesh>(null);
  const chipCrateRef = useRef<THREE.InstancedMesh>(null);
  const routeRef = useRef<THREE.InstancedMesh>(null);
  const starRef = useRef<THREE.InstancedMesh>(null);
  const matrixRef = useRef<THREE.Matrix4 | null>(null);
  if (matrixRef.current === null) matrixRef.current = new THREE.Matrix4();
  const clearTimesRef = useRef<Float64Array | null>(null);
  if (clearTimesRef.current === null) {
    clearTimesRef.current = new Float64Array(BULLDOZER_DEBRIS.length);
    clearTimesRef.current.fill(-1);
  }

  const contactRef = useRef<BulldozerDebrisContact | null>(null);
  if (contactRef.current === null) {
    contactRef.current = {
      actionActive: false,
      bladeCenter: missionTelemetryRef.current.bladeCenter,
      debrisPosition: BULLDOZER_DEBRIS[0].position,
      debrisRadius: BULLDOZER_DEBRIS[0].radius,
      speed: 0,
      vehicleId,
    };
  }

  useFrame(({ clock }) => {
    const elapsedSeconds = clock.elapsedTime;
    const clearTimes = clearTimesRef.current;
    if (!clearTimes) return;

    let snapshot = snapshotRef.current;
    const vehicle = vehicleTelemetryRef.current;
    const bladeCenter = getBladeCenter(vehicle, missionTelemetryRef.current.bladeCenter);

    for (let index = 0; index < snapshot.debris.length; index += 1) {
      if (!snapshot.debris[index].cleared) clearTimes[index] = -1;
      else if (clearTimes[index] < 0) clearTimes[index] = elapsedSeconds;
    }

    if (enabled && actionActiveRef.current === true) {
      for (let index = 0; index < BULLDOZER_DEBRIS.length; index += 1) {
        const source = BULLDOZER_DEBRIS[index];
        if (snapshot.debris[index]?.cleared) continue;
        const contact = contactRef.current;
        if (!contact) return;
        contact.actionActive = true;
        contact.bladeCenter = bladeCenter;
        contact.debrisPosition = source.position;
        contact.debrisRadius = source.radius;
        contact.speed = vehicle.speed;
        contact.vehicleId = vehicleId;
        if (!shouldClearDebris(contact)) continue;
        if (coordinator.registerDebrisClear(source.id)) {
          clearTimes[index] = elapsedSeconds;
          snapshot = coordinator.getSnapshot().bulldozer;
          snapshotRef.current = snapshot;
        }
        break;
      }
    }

    const frame = missionTelemetryRef.current.frame;
    updateBulldozerVfxFrame(frame, snapshot, clearTimes, elapsedSeconds);
    if (!enabled) {
      for (const transform of frame.chips) hideBulldozerTransform(transform);
      for (const transform of frame.routeMarkers) hideBulldozerTransform(transform);
      for (const transform of frame.stars) hideBulldozerTransform(transform);
    }

    const matrix = matrixRef.current;
    if (!matrix) return;
    applyPaletteTransforms(debrisTimberRef.current, frame.debris, 'timber', matrix);
    applyPaletteTransforms(debrisStoneRef.current, frame.debris, 'stone', matrix);
    applyPaletteTransforms(debrisCrateRef.current, frame.debris, 'crate', matrix);
    applyPaletteTransforms(chipTimberRef.current, frame.chips, 'timber', matrix);
    applyPaletteTransforms(chipStoneRef.current, frame.chips, 'stone', matrix);
    applyPaletteTransforms(chipCrateRef.current, frame.chips, 'crate', matrix);
    applyPaletteTransforms(routeRef.current, frame.routeMarkers, 'route', matrix);
    applyPaletteTransforms(starRef.current, frame.stars, 'star', matrix);

    const telemetry = missionTelemetryRef.current;
    telemetry.clearedCount = snapshot.clearedCount;
    telemetry.activeChipCount = 0;
    telemetry.debrisVisibleVoxelCount = 0;
    telemetry.routeMarkerCount = 0;
    telemetry.starVoxelCount = 0;
    for (const transform of frame.chips) telemetry.activeChipCount += Number(transform.active);
    for (const transform of frame.debris) {
      telemetry.debrisVisibleVoxelCount += Number(transform.active);
    }
    for (const transform of frame.routeMarkers) {
      telemetry.routeMarkerCount += Number(transform.active);
    }
    for (const transform of frame.stars) telemetry.starVoxelCount += Number(transform.active);
  });

  return (
    <group>
      <VoxelPool count={4} meshRef={debrisTimberRef} palette="timber" />
      <VoxelPool count={4} meshRef={debrisStoneRef} palette="stone" />
      <VoxelPool count={4} meshRef={debrisCrateRef} palette="crate" />
      <VoxelPool count={6} meshRef={chipTimberRef} palette="timber" />
      <VoxelPool count={6} meshRef={chipStoneRef} palette="stone" />
      <VoxelPool count={6} meshRef={chipCrateRef} palette="crate" />
      <VoxelPool count={7} meshRef={routeRef} palette="route" />
      <VoxelPool count={12} meshRef={starRef} palette="star" />
    </group>
  );
}

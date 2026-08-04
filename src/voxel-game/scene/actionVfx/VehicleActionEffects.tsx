import { useRef } from 'react';
import type { MutableRefObject, ReactElement, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { DriveCommand } from '../../input/controlState';
import type { VehicleId } from '../../domain/vehicleDefinitions';
import type { VehicleTelemetryRef } from '../VehicleController';
import {
  VEHICLE_ACTION_PALETTE_COLORS,
  VEHICLE_ACTION_VOXEL_POOL_SIZE,
  createVehicleActionInstanceColorArray,
  createVehicleActionVfxFrame,
  updateVehicleActionVfxFrame,
  type SpectacleVehicleId,
} from './vehicleActionFrame';

export const VEHICLE_ACTION_VFX_DRAW_CALLS = 1;
export const VEHICLE_ACTION_MATERIAL_USES_GEOMETRY_VERTEX_COLORS = false;

export interface VehicleActionVfxTelemetry {
  activeCubeCount: number;
  cycleProgress: number;
  pressCount: number;
  vehicleId: SpectacleVehicleId | null;
}

export type VehicleActionVfxTelemetryRef = MutableRefObject<VehicleActionVfxTelemetry>;

interface VehicleActionVfxProps {
  readonly commandRef: RefObject<DriveCommand>;
  readonly telemetryRef: VehicleActionVfxTelemetryRef;
  readonly vehicleId: VehicleId;
  readonly vehicleTelemetryRef: VehicleTelemetryRef;
}

const UNIT_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const PALETTE_COLORS = Object.fromEntries(
  Object.entries(VEHICLE_ACTION_PALETTE_COLORS).map(([palette, color]) => (
    [palette, new THREE.Color(color)]
  )),
) as Readonly<Record<keyof typeof VEHICLE_ACTION_PALETTE_COLORS, THREE.Color>>;

/** text telemetryへ渡す非active初期状態を返す。 */
export function createVehicleActionVfxTelemetry(): VehicleActionVfxTelemetry {
  return {
    activeCubeCount: 0,
    cycleProgress: 0,
    pressCount: 0,
    vehicleId: null,
  };
}

/** 非消防車の自由アクションを単一fixed-pool batchで描画する。 */
export function VehicleActionVfx({
  commandRef,
  telemetryRef,
  vehicleId,
  vehicleTelemetryRef,
}: VehicleActionVfxProps): ReactElement {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const frameRef = useRef(createVehicleActionVfxFrame());
  const matrixRef = useRef(new THREE.Matrix4());
  const instanceColorsRef = useRef<Float32Array | null>(null);
  if (instanceColorsRef.current === null) {
    instanceColorsRef.current = createVehicleActionInstanceColorArray();
  }

  useFrame(({ clock }, deltaSeconds) => {
    const frame = frameRef.current;
    const vehicle = vehicleTelemetryRef.current;
    updateVehicleActionVfxFrame(frame, {
      actionActive: commandRef.current.primaryAction,
      deltaSeconds,
      elapsedSeconds: clock.elapsedTime,
      forward: vehicle.forward,
      position: vehicle.position,
      speed: vehicle.speed,
      vehicleId,
    });

    const mesh = meshRef.current;
    if (mesh) {
      let instanceIndex = 0;
      for (const voxel of frame.voxels) {
        if (!voxel.active) continue;
        matrixRef.current.makeScale(voxel.scale[0], voxel.scale[1], voxel.scale[2]);
        matrixRef.current.setPosition(voxel.position[0], voxel.position[1], voxel.position[2]);
        mesh.setMatrixAt(instanceIndex, matrixRef.current);
        mesh.setColorAt(instanceIndex, PALETTE_COLORS[voxel.palette]);
        instanceIndex += 1;
      }
      mesh.count = instanceIndex;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    telemetryRef.current.activeCubeCount = frame.activeCount;
    telemetryRef.current.cycleProgress = frame.cycleProgress;
    telemetryRef.current.pressCount = frame.pressCount;
    telemetryRef.current.vehicleId = frame.vehicleId;
  });

  return (
    <instancedMesh
      args={[UNIT_GEOMETRY, undefined, VEHICLE_ACTION_VOXEL_POOL_SIZE]}
      dispose={null}
      frustumCulled={false}
      ref={meshRef}
    >
      <instancedBufferAttribute
        args={[instanceColorsRef.current, 3]}
        attach="instanceColor"
      />
      <meshLambertMaterial
        color="#ffffff"
        vertexColors={VEHICLE_ACTION_MATERIAL_USES_GEOMETRY_VERTEX_COLORS}
      />
    </instancedMesh>
  );
}

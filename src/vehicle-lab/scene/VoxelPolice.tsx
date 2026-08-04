import { useLayoutEffect, useRef } from 'react';
import type { ReactElement, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import {
  POLICE_PALETTE,
  POLICE_PALETTE_IDS,
  POLICE_VOXELS,
  type PolicePaletteId,
} from '../model/policeVoxels';
import { assertValidVoxelModel, calculateVoxelBounds } from '../model/voxelModel';
import {
  createVoxelRenderPlan,
  type VoxelRenderBatch,
} from '../model/voxelRenderPlan';
import { resolveVehiclePaintColor } from '../model/vehiclePaint';

const VOXEL_SIZE = 0.24;
const VOXEL_EDGE = VOXEL_SIZE * 0.94;
const VOXEL_GEOMETRY = new THREE.BoxGeometry(VOXEL_EDGE, VOXEL_EDGE, VOXEL_EDGE);

export const POLICE_RENDER_PLAN = createVoxelRenderPlan(
  POLICE_VOXELS,
  POLICE_PALETTE_IDS,
  calculateVoxelBounds(POLICE_VOXELS),
  VOXEL_SIZE,
);
const POLICE_RED_BEACON_BATCH = POLICE_RENDER_PLAN.batches.find(
  ({ paletteId }) => paletteId === 'redBeacon',
);
const POLICE_BLUE_BEACON_BATCH = POLICE_RENDER_PLAN.batches.find(
  ({ paletteId }) => paletteId === 'blueBeacon',
);
const POLICE_STATIC_BATCHES = POLICE_RENDER_PLAN.batches.filter(
  ({ paletteId }) => paletteId !== 'redBeacon' && paletteId !== 'blueBeacon',
);

interface VoxelBatchProps {
  readonly batch: VoxelRenderBatch<PolicePaletteId>;
  readonly paintColor: string | null;
}

export type VoxelPoliceProps = ThreeElements['group'] & {
  readonly actionActiveRef?: RefObject<boolean>;
  readonly paintColor?: string | null;
};

export interface PoliceActionPose {
  readonly blueScale: number;
  readonly flashHz: number;
  readonly phase: 'hold' | 'idle' | 'press';
  readonly redScale: number;
}

const IDLE_POLICE_POSE: PoliceActionPose = {
  blueScale: 1,
  flashHz: 0,
  phase: 'idle',
  redScale: 1,
};

/** 押下burstと0.5秒ごとの赤青hold切替を決定的な車体poseへ変換する。 */
export function getPoliceActionPose(
  actionActive: boolean,
  actionElapsedSeconds: number,
): PoliceActionPose {
  if (!actionActive || !Number.isFinite(actionElapsedSeconds) || actionElapsedSeconds < 0) {
    return IDLE_POLICE_POSE;
  }
  const redActive = Math.floor(actionElapsedSeconds * 2) % 2 === 0;
  if (actionElapsedSeconds < 0.18) {
    const burst = Math.sin(actionElapsedSeconds / 0.18 * Math.PI);
    const activeScale = 1 + burst * 0.22;
    return {
      blueScale: redActive ? 0.82 : activeScale,
      flashHz: 2,
      phase: 'press',
      redScale: redActive ? activeScale : 0.82,
    };
  }
  return {
    blueScale: redActive ? 0.82 : 1.14,
    flashHz: 2,
    phase: 'hold',
    redScale: redActive ? 1.14 : 0.82,
  };
}

/** サイレン中は0.5秒ごとに赤青灯の大きさを交互へ切り替える。 */
export function getPoliceBeaconScales(
  actionActive: boolean,
  elapsedSeconds: number,
): { readonly blue: number; readonly red: number } {
  if (!actionActive || !Number.isFinite(elapsedSeconds)) return { blue: 1, red: 1 };
  const redActive = Math.floor(Math.max(0, elapsedSeconds) * 2) % 2 === 0;
  return redActive
    ? { blue: 0.82, red: 1.12 }
    : { blue: 1.12, red: 0.82 };
}

/** 同色voxelを1つのInstancedMeshとして描画する。 */
function VoxelBatch({ batch, paintColor }: VoxelBatchProps): ReactElement {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const material = POLICE_PALETTE[batch.paletteId];

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    batch.positions.forEach(([x, y, z], index) => {
      matrix.makeTranslation(x, y, z);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [batch.positions]);

  return (
    <instancedMesh
      args={[VOXEL_GEOMETRY, undefined, batch.positions.length]}
      castShadow
      dispose={null}
      receiveShadow
      ref={meshRef}
    >
      <meshLambertMaterial
        color={resolveVehiclePaintColor({
          baseColor: material.color,
          paintColor,
          paletteId: batch.paletteId,
          vehicleId: 'police',
        })}
        emissive={'emissive' in material ? material.emissive : undefined}
        emissiveIntensity={'emissiveIntensity' in material ? material.emissiveIntensity : 0}
      />
    </instancedMesh>
  );
}

/** 純voxelパトカーを7 palette batchで描画し、サイレン中だけ赤青灯を交互に明滅させる。 */
export function VoxelPolice({
  actionActiveRef,
  paintColor = null,
  ...groupProps
}: VoxelPoliceProps): ReactElement {
  const redBeaconRef = useRef<THREE.Group>(null);
  const blueBeaconRef = useRef<THREE.Group>(null);
  const actionElapsedSecondsRef = useRef(0);
  assertValidVoxelModel(POLICE_VOXELS, POLICE_PALETTE_IDS);

  useFrame((_state, delta) => {
    const red = redBeaconRef.current;
    const blue = blueBeaconRef.current;
    if (!red || !blue) return;
    const actionActive = actionActiveRef?.current === true;
    actionElapsedSecondsRef.current = actionActive
      ? actionElapsedSecondsRef.current + Math.max(0, Math.min(delta, 0.05))
      : 0;
    const pose = getPoliceActionPose(actionActive, actionElapsedSecondsRef.current);
    red.scale.setScalar(pose.redScale);
    blue.scale.setScalar(pose.blueScale);
  });

  return (
    <group {...groupProps}>
      <group position={POLICE_RENDER_PLAN.offset}>
        {POLICE_STATIC_BATCHES.map((batch) => (
          <VoxelBatch batch={batch} key={batch.paletteId} paintColor={paintColor} />
        ))}
        {POLICE_RED_BEACON_BATCH ? (
          <group ref={redBeaconRef}>
            <VoxelBatch batch={POLICE_RED_BEACON_BATCH} paintColor={paintColor} />
          </group>
        ) : null}
        {POLICE_BLUE_BEACON_BATCH ? (
          <group ref={blueBeaconRef}>
            <VoxelBatch batch={POLICE_BLUE_BEACON_BATCH} paintColor={paintColor} />
          </group>
        ) : null}
      </group>
    </group>
  );
}

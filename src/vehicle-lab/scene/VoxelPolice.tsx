import { useRef } from 'react';
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
import { useVoxelWheelAnimation } from './useVoxelWheelAnimation';

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
  readonly wheelAngleRef?: RefObject<number>;
  readonly batch: VoxelRenderBatch<PolicePaletteId>;
  readonly paintColor: string | null;
  readonly glowMaterialRef?: RefObject<THREE.MeshLambertMaterial | null>;
}

export type VoxelPoliceProps = ThreeElements['group'] & {
  readonly wheelAngleRef?: RefObject<number>;
  readonly actionActiveRef?: RefObject<boolean>;
  readonly paintColor?: string | null;
};

export interface PoliceActionPose {
  readonly blueGlow: number;
  readonly redGlow: number;
  readonly blueScale: number;
  readonly flashHz: number;
  readonly phase: 'hold' | 'idle' | 'press';
  readonly redScale: number;
}

const IDLE_POLICE_POSE: PoliceActionPose = {
  blueGlow: 0.38,
  redGlow: 0.34,
  blueScale: 1,
  flashHz: 0,
  phase: 'idle',
  redScale: 1,
};

/** 車体の形を固定し、0.5秒ごとに屋根灯の明るさだけを交互へ切り替える。 */
export function getPoliceActionPose(
  actionActive: boolean,
  actionElapsedSeconds: number,
): PoliceActionPose {
  if (!actionActive || !Number.isFinite(actionElapsedSeconds) || actionElapsedSeconds < 0) {
    return IDLE_POLICE_POSE;
  }
  const redActive = Math.floor(actionElapsedSeconds * 2) % 2 === 0;
  return {
    blueGlow: redActive ? 0.1 : 1.2,
    redGlow: redActive ? 1.2 : 0.1,
    blueScale: 1,
    flashHz: 2,
    phase: actionElapsedSeconds < 0.18 ? 'press' : 'hold',
    redScale: 1,
  };
}

/** 互換用の寸法取得。サイレン中も灯火を屋根へ固定し、拡大しない。 */
export function getPoliceBeaconScales(
  actionActive: boolean,
  elapsedSeconds: number,
): { readonly blue: number; readonly red: number } {
  const pose = getPoliceActionPose(actionActive, elapsedSeconds);
  return { blue: pose.blueScale, red: pose.redScale };
}

/** 同色voxelを1つのInstancedMeshとして描画する。 */
function VoxelBatch({ batch, paintColor, glowMaterialRef, wheelAngleRef }: VoxelBatchProps): ReactElement {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const material = POLICE_PALETTE[batch.paletteId];

  useVoxelWheelAnimation(meshRef, batch, 'police', wheelAngleRef);

  return (
    <instancedMesh
      args={[VOXEL_GEOMETRY, undefined, batch.positions.length]}
      castShadow
      dispose={null}
      receiveShadow
      ref={meshRef}
    >
      <meshLambertMaterial
        ref={glowMaterialRef}
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
  wheelAngleRef,
  actionActiveRef,
  paintColor = null,
  ...groupProps
}: VoxelPoliceProps): ReactElement {
  const redMaterialRef = useRef<THREE.MeshLambertMaterial>(null);
  const blueMaterialRef = useRef<THREE.MeshLambertMaterial>(null);
  const actionElapsedSecondsRef = useRef(0);
  assertValidVoxelModel(POLICE_VOXELS, POLICE_PALETTE_IDS);

  useFrame((_state, delta) => {
    const actionActive = actionActiveRef?.current === true;
    actionElapsedSecondsRef.current = actionActive
      ? actionElapsedSecondsRef.current + Math.max(0, Math.min(delta, 0.05))
      : 0;
    const pose = getPoliceActionPose(actionActive, actionElapsedSecondsRef.current);
    if (redMaterialRef.current) redMaterialRef.current.emissiveIntensity = pose.redGlow;
    if (blueMaterialRef.current) blueMaterialRef.current.emissiveIntensity = pose.blueGlow;
  });

  return (
    <group {...groupProps}>
      <group position={POLICE_RENDER_PLAN.offset}>
        {POLICE_STATIC_BATCHES.map((batch) => (
          <VoxelBatch batch={batch} key={batch.paletteId} paintColor={paintColor} wheelAngleRef={wheelAngleRef} />
        ))}
        {POLICE_RED_BEACON_BATCH ? (
          <group>
            <VoxelBatch batch={POLICE_RED_BEACON_BATCH} paintColor={paintColor} glowMaterialRef={redMaterialRef} />
          </group>
        ) : null}
        {POLICE_BLUE_BEACON_BATCH ? (
          <group>
            <VoxelBatch batch={POLICE_BLUE_BEACON_BATCH} paintColor={paintColor} glowMaterialRef={blueMaterialRef} />
          </group>
        ) : null}
      </group>
    </group>
  );
}

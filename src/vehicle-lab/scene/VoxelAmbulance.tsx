import { useLayoutEffect, useRef } from 'react';
import type { ReactElement, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import {
  AMBULANCE_PALETTE,
  AMBULANCE_PALETTE_IDS,
  AMBULANCE_VOXELS,
  type AmbulancePaletteId,
} from '../model/ambulanceVoxels';
import { assertValidVoxelModel, calculateVoxelBounds } from '../model/voxelModel';
import {
  createVoxelRenderPlan,
  type VoxelRenderBatch,
} from '../model/voxelRenderPlan';
import { resolveVehiclePaintColor } from '../model/vehiclePaint';

const VOXEL_SIZE = 0.24;
const VOXEL_EDGE = VOXEL_SIZE * 0.94;
const VOXEL_GEOMETRY = new THREE.BoxGeometry(VOXEL_EDGE, VOXEL_EDGE, VOXEL_EDGE);

export const AMBULANCE_RENDER_PLAN = createVoxelRenderPlan(
  AMBULANCE_VOXELS,
  AMBULANCE_PALETTE_IDS,
  calculateVoxelBounds(AMBULANCE_VOXELS),
  VOXEL_SIZE,
);
const AMBULANCE_CROSS_BATCHES = AMBULANCE_RENDER_PLAN.batches.filter(
  ({ paletteId }) => paletteId === 'cross',
);
const AMBULANCE_BEACON_BATCHES = AMBULANCE_RENDER_PLAN.batches.filter(
  ({ paletteId }) => paletteId === 'beacon',
);
const AMBULANCE_STATIC_BATCHES = AMBULANCE_RENDER_PLAN.batches.filter(
  ({ paletteId }) => paletteId !== 'cross' && paletteId !== 'beacon',
);

interface VoxelBatchProps {
  readonly batch: VoxelRenderBatch<AmbulancePaletteId>;
  readonly paintColor: string | null;
  readonly glowMaterialRef?: RefObject<THREE.MeshLambertMaterial | null>;
}

export type VoxelAmbulanceProps = ThreeElements['group'] & {
  readonly actionActiveRef?: RefObject<boolean>;
  readonly paintColor?: string | null;
};

export interface AmbulanceActionPose {
  readonly beaconGlow: number;
  readonly crossGlow: number;
  readonly beaconPulseHz: number;
  readonly beaconScale: number;
  readonly crossScale: number;
  readonly phase: 'hold' | 'idle' | 'press';
}

const IDLE_AMBULANCE_POSE: AmbulanceActionPose = {
  beaconGlow: 0.34,
  crossGlow: 0,
  beaconPulseHz: 0,
  beaconScale: 1,
  crossScale: 1,
  phase: 'idle',
};

/** 十字と灯火を車体へ固定し、手当ての明るさを1Hzで穏やかに脈動させる。 */
export function getAmbulanceActionPose(
  actionActive: boolean,
  actionElapsedSeconds: number,
): AmbulanceActionPose {
  if (!actionActive || !Number.isFinite(actionElapsedSeconds) || actionElapsedSeconds < 0) {
    return IDLE_AMBULANCE_POSE;
  }
  const pulse = 0.5 + 0.5 * Math.sin(actionElapsedSeconds * Math.PI * 2);
  return {
    beaconGlow: 0.45 + pulse * 0.65,
    crossGlow: 0.08 + pulse * 0.25,
    beaconPulseHz: 1,
    beaconScale: 1,
    crossScale: 1,
    phase: actionElapsedSeconds < 0.22 ? 'press' : 'hold',
  };
}

/** 互換用の寸法取得。手当て中も赤十字を車体へ固定し、拡大しない。 */
export function getAmbulanceCarePulseScale(
  actionActive: boolean,
  elapsedSeconds: number,
): number {
  return getAmbulanceActionPose(actionActive, elapsedSeconds).crossScale;
}

/** 同色voxelを1つのInstancedMeshとして描画する。 */
function VoxelBatch({ batch, paintColor, glowMaterialRef }: VoxelBatchProps): ReactElement {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const material = AMBULANCE_PALETTE[batch.paletteId];

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
        ref={glowMaterialRef}
        color={resolveVehiclePaintColor({
          baseColor: material.color,
          paintColor,
          paletteId: batch.paletteId,
          vehicleId: 'ambulance',
        })}
        emissive={batch.paletteId === 'cross' ? material.color : 'emissive' in material ? material.emissive : undefined}
        emissiveIntensity={'emissiveIntensity' in material ? material.emissiveIntensity : 0}
      />
    </instancedMesh>
  );
}

/** 純voxel救急車を7 palette batchで描画し、手当て中だけ赤十字と灯火を脈動させる。 */
export function VoxelAmbulance({
  actionActiveRef,
  paintColor = null,
  ...groupProps
}: VoxelAmbulanceProps): ReactElement {
  const beaconMaterialRef = useRef<THREE.MeshLambertMaterial>(null);
  const crossMaterialRef = useRef<THREE.MeshLambertMaterial>(null);
  const actionElapsedSecondsRef = useRef(0);
  assertValidVoxelModel(AMBULANCE_VOXELS, AMBULANCE_PALETTE_IDS);

  useFrame((_state, delta) => {
    const actionActive = actionActiveRef?.current === true;
    actionElapsedSecondsRef.current = actionActive
      ? actionElapsedSecondsRef.current + Math.max(0, Math.min(delta, 0.05))
      : 0;
    const pose = getAmbulanceActionPose(actionActive, actionElapsedSecondsRef.current);
    if (beaconMaterialRef.current) beaconMaterialRef.current.emissiveIntensity = pose.beaconGlow;
    if (crossMaterialRef.current) crossMaterialRef.current.emissiveIntensity = pose.crossGlow;
  });

  return (
    <group {...groupProps}>
      <group position={AMBULANCE_RENDER_PLAN.offset}>
        {AMBULANCE_STATIC_BATCHES.map((batch) => (
          <VoxelBatch batch={batch} key={batch.paletteId} paintColor={paintColor} />
        ))}
        <group>
          {AMBULANCE_CROSS_BATCHES.map((batch) => (
            <VoxelBatch batch={batch} key={batch.paletteId} paintColor={paintColor} glowMaterialRef={crossMaterialRef} />
          ))}
        </group>
        <group>
          {AMBULANCE_BEACON_BATCHES.map((batch) => (
            <VoxelBatch batch={batch} key={batch.paletteId} paintColor={paintColor} glowMaterialRef={beaconMaterialRef} />
          ))}
        </group>
      </group>
    </group>
  );
}

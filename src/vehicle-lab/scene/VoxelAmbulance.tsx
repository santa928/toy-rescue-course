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
const AMBULANCE_PULSE_BATCHES = AMBULANCE_RENDER_PLAN.batches.filter(
  ({ paletteId }) => paletteId === 'cross' || paletteId === 'beacon',
);
const AMBULANCE_STATIC_BATCHES = AMBULANCE_RENDER_PLAN.batches.filter(
  ({ paletteId }) => paletteId !== 'cross' && paletteId !== 'beacon',
);

interface VoxelBatchProps {
  readonly batch: VoxelRenderBatch<AmbulancePaletteId>;
  readonly paintColor: string | null;
}

export type VoxelAmbulanceProps = ThreeElements['group'] & {
  readonly actionActiveRef?: RefObject<boolean>;
  readonly paintColor?: string | null;
};

/** 主操作中だけ赤十字と灯火を1.00〜1.06でゆっくり脈動させる。 */
export function getAmbulanceCarePulseScale(
  actionActive: boolean,
  elapsedSeconds: number,
): number {
  if (!actionActive || !Number.isFinite(elapsedSeconds)) return 1;
  return 1 + Math.max(0, Math.sin(Math.max(0, elapsedSeconds) * Math.PI * 2)) * 0.06;
}

/** 同色voxelを1つのInstancedMeshとして描画する。 */
function VoxelBatch({ batch, paintColor }: VoxelBatchProps): ReactElement {
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
        color={resolveVehiclePaintColor({
          baseColor: material.color,
          paintColor,
          paletteId: batch.paletteId,
          vehicleId: 'ambulance',
        })}
        emissive={'emissive' in material ? material.emissive : undefined}
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
  const pulseGroupRef = useRef<THREE.Group>(null);
  assertValidVoxelModel(AMBULANCE_VOXELS, AMBULANCE_PALETTE_IDS);

  useFrame(({ clock }) => {
    const group = pulseGroupRef.current;
    if (!group) return;
    group.scale.setScalar(getAmbulanceCarePulseScale(
      actionActiveRef?.current === true,
      clock.elapsedTime,
    ));
  });

  return (
    <group {...groupProps}>
      <group position={AMBULANCE_RENDER_PLAN.offset}>
        {AMBULANCE_STATIC_BATCHES.map((batch) => (
          <VoxelBatch batch={batch} key={batch.paletteId} paintColor={paintColor} />
        ))}
        <group ref={pulseGroupRef}>
          {AMBULANCE_PULSE_BATCHES.map((batch) => (
            <VoxelBatch batch={batch} key={batch.paletteId} paintColor={paintColor} />
          ))}
        </group>
      </group>
    </group>
  );
}

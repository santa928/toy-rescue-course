import { useLayoutEffect, useRef } from 'react';
import type { ReactElement, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import {
  EXCAVATOR_PALETTE,
  EXCAVATOR_PALETTE_IDS,
  EXCAVATOR_VOXELS,
  type ExcavatorPaletteId,
} from '../model/excavatorVoxels';
import { assertValidVoxelModel, calculateVoxelBounds } from '../model/voxelModel';
import {
  createVoxelRenderPlan,
  type VoxelRenderBatch,
} from '../model/voxelRenderPlan';
import { resolveVehiclePaintColor } from '../model/vehiclePaint';

const VOXEL_SIZE = 0.24;
const VOXEL_EDGE = VOXEL_SIZE * 0.94;
const ARM_LOWERED_Y = -0.2;
const ARM_RESPONSE = 9;
const VOXEL_GEOMETRY = new THREE.BoxGeometry(VOXEL_EDGE, VOXEL_EDGE, VOXEL_EDGE);

export const EXCAVATOR_RENDER_PLAN = createVoxelRenderPlan(
  EXCAVATOR_VOXELS,
  EXCAVATOR_PALETTE_IDS,
  calculateVoxelBounds(EXCAVATOR_VOXELS),
  VOXEL_SIZE,
);
const EXCAVATOR_MOVING_BATCHES = EXCAVATOR_RENDER_PLAN.batches.filter(
  ({ paletteId }) => paletteId === 'arm' || paletteId === 'bucket',
);
const EXCAVATOR_STATIC_BATCHES = EXCAVATOR_RENDER_PLAN.batches.filter(
  ({ paletteId }) => paletteId !== 'arm' && paletteId !== 'bucket',
);

interface VoxelBatchProps {
  readonly batch: VoxelRenderBatch<ExcavatorPaletteId>;
  readonly paintColor: string | null;
}

export type VoxelExcavatorProps = ThreeElements['group'] & {
  readonly actionActiveRef?: RefObject<boolean>;
  readonly paintColor?: string | null;
};

/** armとbucketの現在Yを押下状態の目標へframe-rate非依存で近づける。 */
export function advanceExcavatorArmOffset(
  currentY: number,
  actionActive: boolean,
  deltaSeconds: number,
): number {
  const safeDelta = Number.isFinite(deltaSeconds)
    ? Math.max(0, Math.min(deltaSeconds, 0.05))
    : 0;
  return THREE.MathUtils.damp(
    currentY,
    actionActive ? ARM_LOWERED_Y : 0,
    ARM_RESPONSE,
    safeDelta,
  );
}

/** 同色voxelを1つのInstancedMeshとして描画する。 */
function VoxelBatch({ batch, paintColor }: VoxelBatchProps): ReactElement {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const material = EXCAVATOR_PALETTE[batch.paletteId];

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
          vehicleId: 'excavator',
        })}
        emissive={'emissive' in material ? material.emissive : undefined}
        emissiveIntensity={'emissiveIntensity' in material ? material.emissiveIntensity : 0}
      />
    </instancedMesh>
  );
}

/** 純voxelショベルカーをpalette別batchで描画し、主操作でarmとbucketを下げる。 */
export function VoxelExcavator({
  actionActiveRef,
  paintColor = null,
  ...groupProps
}: VoxelExcavatorProps): ReactElement {
  const armGroupRef = useRef<THREE.Group>(null);
  assertValidVoxelModel(EXCAVATOR_VOXELS, EXCAVATOR_PALETTE_IDS);

  useFrame((_state, delta) => {
    const armGroup = armGroupRef.current;
    if (!armGroup) return;
    armGroup.position.y = advanceExcavatorArmOffset(
      armGroup.position.y,
      actionActiveRef?.current === true,
      delta,
    );
  });

  return (
    <group {...groupProps}>
      <group position={EXCAVATOR_RENDER_PLAN.offset}>
        {EXCAVATOR_STATIC_BATCHES.map((batch) => (
          <VoxelBatch batch={batch} key={batch.paletteId} paintColor={paintColor} />
        ))}
        <group ref={armGroupRef}>
          {EXCAVATOR_MOVING_BATCHES.map((batch) => (
            <VoxelBatch batch={batch} key={batch.paletteId} paintColor={paintColor} />
          ))}
        </group>
      </group>
    </group>
  );
}

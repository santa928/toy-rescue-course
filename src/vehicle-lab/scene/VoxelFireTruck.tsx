import { useLayoutEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import * as THREE from 'three';
import {
  FIRE_TRUCK_PALETTE,
  FIRE_TRUCK_PALETTE_IDS,
  FIRE_TRUCK_VOXELS,
  type FireTruckPaletteId,
} from '../model/fireTruckVoxels';
import { assertValidVoxelModel, calculateVoxelBounds } from '../model/voxelModel';
import {
  createVoxelRenderPlan,
  type VoxelRenderBatch,
} from '../model/voxelRenderPlan';

const VOXEL_SIZE = 0.24;
const VOXEL_EDGE = VOXEL_SIZE * 0.94;
const VOXEL_GEOMETRY = new THREE.BoxGeometry(VOXEL_EDGE, VOXEL_EDGE, VOXEL_EDGE);

export const FIRE_TRUCK_RENDER_PLAN = createVoxelRenderPlan(
  FIRE_TRUCK_VOXELS,
  FIRE_TRUCK_PALETTE_IDS,
  calculateVoxelBounds(FIRE_TRUCK_VOXELS),
  VOXEL_SIZE,
);

interface VoxelBatchProps {
  readonly batch: VoxelRenderBatch<FireTruckPaletteId>;
}

/** 同色ボクセルを1つのInstancedMeshとして描画する。 */
function VoxelBatch({ batch }: VoxelBatchProps): ReactElement {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const material = FIRE_TRUCK_PALETTE[batch.paletteId];

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }

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
        color={material.color}
        emissive={'emissive' in material ? material.emissive : undefined}
        emissiveIntensity={'emissiveIntensity' in material ? material.emissiveIntensity : 0}
      />
    </instancedMesh>
  );
}

/** 純ボクセル消防車を色別instanceバッチで描画する。 */
export function VoxelFireTruck(): ReactElement {
  assertValidVoxelModel(FIRE_TRUCK_VOXELS, FIRE_TRUCK_PALETTE_IDS);

  return (
    <group position={FIRE_TRUCK_RENDER_PLAN.offset}>
      {FIRE_TRUCK_RENDER_PLAN.batches.map((batch) => (
        <VoxelBatch batch={batch} key={batch.paletteId} />
      ))}
    </group>
  );
}

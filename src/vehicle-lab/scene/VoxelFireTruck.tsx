import { useRef } from 'react';
import type { ReactElement, RefObject } from 'react';
import type { ThreeElements } from '@react-three/fiber';
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
import { resolveVehiclePaintColor } from '../model/vehiclePaint';
import { useVoxelWheelAnimation } from './useVoxelWheelAnimation';

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
  readonly wheelAngleRef?: RefObject<number>;
  readonly batch: VoxelRenderBatch<FireTruckPaletteId>;
  readonly paintColor: string | null;
}

type VoxelFireTruckProps = ThreeElements['group'] & {
  readonly wheelAngleRef?: RefObject<number>;
  readonly paintColor?: string | null;
};

/** 同色ボクセルを1つのInstancedMeshとして描画する。 */
function VoxelBatch({ batch, paintColor, wheelAngleRef }: VoxelBatchProps): ReactElement {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const material = FIRE_TRUCK_PALETTE[batch.paletteId];

  useVoxelWheelAnimation(meshRef, batch, 'fire-truck', wheelAngleRef);

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
          vehicleId: 'fire-truck',
        })}
        emissive={'emissive' in material ? material.emissive : undefined}
        emissiveIntensity={'emissiveIntensity' in material ? material.emissiveIntensity : 0}
      />
    </instancedMesh>
  );
}

/** 純ボクセル消防車を色別instanceバッチで描画する。 */
export function VoxelFireTruck({
  wheelAngleRef,
  paintColor = null,
  ...groupProps
}: VoxelFireTruckProps): ReactElement {
  assertValidVoxelModel(FIRE_TRUCK_VOXELS, FIRE_TRUCK_PALETTE_IDS);

  return (
    <group {...groupProps}>
      <group position={FIRE_TRUCK_RENDER_PLAN.offset}>
        {FIRE_TRUCK_RENDER_PLAN.batches.map((batch) => (
          <VoxelBatch batch={batch} key={batch.paletteId} paintColor={paintColor} wheelAngleRef={wheelAngleRef} />
        ))}
      </group>
    </group>
  );
}

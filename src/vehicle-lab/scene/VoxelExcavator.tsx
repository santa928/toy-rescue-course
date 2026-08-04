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
const EXCAVATOR_ACTION_CYCLE_SECONDS = 0.9;
const BUCKET_PIVOT = [0.12, 0.72, -1.92] as const;
const VOXEL_GEOMETRY = new THREE.BoxGeometry(VOXEL_EDGE, VOXEL_EDGE, VOXEL_EDGE);

export const EXCAVATOR_RENDER_PLAN = createVoxelRenderPlan(
  EXCAVATOR_VOXELS,
  EXCAVATOR_PALETTE_IDS,
  calculateVoxelBounds(EXCAVATOR_VOXELS),
  VOXEL_SIZE,
);
const EXCAVATOR_ARM_BATCHES = EXCAVATOR_RENDER_PLAN.batches.filter(
  ({ paletteId }) => paletteId === 'arm',
);
const EXCAVATOR_BUCKET_BATCHES = EXCAVATOR_RENDER_PLAN.batches.filter(
  ({ paletteId }) => paletteId === 'bucket',
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

export interface ExcavatorActionPose {
  readonly armY: number;
  readonly bucketRotationX: number;
  readonly phase: 'curl' | 'idle' | 'lift' | 'lower' | 'return';
}

const IDLE_EXCAVATOR_POSE: ExcavatorActionPose = {
  armY: 0,
  bucketRotationX: 0,
  phase: 'idle',
};

/** 押下時間をlower、curl、lift、returnの0.9秒掘削poseへ変換する。 */
export function getExcavatorActionPose(
  actionActive: boolean,
  actionElapsedSeconds: number,
): ExcavatorActionPose {
  if (!actionActive || !Number.isFinite(actionElapsedSeconds) || actionElapsedSeconds < 0) {
    return IDLE_EXCAVATOR_POSE;
  }
  const cycle = actionElapsedSeconds % EXCAVATOR_ACTION_CYCLE_SECONDS;
  if (cycle < 0.25) {
    const progress = cycle / 0.25;
    return {
      armY: THREE.MathUtils.lerp(0, -0.26, progress),
      bucketRotationX: 0,
      phase: 'lower',
    };
  }
  if (cycle < 0.5) {
    const progress = (cycle - 0.25) / 0.25;
    return {
      armY: -0.26,
      bucketRotationX: THREE.MathUtils.lerp(0, 0.65, progress),
      phase: 'curl',
    };
  }
  if (cycle < 0.72) {
    const progress = (cycle - 0.5) / 0.22;
    return {
      armY: THREE.MathUtils.lerp(-0.26, -0.06, progress),
      bucketRotationX: 0.65,
      phase: 'lift',
    };
  }
  const progress = (cycle - 0.72) / 0.18;
  return {
    armY: THREE.MathUtils.lerp(-0.06, 0, progress),
    bucketRotationX: THREE.MathUtils.lerp(0.65, 0, progress),
    phase: 'return',
  };
}

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
  const bucketPivotRef = useRef<THREE.Group>(null);
  const actionElapsedSecondsRef = useRef(0);
  assertValidVoxelModel(EXCAVATOR_VOXELS, EXCAVATOR_PALETTE_IDS);

  useFrame((_state, delta) => {
    const armGroup = armGroupRef.current;
    const bucketPivot = bucketPivotRef.current;
    if (!armGroup || !bucketPivot) return;
    const actionActive = actionActiveRef?.current === true;
    actionElapsedSecondsRef.current = actionActive
      ? actionElapsedSecondsRef.current + Math.max(0, Math.min(delta, 0.05))
      : 0;
    const pose = getExcavatorActionPose(actionActive, actionElapsedSecondsRef.current);
    armGroup.position.y = pose.armY;
    bucketPivot.rotation.x = pose.bucketRotationX;
  });

  return (
    <group {...groupProps}>
      <group position={EXCAVATOR_RENDER_PLAN.offset}>
        {EXCAVATOR_STATIC_BATCHES.map((batch) => (
          <VoxelBatch batch={batch} key={batch.paletteId} paintColor={paintColor} />
        ))}
        <group ref={armGroupRef}>
          {EXCAVATOR_ARM_BATCHES.map((batch) => (
            <VoxelBatch batch={batch} key={batch.paletteId} paintColor={paintColor} />
          ))}
          <group position={BUCKET_PIVOT} ref={bucketPivotRef}>
            <group position={[-BUCKET_PIVOT[0], -BUCKET_PIVOT[1], -BUCKET_PIVOT[2]]}>
              {EXCAVATOR_BUCKET_BATCHES.map((batch) => (
                <VoxelBatch batch={batch} key={batch.paletteId} paintColor={paintColor} />
              ))}
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

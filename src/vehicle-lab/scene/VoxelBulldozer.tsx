import { useLayoutEffect, useRef } from 'react';
import type { ReactElement, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import {
  BULLDOZER_PALETTE,
  BULLDOZER_PALETTE_IDS,
  BULLDOZER_VOXELS,
  type BulldozerPaletteId,
} from '../model/bulldozerVoxels';
import { assertValidVoxelModel, calculateVoxelBounds } from '../model/voxelModel';
import {
  createVoxelRenderPlan,
  type VoxelRenderBatch,
} from '../model/voxelRenderPlan';
import { resolveVehiclePaintColor } from '../model/vehiclePaint';

const VOXEL_SIZE = 0.24;
const VOXEL_EDGE = VOXEL_SIZE * 0.94;
const BLADE_LOWERED_Y = -0.12;
const BLADE_RESPONSE = 12;
const BLADE_ACTION_CYCLE_SECONDS = 0.55;
const VOXEL_GEOMETRY = new THREE.BoxGeometry(VOXEL_EDGE, VOXEL_EDGE, VOXEL_EDGE);

export const BULLDOZER_RENDER_PLAN = createVoxelRenderPlan(
  BULLDOZER_VOXELS,
  BULLDOZER_PALETTE_IDS,
  calculateVoxelBounds(BULLDOZER_VOXELS),
  VOXEL_SIZE,
);

interface VoxelBatchProps {
  readonly batch: VoxelRenderBatch<BulldozerPaletteId>;
  readonly paintColor: string | null;
}

export type VoxelBulldozerProps = ThreeElements['group'] & {
  readonly actionActiveRef?: RefObject<boolean>;
  readonly paintColor?: string | null;
};

export interface BulldozerActionPose {
  readonly bladeY: number;
  readonly bodyScaleY: number;
  readonly phase: 'bounce' | 'hold' | 'idle' | 'impact' | 'reset' | 'slam';
}

const IDLE_ACTION_POSE: BulldozerActionPose = {
  bladeY: 0,
  bodyScaleY: 1,
  phase: 'idle',
};

/** 押下時間をblade slam、impact、bounce、hold、resetの玩具poseへ変換する。 */
export function getBulldozerActionPose(
  actionActive: boolean,
  actionElapsedSeconds: number,
): BulldozerActionPose {
  if (!actionActive || !Number.isFinite(actionElapsedSeconds) || actionElapsedSeconds < 0) {
    return IDLE_ACTION_POSE;
  }

  const cycle = actionElapsedSeconds % BLADE_ACTION_CYCLE_SECONDS;
  if (cycle < 0.1) {
    const progress = cycle / 0.1;
    return {
      bladeY: THREE.MathUtils.lerp(0, -0.14, progress),
      bodyScaleY: THREE.MathUtils.lerp(1, 0.97, progress),
      phase: 'slam',
    };
  }
  if (cycle < 0.15) {
    return {
      bladeY: -0.18,
      bodyScaleY: 0.96,
      phase: 'impact',
    };
  }
  if (cycle < 0.27) {
    const progress = (cycle - 0.15) / 0.12;
    return {
      bladeY: THREE.MathUtils.lerp(-0.18, -0.1, progress),
      bodyScaleY: THREE.MathUtils.lerp(0.96, 1.01, progress),
      phase: 'bounce',
    };
  }
  if (cycle < 0.43) {
    return {
      bladeY: -0.12,
      bodyScaleY: 1,
      phase: 'hold',
    };
  }
  const progress = (cycle - 0.43) / 0.12;
  return {
    bladeY: THREE.MathUtils.lerp(-0.12, 0, progress),
    bodyScaleY: 1,
    phase: 'reset',
  };
}

/** bladeの現在Yを押下状態の目標へframe-rate非依存で近づける。 */
export function advanceBulldozerBladeOffset(
  currentY: number,
  actionActive: boolean,
  deltaSeconds: number,
): number {
  const safeDelta = Number.isFinite(deltaSeconds)
    ? Math.max(0, Math.min(deltaSeconds, 0.05))
    : 0;
  return THREE.MathUtils.damp(
    currentY,
    actionActive ? BLADE_LOWERED_Y : 0,
    BLADE_RESPONSE,
    safeDelta,
  );
}

/** 同色voxelを1つのInstancedMeshとして描画する。 */
function VoxelBatch({ batch, paintColor }: VoxelBatchProps): ReactElement {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const material = BULLDOZER_PALETTE[batch.paletteId];

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
          vehicleId: 'bulldozer',
        })}
        emissive={'emissive' in material ? material.emissive : undefined}
        emissiveIntensity={'emissiveIntensity' in material ? material.emissiveIntensity : 0}
      />
    </instancedMesh>
  );
}

/** 純voxelブルドーザーをpalette別batchで描画し、primary actionでbladeを下げる。 */
export function VoxelBulldozer({
  actionActiveRef,
  paintColor = null,
  ...groupProps
}: VoxelBulldozerProps): ReactElement {
  const bladeGroupRef = useRef<THREE.Group>(null);
  const bodyVisualGroupRef = useRef<THREE.Group>(null);
  const actionElapsedSecondsRef = useRef(0);
  assertValidVoxelModel(BULLDOZER_VOXELS, BULLDOZER_PALETTE_IDS);

  useFrame((_state, delta) => {
    const bladeGroup = bladeGroupRef.current;
    const bodyVisualGroup = bodyVisualGroupRef.current;
    if (!bladeGroup || !bodyVisualGroup) return;
    const actionActive = actionActiveRef?.current === true;
    actionElapsedSecondsRef.current = actionActive
      ? actionElapsedSecondsRef.current + Math.max(0, Math.min(delta, 0.05))
      : 0;
    const pose = getBulldozerActionPose(actionActive, actionElapsedSecondsRef.current);
    bladeGroup.position.y = pose.bladeY;
    bodyVisualGroup.scale.y = pose.bodyScaleY;
  });

  return (
    <group {...groupProps}>
      <group position={BULLDOZER_RENDER_PLAN.offset} ref={bodyVisualGroupRef}>
        {BULLDOZER_RENDER_PLAN.batches.map((batch) => (
          batch.paletteId === 'blade' ? (
            <group key={batch.paletteId} ref={bladeGroupRef}>
              <VoxelBatch batch={batch} paintColor={paintColor} />
            </group>
          ) : (
            <VoxelBatch batch={batch} key={batch.paletteId} paintColor={paintColor} />
          )
        ))}
      </group>
    </group>
  );
}

import { useLayoutEffect, useMemo } from 'react';
import type { RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { VoxelRenderBatch } from '../model/voxelRenderPlan';
import { findWheelCenter, writeWheelMatrix, type WheeledVehicleId } from '../model/vehicleWheelMotion';

/** 色別batchを維持したまま、車輪セルのinstanceだけを走行角へ更新する。展示時は静止する。 */
export function useVoxelWheelAnimation(
  meshRef: RefObject<THREE.InstancedMesh | null>,
  batch: VoxelRenderBatch<string>,
  vehicleId: WheeledVehicleId,
  wheelAngleRef?: RefObject<number>,
): void {
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const wheels = useMemo(() => batch.positions.flatMap((position, index) => {
    const center = findWheelCenter(vehicleId, position);
    return center ? [{ index, position, center }] : [];
  }), [batch.positions, vehicleId]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    delete mesh.userData.wheelAngle;
    batch.positions.forEach(([x, y, z], index) => {
      matrix.makeTranslation(x, y, z);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    // タイヤの回転で変わる外接分を一度だけ拡げ、毎frameの全instance走査を避ける。
    if (wheels.length && mesh.boundingSphere) mesh.boundingSphere.radius += 0.24;
  }, [batch.positions, matrix, meshRef, wheels]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || !wheels.length || !wheelAngleRef) return;
    const angle = wheelAngleRef.current;
    if (mesh.userData.wheelAngle === angle) return;
    for (const wheel of wheels) {
      writeWheelMatrix(matrix, wheel.position, wheel.center, angle);
      mesh.setMatrixAt(wheel.index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.wheelAngle = angle;
  });
}

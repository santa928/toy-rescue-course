import { useLayoutEffect, useMemo } from 'react';
import type { RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { VoxelRenderBatch } from '../model/voxelRenderPlan';
import { findTrackLink, writeTrackMatrix, type TrackTravel, type TrackedVehicleId } from '../model/vehicleTrackMotion';

/** 色別batch内の踏み板だけを循環させ、内部の転輪や作業道具は固定する。 */
export function useVoxelTrackAnimation(
  meshRef: RefObject<THREE.InstancedMesh | null>, batch: VoxelRenderBatch<string>,
  id: TrackedVehicleId, travelRef?: RefObject<TrackTravel>,
): void {
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const links = useMemo(() => batch.positions.flatMap((position, index) => {
    const link = findTrackLink(id, position);
    return link ? [{ index, link }] : [];
  }), [batch.positions, id]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    delete mesh.userData.trackLeft;
    delete mesh.userData.trackRight;
    batch.positions.forEach(([x, y, z], index) => {
      matrix.makeTranslation(x, y, z);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    if (links.length && mesh.boundingSphere) mesh.boundingSphere.radius += 0.24;
  }, [batch.positions, links, matrix, meshRef]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || !links.length || !travelRef) return;
    const { left, right } = travelRef.current;
    if (mesh.userData.trackLeft === left && mesh.userData.trackRight === right) return;
    for (const { index, link } of links) {
      writeTrackMatrix(matrix, link, travelRef.current[link.side], id);
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.trackLeft = left;
    mesh.userData.trackRight = right;
  });
}

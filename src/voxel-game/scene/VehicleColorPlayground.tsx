import { useLayoutEffect, useRef } from 'react';
import type { ReactElement, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { VehicleColorId } from './productionWorldMap';
import {
  COLOR_PLAY_POOL_SLOT_COUNT,
  COLOR_PLAY_SHOWER_SLOT_COUNT,
  createColorPlayStationBoxes,
  createColorPlayVfxFrame,
  updateColorPlayVfxFrame,
  type ColorPlayStationBox,
  type ColorPlayVfxFrame,
} from './colorPlayVfx';

const UNIT_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const COLOR_INSTANCE_CAPACITY = COLOR_PLAY_POOL_SLOT_COUNT + COLOR_PLAY_SHOWER_SLOT_COUNT;
const STATION_BOXES = createColorPlayStationBoxes();
const COLOR_HEX: Readonly<Record<VehicleColorId, string>> = {
  blue: '#3b82f6',
  red: '#ef4444',
  yellow: '#facc15',
};

/** 指定色の固定slotだけを1つのInstancedMeshへin-place転送する。 */
function applyColorTransforms(
  mesh: THREE.InstancedMesh | null,
  frame: ColorPlayVfxFrame,
  colorId: VehicleColorId,
  matrix: THREE.Matrix4,
): void {
  if (!mesh) return;
  let instanceIndex = 0;
  for (const instance of frame.instances) {
    if (instance.colorId !== colorId) continue;
    matrix.makeScale(instance.scale[0], instance.scale[1], instance.scale[2]);
    matrix.setPosition(instance.position[0], instance.position[1], instance.position[2]);
    mesh.setMatrixAt(instanceIndex, matrix);
    instanceIndex += 1;
  }
  mesh.count = instanceIndex;
  mesh.instanceMatrix.needsUpdate = true;
}

/** 静的box群を初回だけ同色InstancedMeshへ転送する。 */
function StaticBoxBatch({
  boxes,
  color,
}: {
  readonly boxes: readonly ColorPlayStationBox[];
  readonly color: string;
}): ReactElement {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index];
      matrix.makeScale(box.scale[0], box.scale[1], box.scale[2]);
      matrix.setPosition(box.position[0], box.position[1], box.position[2]);
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [boxes]);

  return (
    <instancedMesh args={[UNIT_GEOMETRY, undefined, boxes.length]} dispose={null} ref={meshRef}>
      <meshLambertMaterial color={color} />
    </instancedMesh>
  );
}

/** 1色26slotの動的voxel batchを構成する。 */
function ColorVoxelBatch({
  colorId,
  meshRef,
}: {
  readonly colorId: VehicleColorId;
  readonly meshRef: RefObject<THREE.InstancedMesh | null>;
}): ReactElement {
  return (
    <instancedMesh
      args={[UNIT_GEOMETRY, undefined, COLOR_INSTANCE_CAPACITY]}
      dispose={null}
      ref={meshRef}
    >
      <meshLambertMaterial color={COLOR_HEX[colorId]} />
    </instancedMesh>
  );
}

/** 南地区へ玩具の色水poolとアーチshowerを5 draw callの固定batchで描画する。 */
export function VehicleColorPlayground(): ReactElement {
  const redMeshRef = useRef<THREE.InstancedMesh>(null);
  const blueMeshRef = useRef<THREE.InstancedMesh>(null);
  const yellowMeshRef = useRef<THREE.InstancedMesh>(null);
  const frameRef = useRef<ColorPlayVfxFrame | null>(null);
  if (frameRef.current === null) frameRef.current = createColorPlayVfxFrame();
  const matrixRef = useRef<THREE.Matrix4 | null>(null);
  if (matrixRef.current === null) matrixRef.current = new THREE.Matrix4();

  useFrame(({ clock }) => {
    const frame = frameRef.current;
    const matrix = matrixRef.current;
    if (!frame || !matrix) return;
    updateColorPlayVfxFrame(frame, clock.elapsedTime);
    applyColorTransforms(redMeshRef.current, frame, 'red', matrix);
    applyColorTransforms(blueMeshRef.current, frame, 'blue', matrix);
    applyColorTransforms(yellowMeshRef.current, frame, 'yellow', matrix);
  });

  return (
    <group>
      <ColorVoxelBatch colorId="red" meshRef={redMeshRef} />
      <ColorVoxelBatch colorId="blue" meshRef={blueMeshRef} />
      <ColorVoxelBatch colorId="yellow" meshRef={yellowMeshRef} />
      <StaticBoxBatch boxes={STATION_BOXES.frameBoxes} color="#fff7e5" />
      <StaticBoxBatch boxes={STATION_BOXES.baseBoxes} color="#30343a" />
    </group>
  );
}

import { useRef } from 'react';
import type { ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { VehicleColorId } from './productionWorldMap';
import {
  COLOR_PLAY_TOTAL_CUBE_COUNT,
  createColorPlayStationBoxes,
  createColorPlayVfxFrame,
  updateColorPlayVfxFrame,
  type ColorPlayStationBox,
  type ColorPlayVfxFrame,
} from './colorPlayVfx';

const UNIT_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const STATION_BOXES = createColorPlayStationBoxes();
const COLOR_INSTANCE_CAPACITY = (
  COLOR_PLAY_TOTAL_CUBE_COUNT
  + STATION_BOXES.frameBoxes.length
  + STATION_BOXES.baseBoxes.length
);
const COLOR_HEX: Readonly<Record<VehicleColorId, string>> = {
  blue: '#3b82f6',
  red: '#ef4444',
  yellow: '#facc15',
};
const COLOR_THREE: Readonly<Record<VehicleColorId, THREE.Color>> = {
  blue: new THREE.Color(COLOR_HEX.blue),
  red: new THREE.Color(COLOR_HEX.red),
  yellow: new THREE.Color(COLOR_HEX.yellow),
};
const FRAME_COLOR = new THREE.Color('#fff7e5');
const BASE_COLOR = new THREE.Color('#30343a');

/** 静的box群を統合batchの末尾へ追記する。 */
function appendStationBoxes(
  mesh: THREE.InstancedMesh,
  boxes: readonly ColorPlayStationBox[],
  color: THREE.Color,
  matrix: THREE.Matrix4,
  startIndex: number,
): number {
  let instanceIndex = startIndex;
  for (const box of boxes) {
    matrix.makeScale(box.scale[0], box.scale[1], box.scale[2]);
    matrix.setPosition(box.position[0], box.position[1], box.position[2]);
    mesh.setMatrixAt(instanceIndex, matrix);
    mesh.setColorAt(instanceIndex, color);
    instanceIndex += 1;
  }
  return instanceIndex;
}

/** 動的voxelと静的stationをinstance色付き1 batchへin-place転送する。 */
function applyPlaygroundTransforms(
  mesh: THREE.InstancedMesh | null,
  frame: ColorPlayVfxFrame,
  matrix: THREE.Matrix4,
): void {
  if (!mesh) return;
  let instanceIndex = 0;
  for (const instance of frame.instances) {
    matrix.makeScale(instance.scale[0], instance.scale[1], instance.scale[2]);
    matrix.setPosition(instance.position[0], instance.position[1], instance.position[2]);
    mesh.setMatrixAt(instanceIndex, matrix);
    mesh.setColorAt(instanceIndex, COLOR_THREE[instance.colorId]);
    instanceIndex += 1;
  }
  instanceIndex = appendStationBoxes(
    mesh,
    STATION_BOXES.frameBoxes,
    FRAME_COLOR,
    matrix,
    instanceIndex,
  );
  instanceIndex = appendStationBoxes(
    mesh,
    STATION_BOXES.baseBoxes,
    BASE_COLOR,
    matrix,
    instanceIndex,
  );
  mesh.count = instanceIndex;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** 南地区の色水pool・アーチshower・stationを1 draw callの固定batchで描画する。 */
export function VehicleColorPlayground(): ReactElement {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const frameRef = useRef<ColorPlayVfxFrame | null>(null);
  if (frameRef.current === null) frameRef.current = createColorPlayVfxFrame();
  const matrixRef = useRef<THREE.Matrix4 | null>(null);
  if (matrixRef.current === null) matrixRef.current = new THREE.Matrix4();
  const instanceColorsRef = useRef<Float32Array | null>(null);
  if (instanceColorsRef.current === null) {
    instanceColorsRef.current = new Float32Array(COLOR_INSTANCE_CAPACITY * 3);
    instanceColorsRef.current.fill(1);
  }

  useFrame(({ clock }) => {
    const frame = frameRef.current;
    const matrix = matrixRef.current;
    if (!frame || !matrix) return;
    updateColorPlayVfxFrame(frame, clock.elapsedTime);
    applyPlaygroundTransforms(meshRef.current, frame, matrix);
  });

  return (
    <instancedMesh
      args={[UNIT_GEOMETRY, undefined, COLOR_INSTANCE_CAPACITY]}
      dispose={null}
      frustumCulled={false}
      ref={meshRef}
    >
      <instancedBufferAttribute
        args={[instanceColorsRef.current, 3]}
        attach="instanceColor"
      />
      <meshLambertMaterial color="#ffffff" />
    </instancedMesh>
  );
}

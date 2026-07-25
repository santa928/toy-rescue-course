import { useLayoutEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { BLOCK_PLAZA, PARK_CENTER } from './worldLayout';
import {
  FIRE_BUILDING_BODY,
  GARAGE_WALLS,
  PLAYGROUND_PLANK,
  PLAYGROUND_SUPPORT,
  TREE_TRUNKS,
  WORLD_SOLID_BOXES,
  scaleToHalfExtents,
} from './worldCollisionLayout';

/** InstancedMeshへ渡す共有直方体の変換情報。 */
interface BoxInstance {
  readonly position: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
}

interface InstancedBoxesProps {
  readonly boxes: readonly BoxInstance[];
  readonly color: string;
}

const ROAD_SEGMENTS: readonly BoxInstance[] = [
  { position: [0, 0.08, -15], scale: [36, 0.18, 4] },
  { position: [0, 0.08, 15], scale: [36, 0.18, 4] },
  { position: [-15, 0.08, 0], scale: [4, 0.18, 26] },
  { position: [15, 0.08, 0], scale: [4, 0.18, 26] },
];

const ROAD_LINES: readonly BoxInstance[] = [
  { position: [0, 0.19, -15], scale: [30, 0.05, 0.22] },
  { position: [0, 0.19, 15], scale: [30, 0.05, 0.22] },
  { position: [-15, 0.19, 0], scale: [0.22, 0.05, 26] },
  { position: [15, 0.19, 0], scale: [0.22, 0.05, 26] },
];

const TREE_CROWNS: readonly BoxInstance[] = TREE_TRUNKS.map(({ position }) => ({
  position: [position[0], 2.85, position[2]],
  scale: [2.2, 1.4, 2.2],
}));

/** 同じmaterialの直方体を1 draw callへまとめる。 */
function InstancedBoxes({ boxes, color }: InstancedBoxesProps): ReactElement {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    boxes.forEach((box, index) => {
      position.fromArray(box.position);
      scale.fromArray(box.scale);
      const [rotationX, rotationY, rotationZ] = box.rotation ?? [0, 0, 0];
      euler.set(rotationX, rotationY, rotationZ, 'XYZ');
      quaternion.setFromEuler(euler);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [boxes]);

  return (
    <instancedMesh args={[undefined, undefined, boxes.length]} ref={meshRef}>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial color={color} />
    </instancedMesh>
  );
}

/** 中央公園、池、木3本、直方体遊具を描画する。 */
function VoxelPark(): ReactElement {
  return (
    <group position={PARK_CENTER}>
      <mesh position={[0, 0.18, 0]}>
        <boxGeometry args={[12, 0.34, 8]} />
        <meshLambertMaterial color="#78a94f" />
      </mesh>
      <mesh position={[1.1, 0.4, -0.4]}>
        <boxGeometry args={[4.5, 0.18, 2.8]} />
        <meshLambertMaterial color="#67c7df" />
      </mesh>
      <InstancedBoxes boxes={TREE_TRUNKS} color="#86552f" />
      <InstancedBoxes boxes={TREE_CROWNS} color="#3f7f3a" />
      <mesh position={PLAYGROUND_PLANK.position} rotation={PLAYGROUND_PLANK.rotation}>
        <boxGeometry args={PLAYGROUND_PLANK.scale} />
        <meshLambertMaterial color="#e24b3f" />
      </mesh>
      <mesh position={PLAYGROUND_SUPPORT.position}>
        <boxGeometry args={PLAYGROUND_SUPPORT.scale} />
        <meshLambertMaterial color="#f2c94c" />
      </mesh>
    </group>
  );
}

/** 南側に白壁と赤い屋根・帯を持つ消防車庫を描画する。 */
function VoxelGarage(): ReactElement {
  return (
    <group>
      <InstancedBoxes boxes={GARAGE_WALLS} color="#f1efe6" />
      <mesh position={[0, 3.65, 11.8]}>
        <boxGeometry args={[8.8, 0.5, 1.2]} />
        <meshLambertMaterial color="#c83e34" />
      </mesh>
      <mesh position={[0, 3.35, 14.35]}>
        <boxGeometry args={[8.8, 0.45, 0.35]} />
        <meshLambertMaterial color="#c83e34" />
      </mesh>
    </group>
  );
}

/** 北東に木壁と窓を持つ火災建物を描画する。 */
function VoxelFireBuilding(): ReactElement {
  return (
    <group>
      <mesh position={FIRE_BUILDING_BODY.position}>
        <boxGeometry args={FIRE_BUILDING_BODY.scale} />
        <meshLambertMaterial color="#a86f3f" />
      </mesh>
      <mesh position={[9.5, 3.75, -9.5]}>
        <boxGeometry args={[6.8, 0.5, 5.8]} />
        <meshLambertMaterial color="#6f4327" />
      </mesh>
      <mesh position={[8.2, 1.9, -12.05]}>
        <boxGeometry args={[1.5, 1.5, 0.18]} />
        <meshLambertMaterial color="#7ed1e6" />
      </mesh>
      <mesh position={[10.8, 1.9, -12.05]}>
        <boxGeometry args={[1.5, 1.5, 0.18]} />
        <meshLambertMaterial color="#7ed1e6" />
      </mesh>
    </group>
  );
}

/** 共有visual定義から9個の静的solidを単一fixed bodyに構成する。 */
export function WorldSolidColliders(): ReactElement {
  return (
    <RigidBody colliders={false} type="fixed">
      {WORLD_SOLID_BOXES.map(({ id, position, rotation, scale }) => (
        <CuboidCollider
          args={scaleToHalfExtents(scale)}
          key={id}
          position={position}
          rotation={rotation}
        />
      ))}
    </RigidBody>
  );
}

/** 西側の積み木広場の土台を描画する。 */
function VoxelBlockPlaza(): ReactElement {
  return (
    <group>
      <mesh position={BLOCK_PLAZA.position}>
        <boxGeometry args={BLOCK_PLAZA.scale} />
        <meshLambertMaterial color="#e1c78c" />
      </mesh>
    </group>
  );
}

/** 36×36の木製床と道路、各ランドマークを純ボクセルで構成する。 */
export function VoxelWorld(): ReactElement {
  return (
    <group>
      <mesh position={[0, -0.2, 0]}>
        <boxGeometry args={[36, 0.4, 36]} />
        <meshLambertMaterial color="#d7b07a" />
      </mesh>
      <InstancedBoxes boxes={ROAD_SEGMENTS} color="#3f4248" />
      <InstancedBoxes boxes={ROAD_LINES} color="#f0c94a" />
      <VoxelPark />
      <VoxelGarage />
      <VoxelFireBuilding />
      <VoxelBlockPlaza />
      <WorldSolidColliders />
    </group>
  );
}

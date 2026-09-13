import { useLayoutEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import {
  PRODUCTION_WORLD_MAP,
  type WorldRoadDefinition,
  type WorldSurfaceTileDefinition,
} from './productionWorldMap';
import { flattenDecorationBoxes } from './worldStreetscape';
import {
  WORLD_GROUND_BOX,
  WORLD_SOLID_BOXES,
  scaleToHalfExtents,
} from './worldCollisionLayout';

/** InstancedMeshへ渡す共有直方体の変換情報。 */
interface BoxInstance {
  readonly color?: string;
  readonly position: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
}

interface InstancedBoxesProps {
  readonly boxes: readonly BoxInstance[];
  readonly color: string;
}

const ROAD_MARKING_Y = 0.19;
const ROAD_MARKING_THICKNESS = 0.05;
const ROAD_MARKING_SHORT_AXIS = 0.22;
const HUB_INTERSECTION_CLEARANCE = 3;

/** 道路の長軸へ線を置き、中央2道路だけ交差点中央3unitを空ける。 */
function buildRoadMarkingBoxes(road: WorldRoadDefinition): readonly BoxInstance[] {
  const isHorizontal = road.scale[0] >= road.scale[2];
  const longAxis = isHorizontal ? road.scale[0] : road.scale[2];
  const isHubIntersectionRoad = (
    road.id === 'road-hub-east-west' || road.id === 'road-hub-north-south'
  );
  if (!isHubIntersectionRoad) {
    return [{
      position: [road.position[0], ROAD_MARKING_Y, road.position[2]],
      scale: isHorizontal
        ? [longAxis, ROAD_MARKING_THICKNESS, ROAD_MARKING_SHORT_AXIS]
        : [ROAD_MARKING_SHORT_AXIS, ROAD_MARKING_THICKNESS, longAxis],
    }];
  }

  if (road.id === 'road-hub-north-south') {
    return [
      { position: [0, ROAD_MARKING_Y, -17.75], scale: [ROAD_MARKING_SHORT_AXIS, ROAD_MARKING_THICKNESS, 32.5] },
      { position: [0, ROAD_MARKING_Y, 22.1], scale: [ROAD_MARKING_SHORT_AXIS, ROAD_MARKING_THICKNESS, 23.8] },
    ];
  }

  const segmentLength = (longAxis - HUB_INTERSECTION_CLEARANCE) / 2;
  const centerOffset = HUB_INTERSECTION_CLEARANCE / 2 + segmentLength / 2;
  return [-centerOffset, centerOffset].map((offset) => ({
    position: isHorizontal
      ? [road.position[0] + offset, ROAD_MARKING_Y, road.position[2]]
      : [road.position[0], ROAD_MARKING_Y, road.position[2] + offset],
    scale: isHorizontal
      ? [segmentLength, ROAD_MARKING_THICKNESS, ROAD_MARKING_SHORT_AXIS]
      : [ROAD_MARKING_SHORT_AXIS, ROAD_MARKING_THICKNESS, segmentLength],
  }));
}

/** 帰庫前庭を道路の上へ積まず、路面を前庭の境界で分ける。 */
export const WORLD_ROAD_RENDER_BOXES = PRODUCTION_WORLD_MAP.roads.flatMap<WorldRoadDefinition>(road => {
  if (road.id !== 'road-hub-north-south') return [road];
  return [
    { ...road, position: [0, 0.08, -16] as const, scale: [5, 0.18, 36] as const },
    { ...road, position: [0, 0.08, 22] as const, scale: [5, 0.18, 24] as const },
  ];
});

const ROAD_MARKING_BOXES = PRODUCTION_WORLD_MAP.roads.flatMap(buildRoadMarkingBoxes);
const WORLD_RENDER_BOXES = [
  ...PRODUCTION_WORLD_MAP.visualBoxes,
  ...flattenDecorationBoxes(PRODUCTION_WORLD_MAP.decorationClusters),
] as const;


/** 個別色をinstance属性へ格納し、街の固定部品を1 draw callへまとめる。 */
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
    const instanceColor = new THREE.Color();
    boxes.forEach((box, index) => {
      position.fromArray(box.position);
      scale.fromArray(box.scale);
      const [rotationX, rotationY, rotationZ] = box.rotation ?? [0, 0, 0];
      euler.set(rotationX, rotationY, rotationZ, 'XYZ');
      quaternion.setFromEuler(euler);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      if (box.color) mesh.setColorAt(index, instanceColor.set(box.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [boxes]);

  return (
    <instancedMesh args={[undefined, undefined, boxes.length]} ref={meshRef}>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial color={color} />
    </instancedMesh>
  );
}

/** 地区床の全matrixと色を1つのInstancedMeshへ固定し、palette数をdraw callへ反映させない。 */
export function InstancedSurfaceTiles({
  tiles,
}: {
  readonly tiles: readonly WorldSurfaceTileDefinition[];
}): ReactElement {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    const quaternion = new THREE.Quaternion();
    tiles.forEach((tile, index) => {
      position.fromArray(tile.position);
      scale.fromArray(tile.scale);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, color.set(tile.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [tiles]);

  return (
    <instancedMesh args={[undefined, undefined, tiles.length]} ref={meshRef}>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial color="#ffffff" />
    </instancedMesh>
  );
}

/** 共有visual定義から静的solidを単一fixed bodyに構成する。 */
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

/** 96×96の木製床と道路、全地区のランドマークを安定batchで構成する。 */
export function VoxelWorld(): ReactElement {
  return (
    <group>
      <mesh position={WORLD_GROUND_BOX.position}>
        <boxGeometry args={WORLD_GROUND_BOX.scale} />
        <meshLambertMaterial color="#d7b07a" />
      </mesh>
      <InstancedSurfaceTiles tiles={PRODUCTION_WORLD_MAP.surfaceTiles} />
      <InstancedBoxes boxes={WORLD_ROAD_RENDER_BOXES} color="#3f4248" />
      <InstancedBoxes boxes={ROAD_MARKING_BOXES} color="#f0c94a" />
      <InstancedBoxes boxes={WORLD_RENDER_BOXES} color="#ffffff" />
      <WorldSolidColliders />
    </group>
  );
}

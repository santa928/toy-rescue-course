import { useLayoutEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import {
  PRODUCTION_WORLD_MAP,
  type WorldBoxDefinition,
  type WorldRoadDefinition,
} from './productionWorldMap';
import {
  WORLD_GROUND_BOX,
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

/** boxをmaterial色ごとの安定したbatchへまとめる。 */
export function groupWorldBoxesByColor(
  boxes: readonly WorldBoxDefinition[],
): readonly { readonly boxes: readonly WorldBoxDefinition[]; readonly color: string }[] {
  const groups = new Map<string, WorldBoxDefinition[]>();
  for (const box of boxes) {
    const group = groups.get(box.color) ?? [];
    group.push(box);
    groups.set(box.color, group);
  }
  return [...groups.entries()].map(([color, groupedBoxes]) => ({
    boxes: groupedBoxes,
    color,
  }));
}

const ROAD_MARKING_BOXES = PRODUCTION_WORLD_MAP.roads.flatMap(buildRoadMarkingBoxes);
const WORLD_VISUAL_BATCHES = groupWorldBoxesByColor(PRODUCTION_WORLD_MAP.visualBoxes);

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
      <InstancedBoxes boxes={PRODUCTION_WORLD_MAP.roads} color="#3f4248" />
      <InstancedBoxes boxes={ROAD_MARKING_BOXES} color="#f0c94a" />
      {WORLD_VISUAL_BATCHES.map(({ boxes, color }) => (
        <InstancedBoxes boxes={boxes} color={color} key={color} />
      ))}
      <WorldSolidColliders />
    </group>
  );
}

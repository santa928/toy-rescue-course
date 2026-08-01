import { Children, createElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoxelWorld, WorldSolidColliders } from '../voxel-game/scene/VoxelWorld';
import { PRODUCTION_WORLD_MAP } from '../voxel-game/scene/productionWorldMap';
import {
  FIRE_BUILDING_BODY,
  GARAGE_WALLS,
  PLAYGROUND_PLANK,
  PLAYGROUND_SOLIDS,
  PLAYGROUND_SUPPORT,
  TREE_TRUNKS,
  VEHICLE_COLLIDER_HALF_EXTENTS,
  WORLD_GROUND_BOX,
  WORLD_SOLID_BOXES,
  getAxisAlignedSeparation,
  isValidBoxDefinition,
  scaleToHalfExtents,
} from '../voxel-game/scene/worldCollisionLayout';
import { GARAGE_POSITION } from '../voxel-game/scene/worldLayout';

interface InspectedElementProps {
  readonly args?: readonly [number, number, number];
  readonly children?: ReactNode;
  readonly colliders?: boolean;
  readonly position?: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
  readonly type?: string;
}

const rapierRenderRecords = vi.hoisted(() => ({
  cuboidColliders: [] as InspectedElementProps[],
  rigidBodies: [] as InspectedElementProps[],
}));

vi.mock('@react-three/rapier', async () => {
  const { createElement: createReactElement, Fragment } = await import('react');
  return {
    CuboidCollider: (props: InspectedElementProps): null => {
      rapierRenderRecords.cuboidColliders.push(props);
      return null;
    },
    RigidBody: ({ children, ...props }: InspectedElementProps): ReactElement => {
      rapierRenderRecords.rigidBodies.push(props);
      return createReactElement(Fragment, null, children);
    },
  };
});

/** React nodeが構成検査可能なelementであることを確認して返す。 */
function inspectElement(node: ReactNode): ReactElement<InspectedElementProps> {
  expect(isValidElement<InspectedElementProps>(node)).toBe(true);
  return node as ReactElement<InspectedElementProps>;
}

/** DOM rendererが出すR3F固有tagの大小文字警告だけを検査render中に抑える。 */
function renderVoxelWorldForPhysicsInspection(): void {
  const consoleErrors: unknown[][] = [];
  const consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args);
  });
  try {
    renderToStaticMarkup(createElement(VoxelWorld));
  } finally {
    consoleError.mockRestore();
  }
  expect(consoleErrors.every(([message]) => String(message).includes('is using incorrect casing'))).toBe(true);
}

describe('worldCollisionLayout', () => {
  beforeEach(() => {
    rapierRenderRecords.cuboidColliders.length = 0;
    rapierRenderRecords.rigidBodies.length = 0;
  });

  it('本番mapのsolid:trueだけを12個のstatic colliderとして公開する', () => {
    expect(WORLD_SOLID_BOXES.map(({ id }) => id)).toEqual([
      'tree-trunk-1',
      'tree-trunk-2',
      'tree-trunk-3',
      'playground-plank',
      'playground-support',
      'garage-back-wall',
      'garage-left-wall',
      'garage-right-wall',
      'fire-building-body',
      'hub-gate-post',
      'south-sign-post-west',
      'south-sign-post-east',
    ]);
    expect(WORLD_SOLID_BOXES).toEqual(
      PRODUCTION_WORLD_MAP.visualBoxes.filter(({ solid }) => solid),
    );
    expect(TREE_TRUNKS).toEqual(WORLD_SOLID_BOXES.slice(0, 3));
    expect(FIRE_BUILDING_BODY).toBe(WORLD_SOLID_BOXES[8]);
    expect(GARAGE_WALLS).toEqual(WORLD_SOLID_BOXES.slice(5, 8));
    expect(PLAYGROUND_SOLIDS).toEqual([PLAYGROUND_PLANK, PLAYGROUND_SUPPORT]);
  });

  it('車庫初期位置と3壁が重ならず、正面へ出た位置で左右壁を抜ける', () => {
    expect(VEHICLE_COLLIDER_HALF_EXTENTS).toEqual([1.45, 0.95, 1.7]);
    const initialSeparations = GARAGE_WALLS.map((wall) => (
      getAxisAlignedSeparation(wall, GARAGE_POSITION, VEHICLE_COLLIDER_HALF_EXTENTS)
    ));
    expect(initialSeparations.every(([x, , z]) => x >= 0 || z >= 0)).toBe(true);

    const exitCenter = [0, GARAGE_POSITION[1], 2.7] as const;
    for (const sideWall of GARAGE_WALLS.slice(1)) {
      const [, , z] = getAxisAlignedSeparation(
        sideWall,
        exitCenter,
        VEHICLE_COLLIDER_HALF_EXTENTS,
      );
      expect(z).toBeGreaterThan(0);
    }
  });

  it('全static定義を有限な座標・正scale・有限rotationへ制限する', () => {
    expect(WORLD_SOLID_BOXES.every(isValidBoxDefinition)).toBe(true);
    expect(isValidBoxDefinition({
      id: 'invalid-scale',
      position: [0, 0, 0],
      scale: [1, 0, 1],
    })).toBe(false);
    expect(isValidBoxDefinition({
      id: 'invalid-rotation',
      position: [0, 0, 0],
      rotation: [0, Number.NaN, 0],
      scale: [1, 1, 1],
    })).toBe(false);
  });

  it('既存visualと同じworld座標とfull scaleを維持する', () => {
    expect(TREE_TRUNKS).toEqual([
      PRODUCTION_WORLD_MAP.visualBoxes[2],
      PRODUCTION_WORLD_MAP.visualBoxes[3],
      PRODUCTION_WORLD_MAP.visualBoxes[4],
    ]);
    expect(FIRE_BUILDING_BODY).toBe(
      PRODUCTION_WORLD_MAP.visualBoxes.find(({ id }) => id === 'fire-building-body'),
    );
  });

  it('72×72 groundを±36境界と同じhalf extentsで構成する', () => {
    expect(WORLD_GROUND_BOX).toEqual({
      position: [0, -0.2, 0],
      scale: [72, 0.4, 72],
    });
    expect(scaleToHalfExtents(WORLD_GROUND_BOX.scale)).toEqual([36, 0.2, 36]);
  });

  it('full scaleをRapier CuboidColliderのhalf extentsへ変換する', () => {
    expect(scaleToHalfExtents([0.7, 2.2, 0.7])).toEqual([0.35, 1.1, 0.35]);
    expect(scaleToHalfExtents([6, 3.4, 5])).toEqual([3, 1.7, 2.5]);

    for (const box of WORLD_SOLID_BOXES) {
      expect(scaleToHalfExtents(box.scale)).toEqual(box.scale.map((axis) => axis / 2));
    }
  });

  it('VoxelWorldへ共有衝突layerを1個だけ接続する', () => {
    const world = inspectElement(VoxelWorld());
    const children = Children.toArray(world.props.children);
    const collisionLayers = children.filter(
      (child) => isValidElement(child) && child.type === WorldSolidColliders,
    );

    expect(world.type).toBe('group');
    expect(collisionLayers).toHaveLength(1);
    expect(children.some(
      (child) => isValidElement(child) && (child.type === RigidBody || child.type === CuboidCollider),
    )).toBe(false);
  });

  it('単一fixed bodyに共有定義由来の12 colliderだけを構成する', () => {
    const rigidBody = inspectElement(WorldSolidColliders());
    const colliders = Children.toArray(rigidBody.props.children).map(inspectElement);

    expect(rigidBody.type).toBe(RigidBody);
    expect(rigidBody.props).toMatchObject({ colliders: false, type: 'fixed' });
    expect(colliders).toHaveLength(12);
    expect(colliders.every((collider) => collider.type === CuboidCollider)).toBe(true);
    expect(colliders.map(({ props }) => ({
      args: props.args,
      position: props.position,
      rotation: props.rotation,
    }))).toEqual(WORLD_SOLID_BOXES.map(({ position, rotation, scale }) => ({
      args: scaleToHalfExtents(scale),
      position,
      rotation,
    })));
  });

  it('VoxelWorld全体のRapier構成に余計なbodyやcolliderを含めない', () => {
    renderVoxelWorldForPhysicsInspection();

    expect(rapierRenderRecords.rigidBodies).toHaveLength(1);
    expect(rapierRenderRecords.rigidBodies[0]).toMatchObject({ colliders: false, type: 'fixed' });
    expect(rapierRenderRecords.cuboidColliders).toHaveLength(12);
    expect(rapierRenderRecords.cuboidColliders.map(({ args, position, rotation }) => ({
      args,
      position,
      rotation,
    }))).toEqual(WORLD_SOLID_BOXES.map(({ position, rotation, scale }) => ({
      args: scaleToHalfExtents(scale),
      position,
      rotation,
    })));
  });
});

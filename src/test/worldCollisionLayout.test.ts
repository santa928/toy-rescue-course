import { Children, createElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoxelWorld, WorldSolidColliders } from '../voxel-game/scene/VoxelWorld';
import {
  FIRE_BUILDING_BODY,
  TREE_TRUNKS,
  WORLD_SOLID_BOXES,
  scaleToHalfExtents,
} from '../voxel-game/scene/worldCollisionLayout';

interface InspectedElementProps {
  readonly args?: readonly [number, number, number];
  readonly children?: ReactNode;
  readonly colliders?: boolean;
  readonly position?: readonly [number, number, number];
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

  it('木の幹3本と火災建物本体だけをsolidとして公開する', () => {
    expect(WORLD_SOLID_BOXES.map(({ id }) => id)).toEqual([
      'tree-trunk-1',
      'tree-trunk-2',
      'tree-trunk-3',
      'fire-building-body',
    ]);
    expect(WORLD_SOLID_BOXES.slice(0, 3)).toEqual(TREE_TRUNKS);
    expect(WORLD_SOLID_BOXES[3]).toBe(FIRE_BUILDING_BODY);
  });

  it('既存visualと同じworld座標とfull scaleを維持する', () => {
    expect(TREE_TRUNKS).toEqual([
      { id: 'tree-trunk-1', position: [-4, 1.25, -2], scale: [0.7, 2.2, 0.7] },
      { id: 'tree-trunk-2', position: [-4.5, 1.25, 2], scale: [0.7, 2.2, 0.7] },
      { id: 'tree-trunk-3', position: [4.4, 1.25, 2.1], scale: [0.7, 2.2, 0.7] },
    ]);
    expect(FIRE_BUILDING_BODY).toEqual({
      id: 'fire-building-body',
      position: [9.5, 1.8, -9.5],
      scale: [6, 3.4, 5],
    });
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

  it('単一fixed bodyに共有定義由来の4 colliderだけを構成する', () => {
    const rigidBody = inspectElement(WorldSolidColliders());
    const colliders = Children.toArray(rigidBody.props.children).map(inspectElement);

    expect(rigidBody.type).toBe(RigidBody);
    expect(rigidBody.props).toMatchObject({ colliders: false, type: 'fixed' });
    expect(colliders).toHaveLength(4);
    expect(colliders.every((collider) => collider.type === CuboidCollider)).toBe(true);
    expect(colliders.map(({ props }) => ({
      args: props.args,
      position: props.position,
    }))).toEqual(WORLD_SOLID_BOXES.map(({ position, scale }) => ({
      args: scaleToHalfExtents(scale),
      position,
    })));
  });

  it('VoxelWorld全体のRapier構成に余計なbodyやcolliderを含めない', () => {
    renderVoxelWorldForPhysicsInspection();

    expect(rapierRenderRecords.rigidBodies).toHaveLength(1);
    expect(rapierRenderRecords.rigidBodies[0]).toMatchObject({ colliders: false, type: 'fixed' });
    expect(rapierRenderRecords.cuboidColliders).toHaveLength(4);
    expect(rapierRenderRecords.cuboidColliders.map(({ args, position }) => ({
      args,
      position,
    }))).toEqual(WORLD_SOLID_BOXES.map(({ position, scale }) => ({
      args: scaleToHalfExtents(scale),
      position,
    })));
  });
});

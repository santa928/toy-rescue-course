import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { VoxelWorld, WorldSolidColliders } from '../voxel-game/scene/VoxelWorld';
import { PRODUCTION_WORLD_MAP } from '../voxel-game/scene/productionWorldMap';

interface InspectedElementProps {
  readonly args?: readonly [number, number, number];
  readonly boxes?: readonly unknown[];
  readonly children?: ReactNode;
  readonly color?: string;
  readonly position?: readonly [number, number, number];
}

/** React nodeが描画構成を検査できるelementであることを確認して返す。 */
function inspectElement(node: ReactNode): ReactElement<InspectedElementProps> {
  expect(isValidElement<InspectedElementProps>(node)).toBe(true);
  return node as ReactElement<InspectedElementProps>;
}

describe('production world render', () => {
  it('96×96 floor、道路、visual batch、solid layerを各1回だけ接続する', () => {
    const world = inspectElement(VoxelWorld());
    expect(world.type).toBe('group');
    const children = Children.toArray(world.props.children).map(inspectElement);

    const floor = children[0];
    const floorGeometry = Children.toArray(floor.props.children)
      .map(inspectElement)
      .find(({ type }) => type === 'boxGeometry');
    expect(floor.props.position).toEqual([0, -0.2, 0]);
    expect(floorGeometry?.props.args).toEqual([96, 0.4, 96]);

    expect(children.filter(
      ({ props }) => props.boxes === PRODUCTION_WORLD_MAP.roads,
    )).toHaveLength(1);

    const roadMarkingBatch = children.find(({ props }) => props.color === '#f0c94a');
    expect(roadMarkingBatch?.props.boxes).toHaveLength(26);
    expect(roadMarkingBatch?.props.boxes).toEqual(expect.arrayContaining([
      { position: [-17.75, 0.19, 0], scale: [32.5, 0.05, 0.22] },
      { position: [17.75, 0.19, 0], scale: [32.5, 0.05, 0.22] },
      { position: [0, 0.19, -17.75], scale: [0.22, 0.05, 32.5] },
      { position: [0, 0.19, 17.75], scale: [0.22, 0.05, 32.5] },
    ]));

    const visualBatches = children.filter(({ props }) => (
      props.boxes?.length
      && props.boxes.every((box) => (
        typeof box === 'object' && box !== null && 'solid' in box
      ))
    ));
    const renderedVisualBoxes = visualBatches.flatMap(({ props }) => props.boxes ?? []);
    expect(visualBatches).toHaveLength(new Set(
      PRODUCTION_WORLD_MAP.visualBoxes.map(({ color }) => color),
    ).size);
    expect(renderedVisualBoxes).toHaveLength(PRODUCTION_WORLD_MAP.visualBoxes.length);
    expect(new Set(renderedVisualBoxes)).toEqual(new Set(PRODUCTION_WORLD_MAP.visualBoxes));

    expect(children.filter(
      ({ type }) => type === WorldSolidColliders,
    )).toHaveLength(1);
  });
});

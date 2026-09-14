import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  InstancedSurfaceTiles,
  VoxelWorld,
  WorldSolidColliders,
  WORLD_ROAD_RENDER_BOXES,
} from '../voxel-game/scene/VoxelWorld';
import { PRODUCTION_WORLD_MAP } from '../voxel-game/scene/productionWorldMap';
import { flattenDecorationBoxes } from '../voxel-game/scene/worldStreetscape';
import { createRoadMarkings } from '../voxel-game/scene/worldRoadMarkings';

interface InspectedElementProps {
  readonly args?: readonly [number, number, number];
  readonly boxes?: readonly unknown[];
  readonly children?: ReactNode;
  readonly color?: string;
  readonly position?: readonly [number, number, number];
  readonly tiles?: readonly unknown[];
}

/** React nodeが描画構成を検査できるelementであることを確認して返す。 */
function inspectElement(node: ReactNode): ReactElement<InspectedElementProps> {
  expect(isValidElement<InspectedElementProps>(node)).toBe(true);
  return node as ReactElement<InspectedElementProps>;
}

describe('production world render', () => {
  it('96×96 floor、surface 1 batch、道路、visual batch、solid layerを接続する', () => {
    const world = inspectElement(VoxelWorld());
    expect(world.type).toBe('group');
    const children = Children.toArray(world.props.children).map(inspectElement);

    const floor = children[0];
    const floorGeometry = Children.toArray(floor.props.children)
      .map(inspectElement)
      .find(({ type }) => type === 'boxGeometry');
    expect(floor.props.position).toEqual([0, -0.2, 0]);
    expect(floorGeometry?.props.args).toEqual([96, 0.4, 96]);

    const surfaceLayers = children.filter(({ type }) => type === InstancedSurfaceTiles);
    expect(surfaceLayers).toHaveLength(1);
    expect(surfaceLayers[0].props.tiles).toBe(PRODUCTION_WORLD_MAP.surfaceTiles);

    expect(children.filter(
      ({ props }) => props.boxes === WORLD_ROAD_RENDER_BOXES,
    )).toHaveLength(1);

    const roadMarkingBatch = children.find(({ props }) => props.color === '#f0c94a');
    expect(WORLD_ROAD_RENDER_BOXES).toBe(PRODUCTION_WORLD_MAP.roads);
    expect(roadMarkingBatch?.props.boxes).toEqual(createRoadMarkings(PRODUCTION_WORLD_MAP.roads));

    const visualBatches = children.filter(({ props }) => (
      props.boxes?.length
      && props.boxes.every((box) => (
        typeof box === 'object' && box !== null && 'solid' in box
      ))
    ));
    const renderedVisualBoxes = visualBatches.flatMap(({ props }) => props.boxes ?? []);
    const decorationBoxes = flattenDecorationBoxes(PRODUCTION_WORLD_MAP.decorationClusters);
    const expectedRenderBoxes = [...PRODUCTION_WORLD_MAP.visualBoxes, ...decorationBoxes];
    expect(visualBatches).toHaveLength(1);
    expect(visualBatches[0].props.color).toBe('#ffffff');
    expect(renderedVisualBoxes).toHaveLength(expectedRenderBoxes.length);
    expect(new Set(renderedVisualBoxes)).toEqual(new Set(expectedRenderBoxes));

    expect(children.filter(
      ({ type }) => type === WorldSolidColliders,
    )).toHaveLength(1);
  });
});

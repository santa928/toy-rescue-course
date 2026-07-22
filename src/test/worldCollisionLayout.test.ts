import { describe, expect, it } from 'vitest';
import {
  FIRE_BUILDING_BODY,
  TREE_TRUNKS,
  WORLD_SOLID_BOXES,
  scaleToHalfExtents,
} from '../voxel-game/scene/worldCollisionLayout';

describe('worldCollisionLayout', () => {
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
});

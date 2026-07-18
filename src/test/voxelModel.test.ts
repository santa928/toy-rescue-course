import { describe, expect, it } from 'vitest';
import {
  assertValidVoxelModel,
  calculateModelOffset,
  calculateVoxelBounds,
  groupVoxelsByPalette,
  type VoxelCell,
} from '../vehicle-lab/model/voxelModel';

type TestPalette = 'red' | 'blue';

const validCells: readonly VoxelCell<TestPalette>[] = [
  { x: -2, y: 0, z: -1, paletteId: 'red' },
  { x: 2, y: 3, z: 4, paletteId: 'blue' },
  { x: 0, y: 1, z: 2, paletteId: 'red' },
];

describe('voxelModel', () => {
  it('整数座標、既知パレット、重複なしのモデルを受理する', () => {
    expect(() => assertValidVoxelModel(validCells, ['red', 'blue'])).not.toThrow();
  });

  it('重複座標を拒否する', () => {
    const duplicated: readonly VoxelCell<TestPalette>[] = [
      { x: 0, y: 0, z: 0, paletteId: 'red' },
      { x: 0, y: 0, z: 0, paletteId: 'blue' },
    ];

    expect(() => assertValidVoxelModel(duplicated, ['red', 'blue'])).toThrow(
      'Duplicate voxel coordinate: 0,0,0',
    );
  });

  it('非整数座標と未知パレットを拒否する', () => {
    expect(() =>
      assertValidVoxelModel([{ x: 0.5, y: 0, z: 0, paletteId: 'red' }], ['red', 'blue']),
    ).toThrow('Voxel coordinates must be finite integers');

    expect(() =>
      assertValidVoxelModel(
        [{ x: 0, y: 0, z: 0, paletteId: 'green' as TestPalette }],
        ['red', 'blue'],
      ),
    ).toThrow('Unknown voxel palette id: green');
  });

  it('境界、サイズ、中心を計算する', () => {
    expect(calculateVoxelBounds(validCells)).toEqual({
      min: { x: -2, y: 0, z: -1 },
      max: { x: 2, y: 3, z: 4 },
      size: { x: 5, y: 4, z: 6 },
      center: { x: 0, y: 1.5, z: 1.5 },
    });
  });

  it('色別グループと地面基準の中央オフセットを返す', () => {
    const groups = groupVoxelsByPalette(validCells, ['red', 'blue']);
    const bounds = calculateVoxelBounds(validCells);

    expect(groups.get('red')).toHaveLength(2);
    expect(groups.get('blue')).toHaveLength(1);
    expect(calculateModelOffset(bounds, 0.25)).toEqual([-0, -0, -0.375]);
  });
});

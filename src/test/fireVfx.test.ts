import { describe, expect, it } from 'vitest';
import {
  FIRE_ROLE_CAPACITY,
  FIRE_VOXEL_POOL_SIZE,
  FIRE_VOXEL_SLOTS,
  createFireVoxelFrame,
  getActiveFireVoxelCount,
} from '../voxel-game/scene/fireVfx';

const activeFlames = (layerCount: number, elapsedSeconds = 0.25) => (
  createFireVoxelFrame({ elapsedSeconds, layerCount }).instances
    .filter(({ active, kind }) => active && kind === 'flame')
);

const maximumTop = (layerCount: number): number => Math.max(
  ...activeFlames(layerCount).map(({ position, scale }) => position[1] + scale[1] / 2),
);

/** 指定axisでactive flame cube群が画面上に占める可視幅を返す。 */
const visibleFootprint = (
  flames: ReturnType<typeof activeFlames>,
  axis: 0 | 1 | 2,
): number => {
  const minimum = Math.min(...flames.map(({ position, scale }) => position[axis] - scale[axis] / 2));
  const maximum = Math.max(...flames.map(({ position, scale }) => position[axis] + scale[axis] / 2));
  return maximum - minimum;
};

describe('fireVfx', () => {
  it('0〜17の一意な固定slotを3色batchへ配る', () => {
    expect(FIRE_VOXEL_POOL_SIZE).toBe(18);
    expect(FIRE_VOXEL_SLOTS.map(({ slot }) => slot)).toEqual(
      Array.from({ length: 18 }, (_, slot) => slot),
    );
    expect(FIRE_ROLE_CAPACITY).toEqual({ core: 4, middle: 8, outer: 6 });
  });

  it.each([
    [0, 0], [1, 6], [2, 12], [3, 18],
  ])('火勢%sではactive slotが%s個になる', (layerCount, expected) => {
    expect(getActiveFireVoxelCount(layerCount)).toBe(expected);
  });

  it('最大火勢は幅広い根元と高さの違う2本以上の炎の舌を持つ', () => {
    const flames = activeFlames(3, 0);
    const base = flames.filter(({ position }) => position[1] < 1);
    const highTops = flames
      .map(({ position, scale }) => position[1] + scale[1] / 2)
      .filter((top) => top > 1.8);

    expect(visibleFootprint(base, 0)).toBeGreaterThanOrEqual(0.5);
    expect(visibleFootprint(base, 2)).toBeGreaterThanOrEqual(0.15);
    expect(highTops.length).toBeGreaterThanOrEqual(3);
  });

  it('火勢低下でactive数と最大高さが単調に減る', () => {
    expect(maximumTop(3)).toBeGreaterThan(maximumTop(2));
    expect(maximumTop(2)).toBeGreaterThan(maximumTop(1));
    expect(getActiveFireVoxelCount(3)).toBeGreaterThan(getActiveFireVoxelCount(2));
    expect(getActiveFireVoxelCount(2)).toBeGreaterThan(getActiveFireVoxelCount(1));
  });

  it('複数の炎が非同期に動き、基準位置0.18・基準scale18%以内に収まる', () => {
    const start = createFireVoxelFrame({ elapsedSeconds: 0, layerCount: 3 });
    const later = createFireVoxelFrame({ elapsedSeconds: 0.37, layerCount: 3 });
    const moved = later.instances.filter((current, index) => {
      const previous = start.instances[index];
      return current.kind === 'flame'
        && Math.hypot(...current.position.map((value, axis) => value - previous.position[axis])) > 0.005;
    });

    expect(moved.length).toBeGreaterThanOrEqual(8);
    for (const transform of later.instances.filter(({ kind }) => kind === 'flame')) {
      const slot = FIRE_VOXEL_SLOTS[transform.slot];
      expect(Math.hypot(...transform.position.map(
        (value, axis) => value - slot.basePosition[axis],
      ))).toBeLessThanOrEqual(0.18);
      transform.scale.forEach((value, axis) => {
        expect(Math.abs(value / slot.baseScale[axis] - 1)).toBeLessThanOrEqual(0.18);
      });
    }
  });

  it('火の粉はcycle内で上昇しながら縮み、寿命後に根元へ戻る', () => {
    const early = createFireVoxelFrame({ elapsedSeconds: 0.1, layerCount: 3 }).instances[15];
    const late = createFireVoxelFrame({ elapsedSeconds: 0.3, layerCount: 3 }).instances[15];
    const recycled = createFireVoxelFrame({ elapsedSeconds: 0.95, layerCount: 3 }).instances[15];

    expect(late.position[1]).toBeGreaterThan(early.position[1]);
    expect(late.scale[0]).toBeLessThan(early.scale[0]);
    expect(recycled.position[1]).toBeLessThan(late.position[1]);
  });

  it.each([
    { elapsedSeconds: Number.NaN, layerCount: Number.NaN },
    { elapsedSeconds: Number.POSITIVE_INFINITY, layerCount: 99 },
    { elapsedSeconds: -10, layerCount: -4 },
  ])('不正入力でも有限なtransformだけを返す', (input) => {
    const frame = createFireVoxelFrame(input);
    expect(frame.instances).toHaveLength(18);
    expect(frame.instances.flatMap(({ position, scale }) => [...position, ...scale])
      .every(Number.isFinite)).toBe(true);
  });
});

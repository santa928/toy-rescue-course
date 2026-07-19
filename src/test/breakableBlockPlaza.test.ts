import { describe, expect, it } from 'vitest';
import {
  BREAKABLE_FRAGMENT_LIFETIME_MS,
  BREAKABLE_FRAGMENT_SLOTS_PER_BLOCK,
  calculateRelativeLinearSpeed,
  createBreakableFragmentPool,
  isBlockRespawnAreaClear,
  isFragmentWindowActive,
  resolveBlockImpactSpeed,
} from '../voxel-game/scene/BreakableBlockPlaza';
import { BREAKABLE_BLOCKS } from '../voxel-game/scene/worldLayout';

describe('BreakableBlockPlaza', () => {
  it('4 blockそれぞれへ再利用可能な6 slotを固定し、identityを重複させない', () => {
    const slots = createBreakableFragmentPool(BREAKABLE_BLOCKS);

    expect(slots).toHaveLength(24);
    expect(new Set(slots.map(({ id }) => id)).size).toBe(24);
    for (const block of BREAKABLE_BLOCKS) {
      const blockSlots = slots.filter(({ blockId }) => blockId === block.id);
      expect(blockSlots).toHaveLength(BREAKABLE_FRAGMENT_SLOTS_PER_BLOCK);
      expect(blockSlots.map(({ index }) => index)).toEqual([0, 1, 2, 3, 4, 5]);
    }
  });

  it('6片を積み木広場内側の異なる方向へ飛ばし、別blockを連鎖破壊しない速度に保つ', () => {
    const slots = createBreakableFragmentPool(BREAKABLE_BLOCKS)
      .filter(({ blockId }) => blockId === BREAKABLE_BLOCKS[0].id);

    expect(new Set(slots.map(({ velocity }) => velocity.join(','))).size).toBe(6);
    expect(slots.every(({ velocity }) => velocity[0] > 0)).toBe(true);
    expect(slots.some(({ velocity }) => velocity[1] > 0)).toBe(true);
    expect(slots.some(({ velocity }) => velocity[2] > 0)).toBe(true);
    expect(slots.some(({ velocity }) => velocity[2] < 0)).toBe(true);
    expect(slots.every(({ velocity }) => Math.hypot(...velocity) < 4)).toBe(true);
  });

  it('Rapier bodyの線速度差から符号に依存しない実相対速度を返す', () => {
    expect(calculateRelativeLinearSpeed(
      { x: 1, y: -2, z: 3 },
      { x: -2, y: 2, z: 3 },
    )).toBe(5);
    expect(calculateRelativeLinearSpeed(
      { x: -2, y: 2, z: 3 },
      { x: 1, y: -2, z: 3 },
    )).toBe(5);
  });

  it('after-step collisionでは車両の前step速度を採用し、別bodyはevent時速度を使う', () => {
    expect(resolveBlockImpactSpeed({
      collisionBodyIsVehicle: true,
      eventRelativeSpeed: 0.439,
      vehiclePreviousStepSpeed: 6.2,
    })).toBe(6.2);
    expect(resolveBlockImpactSpeed({
      collisionBodyIsVehicle: false,
      eventRelativeSpeed: 3.1,
      vehiclePreviousStepSpeed: 6.2,
    })).toBe(3.1);
  });

  it('車両とのXZ距離が3を超える場合だけ復元領域をclearにする', () => {
    expect(isBlockRespawnAreaClear([0, 0, 0], [3, 99, 0])).toBe(false);
    expect(isBlockRespawnAreaClear([0, 0, 0], [3.001, -99, 0])).toBe(true);
    expect(isBlockRespawnAreaClear([1, 0, 1], [1, 0, -2])).toBe(false);
  });

  it('runtimeの5秒timerから破壊後1.2秒未満だけfragment windowを有効にする', () => {
    expect(BREAKABLE_FRAGMENT_LIFETIME_MS).toBe(1_200);
    expect(isFragmentWindowActive('broken', 5_000)).toBe(true);
    expect(isFragmentWindowActive('broken', 3_800.001)).toBe(true);
    expect(isFragmentWindowActive('broken', 3_800)).toBe(false);
    expect(isFragmentWindowActive('intact', 5_000)).toBe(false);
  });
});

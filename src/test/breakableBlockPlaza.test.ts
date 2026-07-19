import { describe, expect, it } from 'vitest';
import {
  BREAKABLE_FRAGMENT_LIFETIME_MS,
  BREAKABLE_FRAGMENT_SLOTS_PER_BLOCK,
  calculateRelativeLinearSpeed,
  createActualFragmentPoolSnapshot,
  createBreakableFragmentPool,
  deactivateFragmentBody,
  isBlockRespawnAreaClear,
  isFragmentWindowActive,
  resolveBlockImpactSpeed,
} from '../voxel-game/scene/BreakableBlockPlaza';
import { BREAKABLE_BLOCKS } from '../voxel-game/scene/worldLayout';

describe('BreakableBlockPlaza', () => {
  it('設定値でなく実body・collider・mesh参照からpool状態とidentityを数える', () => {
    const slots = [
      {
        active: true,
        body: { handle: 11, isEnabled: () => true, isSleeping: () => false },
        collider: { handle: 21, isEnabled: () => true },
        mesh: { uuid: 'mesh-a', visible: true },
      },
      {
        active: false,
        body: { handle: 12, isEnabled: () => false, isSleeping: () => false },
        collider: { handle: 22, isEnabled: () => false },
        mesh: { uuid: 'mesh-b', visible: false },
      },
      { active: false, body: null, collider: null, mesh: null },
    ];

    expect(createActualFragmentPoolSnapshot(slots)).toEqual({
      activeFragmentCount: 1,
      bodyHandles: [11, 12],
      colliderHandles: [21, 22],
      collisionEnabledFragmentCount: 1,
      enabledBodyCount: 1,
      meshUuids: ['mesh-a', 'mesh-b'],
      mountedBodyCount: 2,
      mountedColliderCount: 2,
      mountedMeshCount: 2,
      rapierSleepingFragmentCount: 0,
      sleepingFragmentCount: 1,
      uniqueBodyHandleCount: 2,
      uniqueColliderHandleCount: 2,
      uniqueMeshUuidCount: 2,
      visibleFragmentCount: 1,
    });
  });

  it('破片body停止時に速度零・disable・sleepをすべて明示呼出しする', () => {
    const events: string[] = [];
    deactivateFragmentBody({
      setAngvel: (_velocity, wakeUp) => events.push(`angvel:${wakeUp}`),
      setEnabled: (enabled) => events.push(`enabled:${enabled}`),
      setLinvel: (_velocity, wakeUp) => events.push(`linvel:${wakeUp}`),
      sleep: () => events.push('sleep'),
    });

    expect(events).toEqual(['linvel:false', 'angvel:false', 'enabled:false', 'sleep']);
  });

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
    expect(isFragmentWindowActive('broken', 3_800.0000001)).toBe(false);
    expect(isFragmentWindowActive('broken', 3_800)).toBe(false);
    expect(isFragmentWindowActive('intact', 5_000)).toBe(false);
  });
});

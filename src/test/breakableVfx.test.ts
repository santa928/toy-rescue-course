import { describe, expect, it } from 'vitest';
import {
  CHIP_BURST_SIZE,
  CHIP_POOL_SIZE,
  createChipBurstFrame,
  createMainFragmentDefinitions,
  resolveMainFragmentVelocity,
} from '../voxel-game/scene/breakableVfx';

describe('breakableVfx', () => {
  it('6主破片の初期AABBを元1.5 block内へ収める', () => {
    const fragments = createMainFragmentDefinitions();

    expect(fragments).toHaveLength(6);
    for (const fragment of fragments) {
      for (let axis = 0; axis < 3; axis += 1) {
        expect(Math.abs(fragment.localPosition[axis]) + fragment.scale[axis] / 2)
          .toBeLessThanOrEqual(0.75);
      }
    }
  });

  it('6slotを衝突forward側かつ上へ異なる速度で飛ばす', () => {
    const velocities = createMainFragmentDefinitions()
      .map((definition) => resolveMainFragmentVelocity(definition, [1, 0, 0]));

    expect(new Set(velocities.map((velocity) => velocity.join(','))).size).toBe(6);
    expect(velocities.every(([x, y]) => x > 0 && y > 0)).toBe(true);
    expect(velocities.every(([x, y, z]) => Math.hypot(x, y, z) < 5.5)).toBe(true);
  });

  it('補助片を固定32slotに保ち、1burstだけ8slotを350ms未満表示する', () => {
    const active = createChipBurstFrame({
      ageSeconds: 0.18,
      blockColor: '#ef4c23',
      origin: [1, 2, 3],
      startSlot: 24,
    });
    const expired = createChipBurstFrame({
      ageSeconds: 0.35,
      blockColor: '#ef4c23',
      origin: [1, 2, 3],
      startSlot: 24,
    });

    expect(active.instances).toHaveLength(CHIP_POOL_SIZE);
    expect(active.instances.filter(({ active: visible }) => visible)).toHaveLength(CHIP_BURST_SIZE);
    expect(expired.instances.every(({ active: visible, scale }) => !visible && scale === 0)).toBe(true);
  });

  it('block indexごとに補助片slot範囲を8slotずつ分ける', () => {
    for (let blockIndex = 0; blockIndex < 4; blockIndex += 1) {
      const frame = createChipBurstFrame({
        ageSeconds: 0,
        blockColor: '#ef4c23',
        origin: [0, 0, 0],
        startSlot: blockIndex * CHIP_BURST_SIZE,
      });
      const activeSlots = frame.instances
        .flatMap((instance, index) => instance.active ? [index] : []);

      expect(activeSlots).toEqual(
        Array.from({ length: CHIP_BURST_SIZE }, (_, offset) => blockIndex * CHIP_BURST_SIZE + offset),
      );
    }
  });
});

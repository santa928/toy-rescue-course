import { describe, expect, it } from 'vitest';
import {
  createWaterFlowFrame,
  WATER_INSTANCE_COUNT,
  WATER_SPLASH_COUNT,
  WATER_STREAM_COUNT,
} from '../voxel-game/scene/waterFlow';

const baseInput = {
  direction: [0, 0, -1] as const,
  nozzleOrigin: [3, 2, 4] as const,
  splashElapsedSeconds: 0,
  sprayActive: true,
  sprayElapsedSeconds: 0.7,
  targeted: false,
  visibleDistance: 6,
};

describe('waterFlow', () => {
  it('固定32slotをstream 24とsplash 8へ分ける', () => {
    const frame = createWaterFlowFrame(baseInput);
    expect(frame.instances).toHaveLength(WATER_INSTANCE_COUNT);
    expect(frame.instances.filter(({ kind }) => kind === 'stream')).toHaveLength(WATER_STREAM_COUNT);
    expect(frame.instances.filter(({ kind }) => kind === 'splash')).toHaveLength(WATER_SPLASH_COUNT);
  });

  it('異なる時刻で複数stream粒が先端方向へ前進する', () => {
    const first = createWaterFlowFrame({ ...baseInput, sprayElapsedSeconds: 0.7 });
    const second = createWaterFlowFrame({ ...baseInput, sprayElapsedSeconds: 0.76 });
    const moved = first.instances.filter(({ active, kind }) => active && kind === 'stream')
      .filter((instance) => {
        const next = second.instances[instance.slot];
        return next?.active && next.position[2] < instance.position[2] - 0.01;
      });
    expect(moved.length).toBeGreaterThanOrEqual(4);
  });

  it('全stream粒をnozzleからvisible endの間へ収める', () => {
    const frame = createWaterFlowFrame(baseInput);
    for (const instance of frame.instances.filter(({ active, kind }) => active && kind === 'stream')) {
      const distance = 4 - instance.position[2];
      expect(distance).toBeGreaterThanOrEqual(0);
      expect(distance).toBeLessThanOrEqual(6);
    }
  });

  it('targeted中だけ飛沫を出し、220ms終端でscaleを0へ戻す', () => {
    const untargeted = createWaterFlowFrame(baseInput);
    const targeted = createWaterFlowFrame({ ...baseInput, splashElapsedSeconds: 0.1, targeted: true });
    const expired = createWaterFlowFrame({ ...baseInput, splashElapsedSeconds: 0.22, targeted: true });
    expect(untargeted.instances.some(({ active, kind }) => active && kind === 'splash')).toBe(false);
    expect(targeted.instances.some(({ active, kind }) => active && kind === 'splash')).toBe(true);
    expect(expired.instances.filter(({ kind }) => kind === 'splash').every(({ scale }) => scale === 0)).toBe(true);
  });
});

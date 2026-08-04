import { describe, expect, it } from 'vitest';
import {
  COLOR_PLAY_POOL_SLOT_COUNT,
  COLOR_PLAY_SHOWER_SLOT_COUNT,
  COLOR_PLAY_STATION_DRAW_CALLS,
  COLOR_PLAY_TOTAL_CUBE_COUNT,
  createColorPlayStationBoxes,
  createColorPlayVfxFrame,
  updateColorPlayVfxFrame,
} from '../voxel-game/scene/colorPlayVfx';
import { COLOR_PLAY_SOURCES } from '../voxel-game/scene/worldLayout';

/** frame全transformの数値が有限か検証する。 */
function expectFiniteFrame(frame: ReturnType<typeof createColorPlayVfxFrame>): void {
  for (const instance of frame.instances) {
    expect(instance.position.every(Number.isFinite)).toBe(true);
    expect(instance.scale.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
  }
}

describe('color play VFX', () => {
  it('3色それぞれpool 8・shower 18の固定slotを持ち、全78 cube・1 draw callに収める', () => {
    const frame = createColorPlayVfxFrame();

    expect(COLOR_PLAY_POOL_SLOT_COUNT).toBe(8);
    expect(COLOR_PLAY_SHOWER_SLOT_COUNT).toBe(18);
    expect(COLOR_PLAY_TOTAL_CUBE_COUNT).toBe(78);
    expect(COLOR_PLAY_STATION_DRAW_CALLS).toBe(1);
    expect(frame.instances).toHaveLength(78);

    for (const colorId of ['red', 'blue', 'yellow'] as const) {
      const colorInstances = frame.instances.filter((instance) => instance.colorId === colorId);
      expect(colorInstances).toHaveLength(26);
      expect(colorInstances.filter(({ kind }) => kind === 'pool')).toHaveLength(8);
      expect(colorInstances.filter(({ kind }) => kind === 'shower')).toHaveLength(18);
    }
  });

  it('同じframeとtransform identityを維持して時刻だけin-place更新する', () => {
    const frame = createColorPlayVfxFrame();
    const firstInstance = frame.instances[0];
    const initialPosition = [...firstInstance.position];

    expect(updateColorPlayVfxFrame(frame, 0.5)).toBe(frame);
    expect(frame.instances[0]).toBe(firstInstance);
    expect(firstInstance.position).not.toEqual(initialPosition);
    expectFiniteFrame(frame);
  });

  it('pool cubeはtrigger内で浅く波打ち、shower cubeはアーチ内を循環する', () => {
    const frame = createColorPlayVfxFrame();
    updateColorPlayVfxFrame(frame, 1.25);

    for (const source of COLOR_PLAY_SOURCES) {
      const instances = frame.instances.filter(({ sourceId }) => sourceId === source.id);
      expect(instances).toHaveLength(
        source.kind === 'pool' ? COLOR_PLAY_POOL_SLOT_COUNT : COLOR_PLAY_SHOWER_SLOT_COUNT,
      );
      for (const instance of instances) {
        expect(instance.position[0]).toBeGreaterThanOrEqual(source.triggerBounds.minX);
        expect(instance.position[0]).toBeLessThanOrEqual(source.triggerBounds.maxX);
        expect(instance.position[2]).toBeGreaterThanOrEqual(source.triggerBounds.minZ);
        expect(instance.position[2]).toBeLessThanOrEqual(source.triggerBounds.maxZ);
        if (source.kind === 'pool') {
          expect(instance.position[1]).toBeGreaterThanOrEqual(source.position[1] - 0.01);
          expect(instance.position[1]).toBeLessThanOrEqual(source.position[1] + 0.16);
        } else {
          expect(instance.position[1]).toBeGreaterThanOrEqual(0.3);
          expect(instance.position[1]).toBeLessThanOrEqual(3.25);
        }
      }
    }
  });

  it('静的stationを白frame 21 box・濃灰base 6 boxへまとめる', () => {
    const boxes = createColorPlayStationBoxes();

    expect(boxes.frameBoxes).toHaveLength(21);
    expect(boxes.baseBoxes).toHaveLength(6);
    expect(boxes.frameBoxes.every(({ scale }) => scale.every((value) => value > 0))).toBe(true);
    expect(boxes.baseBoxes.every(({ scale }) => scale.every((value) => value > 0))).toBe(true);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -10])(
    'elapsedSeconds=%sを0秒の有限frameへ正規化する',
    (elapsedSeconds) => {
      const zeroFrame = updateColorPlayVfxFrame(createColorPlayVfxFrame(), 0);
      const invalidFrame = updateColorPlayVfxFrame(createColorPlayVfxFrame(), elapsedSeconds);

      expect(invalidFrame).toEqual(zeroFrame);
      expectFiniteFrame(invalidFrame);
    },
  );
});

import { describe, expect, it } from 'vitest';
import { VoxelGameRuntime } from '../voxel-game/domain/VoxelGameRuntime';
import {
  CELEBRATION_STAR_CENTERS,
  FIRE_LAYER_POSITIONS,
  getFireLayerCount,
  resolveWaterAndFireFrame,
} from '../voxel-game/scene/WaterAndFire';

describe('WaterAndFire', () => {
  it('火cubeを建物のcamera側外壁面へ置き、3層すべてを遮蔽させない', () => {
    expect(FIRE_LAYER_POSITIONS).toHaveLength(3);
    expect(FIRE_LAYER_POSITIONS.every(([x]) => x >= 12.75)).toBe(true);
    expect(Math.max(...FIRE_LAYER_POSITIONS.map(([, y]) => y))).toBeGreaterThan(3.4);
    expect(Math.max(...FIRE_LAYER_POSITIONS.map(([, y]) => y))).toBeLessThanOrEqual(3.6);
  });

  it('6組の成功星を火災現場上空かつcamera安全矩形へ置く', () => {
    expect(CELEBRATION_STAR_CENTERS).toHaveLength(6);
    expect(CELEBRATION_STAR_CENTERS.every(([, y, z]) => y >= 3.2 && y <= 4.1 && z >= -6)).toBe(true);
  });

  it.each([
    [1, 3],
    [0.67, 3],
    [0.66, 2],
    [0.34, 2],
    [0.33, 1],
    [0.01, 1],
    [0, 0],
  ])('火の強さ%fを純ボクセル%f層へ変換する', (intensity, expectedLayers) => {
    expect(getFireLayerCount(intensity)).toBe(expectedLayers);
  });

  it('前方6unit内へ放水したときだけtargetedな消火signalを作る', () => {
    const targeted = resolveWaterAndFireFrame(
      {
        forward: [0, 0, -1],
        mass: 1.4,
        position: [12, 0.8, -5],
        resetCount: 0,
        speed: 0,
      },
      { spray: true, steer: 0, throttle: 0 },
    );
    const behind = resolveWaterAndFireFrame(
      {
        forward: [0, 0, -1],
        mass: 1.4,
        position: [12, 0.8, -12],
        resetCount: 0,
        speed: 0,
      },
      { spray: true, steer: 0, throttle: 0 },
    );

    expect(targeted).toMatchObject({ sprayActive: true, sprayOnFire: true, targeted: true });
    expect(behind).toMatchObject({ sprayActive: true, sprayOnFire: false, targeted: false });
  });

  it('targeted放水signalだけが2500msの消火chainを完了する', () => {
    const runtime = new VoxelGameRuntime([]);
    const frame = resolveWaterAndFireFrame(
      {
        forward: [0, 0, -1],
        mass: 1.4,
        position: [12, 0.8, -5],
        resetCount: 0,
        speed: 0,
      },
      { spray: true, steer: 0, throttle: 0 },
    );

    runtime.setSignals({ sprayActive: frame.sprayActive, sprayOnFire: frame.sprayOnFire });
    runtime.advance(2_500);

    expect(runtime.getSnapshot()).toMatchObject({ fireIntensity: 0, missionPhase: 'celebrating' });
  });
});

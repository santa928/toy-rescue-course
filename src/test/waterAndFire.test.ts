import { describe, expect, it, vi } from 'vitest';
import { VoxelGameRuntime } from '../voxel-game/domain/VoxelGameRuntime';
import {
  CELEBRATION_STAR_CENTERS,
  FIRE_HAZARD_BOX,
  FIRE_LAYER_POSITIONS,
  ROUTE_BOXES,
  advanceWaterVfxClock,
  getFireLayerCount,
  getWaterVisibleDistance,
  isFireHazardEnabled,
  isWaterVfxResetEvent,
  resolveWaterAndFireFrame,
  syncColliderEnabled,
} from '../voxel-game/scene/WaterAndFire';

describe('WaterAndFire', () => {
  it('12個の道しるべを高さ0.14以下の非障害タイルとして定義する', () => {
    expect(ROUTE_BOXES).toHaveLength(12);
    expect(ROUTE_BOXES.every(({ position, scale }) => (
      position[1] <= 0.28
      && scale[0] === 0.62
      && scale[1] >= 0.1
      && scale[1] <= 0.14
      && scale[2] === 0.62
    ))).toBe(true);
  });

  it.each([
    [1, true],
    [0.01, true],
    [0, false],
    [Number.NaN, false],
  ])('fireIntensity %sからhazard enabled=%sを決める', (intensity, expected) => {
    expect(isFireHazardEnabled(intensity)).toBe(expected);
  });

  it('Rapier colliderのenabled差分だけを同期する', () => {
    const setEnabled = vi.fn();
    const collider = { isEnabled: () => false, setEnabled };

    syncColliderEnabled(collider, true);
    expect(setEnabled).toHaveBeenCalledOnce();
    expect(setEnabled).toHaveBeenCalledWith(true);

    setEnabled.mockClear();
    syncColliderEnabled({ isEnabled: () => true, setEnabled }, true);
    expect(setEnabled).not.toHaveBeenCalled();
  });

  it('炎hazardを表示下2層より大きくしない', () => {
    expect(FIRE_HAZARD_BOX).toEqual({
      position: [12.9, 0.9, -9.1],
      scale: [1.2, 1.8, 1.2],
    });
  });

  it('火cubeを建物のcamera側外壁面へ置き、3層すべてを遮蔽させない', () => {
    expect(FIRE_LAYER_POSITIONS).toHaveLength(3);
    expect(FIRE_LAYER_POSITIONS.every(([x]) => x >= 12.75)).toBe(true);
    expect(FIRE_LAYER_POSITIONS.map(([, y]) => y)).toEqual([0.75, 1.5, 2.15]);
    expect(FIRE_LAYER_POSITIONS.map(([, , z]) => z)).toEqual([-9.1, -9.02, -9.1]);
  });

  it('6組の成功星を火災現場上空かつcamera安全矩形へ置く', () => {
    expect(CELEBRATION_STAR_CENTERS).toHaveLength(6);
    expect(CELEBRATION_STAR_CENTERS.every(([, y, z]) => y >= 1 && y <= 3 && z >= -8)).toBe(true);
    expect(CELEBRATION_STAR_CENTERS[1]?.[0]).toBeLessThanOrEqual(8.5);
    expect(CELEBRATION_STAR_CENTERS[2]?.[0]).toBeGreaterThanOrEqual(17);
    expect(CELEBRATION_STAR_CENTERS[3]?.[0]).toBeLessThanOrEqual(10);
    expect(CELEBRATION_STAR_CENTERS[4]).toEqual([17.25, 3, -8]);
  });

  it('targetedな水はvisible fireで止め、非targeted時だけ最大6unit描く', () => {
    expect(getWaterVisibleDistance(5.5, true)).toBeCloseTo(3.6, 9);
    expect(getWaterVisibleDistance(2, false)).toBe(6);
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
    const command = { moveX: 0, moveY: 0, spray: true } as const;
    const targeted = resolveWaterAndFireFrame(
      {
        forward: [0, 0, -1],
        mass: 1.4,
        position: [12, 0.8, -5],
        resetCount: 0,
        speed: 0,
      },
      command,
      0.4,
      0.1,
    );
    const behind = resolveWaterAndFireFrame(
      {
        forward: [0, 0, -1],
        mass: 1.4,
        position: [12, 0.8, -12],
        resetCount: 0,
        speed: 0,
      },
      command,
      0.4,
      0,
    );

    expect(targeted).toMatchObject({
      sprayActive: true,
      sprayElapsedSeconds: 0.4,
      sprayOnFire: true,
      splashElapsedSeconds: 0.1,
      targeted: true,
    });
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
      { moveX: 0, moveY: 0, spray: true },
    );

    runtime.setSignals({ sprayActive: frame.sprayActive, sprayOnFire: frame.sprayOnFire });
    runtime.advance(2_500);

    expect(runtime.getSnapshot()).toMatchObject({ fireIntensity: 0, missionPhase: 'celebrating' });
  });

  it('放水を押し続けたvehicle resetCount変化では時計をdeltaから再開する', () => {
    const resetEvent = isWaterVfxResetEvent(0, 1, 'assigned', 'assigned');

    expect(resetEvent).toBe(true);
    expect(advanceWaterVfxClock({
      deltaSeconds: 0.016,
      resetEvent,
      sprayActive: true,
      sprayElapsedSeconds: 0.8,
      sprayOnFire: true,
      splashElapsedSeconds: 0.18,
    })).toEqual({ sprayElapsedSeconds: 0.016, splashElapsedSeconds: 0.016 });
  });

  it('放水を押し続けたfreeRoamからassignedへの遷移では時計をdeltaから再開する', () => {
    const resetEvent = isWaterVfxResetEvent(4, 4, 'freeRoam', 'assigned');

    expect(resetEvent).toBe(true);
    expect(advanceWaterVfxClock({
      deltaSeconds: 0.016,
      resetEvent,
      sprayActive: true,
      sprayElapsedSeconds: 0.8,
      sprayOnFire: true,
      splashElapsedSeconds: 0.18,
    })).toEqual({ sprayElapsedSeconds: 0.016, splashElapsedSeconds: 0.016 });
  });

  it('通常の放水は時計を累積し、飛沫は0.22秒で循環する', () => {
    expect(advanceWaterVfxClock({
      deltaSeconds: 0.05,
      resetEvent: false,
      sprayActive: true,
      sprayElapsedSeconds: 0.4,
      sprayOnFire: true,
      splashElapsedSeconds: 0.2,
    })).toEqual({ sprayElapsedSeconds: 0.45, splashElapsedSeconds: 0.03 });
  });

  it('放水停止時は両方の時計を0へ戻す', () => {
    expect(advanceWaterVfxClock({
      deltaSeconds: 0.016,
      resetEvent: false,
      sprayActive: false,
      sprayElapsedSeconds: 0.8,
      sprayOnFire: false,
      splashElapsedSeconds: 0.18,
    })).toEqual({ sprayElapsedSeconds: 0, splashElapsedSeconds: 0 });
  });
});

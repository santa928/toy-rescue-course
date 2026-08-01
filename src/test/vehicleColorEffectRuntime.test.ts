import { describe, expect, it, vi } from 'vitest';
import {
  COLOR_EFFECT_DURATION_MILLISECONDS,
  VehicleColorEffectRuntime,
  findColorPlaySource,
} from '../voxel-game/domain/VehicleColorEffectRuntime';
import { COLOR_PLAY_SOURCES } from '../voxel-game/scene/worldLayout';

const RED_POOL_POSITION = COLOR_PLAY_SOURCES.find(({ id }) => id === 'pool-red')?.position;
const BLUE_POOL_POSITION = COLOR_PLAY_SOURCES.find(({ id }) => id === 'pool-blue')?.position;
const YELLOW_SHOWER_POSITION = COLOR_PLAY_SOURCES.find(({ id }) => id === 'shower-yellow')?.position;

/** source fixtureがcanonical mapに存在することをassertしてworld座標として返す。 */
function requirePosition(
  position: readonly [number, number, number] | undefined,
): readonly [number, number, number] {
  expect(position).toBeDefined();
  return position ?? [0, 0, 0];
}

/** canonical 6 sourceを使うfresh runtimeを返す。 */
function createRuntime(): VehicleColorEffectRuntime {
  return new VehicleColorEffectRuntime(COLOR_PLAY_SOURCES);
}

describe('findColorPlaySource', () => {
  it('trigger内と0.6unitの寛容marginをsourceへ解決し、非有限座標を拒否する', () => {
    const redPool = COLOR_PLAY_SOURCES.find(({ id }) => id === 'pool-red');
    expect(redPool).toBeDefined();
    expect(findColorPlaySource(COLOR_PLAY_SOURCES, requirePosition(RED_POOL_POSITION))?.id)
      .toBe('pool-red');
    expect(findColorPlaySource(COLOR_PLAY_SOURCES, [
      (redPool?.triggerBounds.maxX ?? 0) + 0.55,
      0.8,
      redPool?.position[2] ?? 0,
    ])?.id).toBe('pool-red');
    expect(findColorPlaySource(COLOR_PLAY_SOURCES, [
      (redPool?.triggerBounds.maxX ?? 0) + 0.65,
      0.8,
      redPool?.position[2] ?? 0,
    ])).toBeNull();
    expect(findColorPlaySource(COLOR_PLAY_SOURCES, [Number.NaN, 0, 0])).toBeNull();
  });
});

describe('VehicleColorEffectRuntime', () => {
  it('inactiveから赤poolへ入ると消防車へ12秒の赤色を適用する', () => {
    const runtime = createRuntime();

    expect(runtime.getSnapshot()).toMatchObject({
      active: false,
      activationCount: 0,
      colorId: null,
      remainingMilliseconds: 0,
      remainingSeconds: 0,
      vehicleId: null,
    });

    runtime.syncVehiclePosition('fire-truck', requirePosition(RED_POOL_POSITION));

    expect(runtime.getSnapshot()).toEqual({
      active: true,
      activationCount: 1,
      colorHex: '#ef4444',
      colorId: 'red',
      contactSourceId: 'pool-red',
      remainingMilliseconds: COLOR_EFFECT_DURATION_MILLISECONDS,
      remainingSeconds: 12,
      sourceId: 'pool-red',
      sourceKind: 'pool',
      vehicleId: 'fire-truck',
    });
  });

  it('source接触中は時間を減らさず、離脱後だけ減算する', () => {
    const runtime = createRuntime();
    runtime.syncVehiclePosition('fire-truck', requirePosition(RED_POOL_POSITION));

    runtime.advance(5_000);
    expect(runtime.getSnapshot().remainingMilliseconds).toBe(12_000);

    runtime.syncVehiclePosition('fire-truck', [0, 0.8, 6]);
    runtime.advance(2_500);
    expect(runtime.getSnapshot()).toMatchObject({
      active: true,
      contactSourceId: null,
      remainingMilliseconds: 9_500,
      remainingSeconds: 10,
    });
  });

  it('同sourceへの再接触で12秒へ戻し、別色sourceは即時上書きする', () => {
    const runtime = createRuntime();
    runtime.syncVehiclePosition('fire-truck', requirePosition(RED_POOL_POSITION));
    runtime.syncVehiclePosition('fire-truck', [0, 0.8, 6]);
    runtime.advance(4_000);
    runtime.syncVehiclePosition('fire-truck', requirePosition(RED_POOL_POSITION));

    expect(runtime.getSnapshot()).toMatchObject({
      activationCount: 2,
      colorId: 'red',
      remainingMilliseconds: 12_000,
    });

    runtime.syncVehiclePosition('fire-truck', requirePosition(BLUE_POOL_POSITION));
    expect(runtime.getSnapshot()).toMatchObject({
      activationCount: 3,
      colorHex: '#3b82f6',
      colorId: 'blue',
      contactSourceId: 'pool-blue',
      remainingMilliseconds: 12_000,
      sourceId: 'pool-blue',
    });
  });

  it('離脱から12秒で元色へ戻り、発動回数だけを履歴として残す', () => {
    const runtime = createRuntime();
    runtime.syncVehiclePosition('bulldozer', requirePosition(YELLOW_SHOWER_POSITION));
    runtime.syncVehiclePosition('bulldozer', [0, 0.8, 6]);

    runtime.advance(11_999);
    expect(runtime.getSnapshot()).toMatchObject({ active: true, remainingMilliseconds: 1 });
    runtime.advance(1);

    expect(runtime.getSnapshot()).toEqual({
      active: false,
      activationCount: 1,
      colorHex: null,
      colorId: null,
      contactSourceId: null,
      remainingMilliseconds: 0,
      remainingSeconds: 0,
      sourceId: null,
      sourceKind: null,
      vehicleId: null,
    });
  });

  it('同車種選択とreset相当の位置移動では維持し、成功した別車種切替だけ解除する', () => {
    const runtime = createRuntime();
    runtime.syncVehiclePosition('fire-truck', requirePosition(RED_POOL_POSITION));
    runtime.syncVehiclePosition('fire-truck', [0, 0.8, 6]);

    runtime.handleSuccessfulVehicleSwitch('fire-truck');
    expect(runtime.getSnapshot().active).toBe(true);

    runtime.handleSuccessfulVehicleSwitch('bulldozer');
    expect(runtime.getSnapshot()).toMatchObject({
      active: false,
      activationCount: 1,
      vehicleId: null,
    });
  });

  it('listenerはentry・exit・秒境界だけを通知し、毎frame相当の減算では通知しない', () => {
    const runtime = createRuntime();
    const listener = vi.fn();
    const unsubscribe = runtime.subscribe(listener);

    runtime.syncVehiclePosition('fire-truck', requirePosition(RED_POOL_POSITION));
    runtime.syncVehiclePosition('fire-truck', [0, 0.8, 6]);
    expect(listener).toHaveBeenCalledTimes(2);

    runtime.advance(100);
    expect(runtime.getSnapshot().remainingMilliseconds).toBe(11_900);
    expect(listener).toHaveBeenCalledTimes(2);

    runtime.advance(901);
    expect(runtime.getSnapshot().remainingSeconds).toBe(11);
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    runtime.advance(1_000);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('非有限・0以下の時間を無視し、非有限位置をsourceとして扱わない', () => {
    const runtime = createRuntime();
    runtime.syncVehiclePosition('fire-truck', requirePosition(RED_POOL_POSITION));
    runtime.syncVehiclePosition('fire-truck', [0, 0.8, 6]);

    runtime.advance(Number.NaN);
    runtime.advance(Number.POSITIVE_INFINITY);
    runtime.advance(0);
    runtime.advance(-1);
    expect(runtime.getSnapshot().remainingMilliseconds).toBe(12_000);

    runtime.syncVehiclePosition('fire-truck', [Number.NaN, 0, 0]);
    expect(runtime.getSnapshot().contactSourceId).toBeNull();
  });
});

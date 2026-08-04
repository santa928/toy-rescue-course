import { describe, expect, it } from 'vitest';
import {
  VEHICLE_ACTION_VOXEL_POOL_SIZE,
  createVehicleActionInstanceColorArray,
  createVehicleActionVfxFrame,
  updateVehicleActionVfxFrame,
} from '../voxel-game/scene/actionVfx/vehicleActionFrame';
import type { VehicleId } from '../voxel-game/domain/vehicleDefinitions';
import {
  VEHICLE_ACTION_MATERIAL_USES_GEOMETRY_VERTEX_COLORS,
} from '../voxel-game/scene/actionVfx/VehicleActionEffects';

const SPECTACLE_VEHICLES = [
  'bulldozer',
  'excavator',
  'ambulance',
  'police',
] as const satisfies readonly VehicleId[];

/** 固定の車両位置で自由アクション1frameを進める。 */
function pressVehicleAction(vehicleId: VehicleId, elapsedSeconds = 1): ReturnType<
  typeof createVehicleActionVfxFrame
> {
  const frame = createVehicleActionVfxFrame();
  updateVehicleActionVfxFrame(frame, {
    actionActive: true,
    deltaSeconds: 1 / 60,
    elapsedSeconds,
    forward: [0, 0, 1],
    position: [4, 0.52, 8],
    speed: 2,
    vehicleId,
  });
  return frame;
}

describe('vehicle action VFX', () => {
  it('最大48個の非active固定slotを1回だけ確保する', () => {
    const frame = createVehicleActionVfxFrame();

    expect(frame.voxels).toHaveLength(VEHICLE_ACTION_VOXEL_POOL_SIZE);
    expect(frame.voxels.every(({ active }) => !active)).toBe(true);
    expect(frame.activeCount).toBe(0);
    expect(frame.pressCount).toBe(0);
  });

  it('初回render前から全instance colorを白で初期化する', () => {
    const colors = createVehicleActionInstanceColorArray();

    expect(colors).toHaveLength(VEHICLE_ACTION_VOXEL_POOL_SIZE * 3);
    expect([...colors].every((component) => component === 1)).toBe(true);
  });

  it('instance colorをgeometry vertex colorとの乗算なしで描画する', () => {
    expect(VEHICLE_ACTION_MATERIAL_USES_GEOMETRY_VERTEX_COLORS).toBe(false);
  });

  it.each(SPECTACLE_VEHICLES)('%sは対象外でも押下直後に固有voxelを表示する', (vehicleId) => {
    const frame = pressVehicleAction(vehicleId);
    const active = frame.voxels.filter(({ active }) => active);

    expect(active.length).toBeGreaterThanOrEqual(8);
    expect(frame.activeCount).toBe(active.length);
    expect(frame.pressCount).toBe(1);
    expect(frame.vehicleId).toBe(vehicleId);
  });

  it('4車種をpalette、配置、周期の組み合わせで見分けられる', () => {
    const signatures = SPECTACLE_VEHICLES.map((vehicleId) => {
      const frame = pressVehicleAction(vehicleId, 1.18);
      return JSON.stringify({
        cycleDurationSeconds: frame.cycleDurationSeconds,
        palettes: [...new Set(frame.voxels.filter(({ active }) => active).map(({ palette }) => palette))],
        positions: frame.voxels.filter(({ active }) => active).slice(0, 4).map(({ position }) => position),
      });
    });

    expect(new Set(signatures).size).toBe(SPECTACLE_VEHICLES.length);
  });

  it('押し続ける間は配列を再生成せずcycleを繰り返す', () => {
    const frame = createVehicleActionVfxFrame();
    const voxels = frame.voxels;
    const firstVoxel = frame.voxels[0];

    updateVehicleActionVfxFrame(frame, {
      actionActive: true,
      deltaSeconds: 1 / 60,
      elapsedSeconds: 2,
      forward: [0, 0, 1],
      position: [0, 0.52, 0],
      speed: 0,
      vehicleId: 'excavator',
    });
    const firstProgress = frame.cycleProgress;
    updateVehicleActionVfxFrame(frame, {
      actionActive: true,
      deltaSeconds: 1 / 60,
      elapsedSeconds: 2.6,
      forward: [0, 0, 1],
      position: [0, 0.52, 0],
      speed: 0,
      vehicleId: 'excavator',
    });

    expect(frame.voxels).toBe(voxels);
    expect(frame.voxels[0]).toBe(firstVoxel);
    expect(frame.cycleProgress).not.toBe(firstProgress);
    expect(frame.pressCount).toBe(1);
  });

  it('release後の短い戻りを終えると全slotを隠す', () => {
    const frame = pressVehicleAction('ambulance', 3);

    updateVehicleActionVfxFrame(frame, {
      actionActive: false,
      deltaSeconds: 1 / 60,
      elapsedSeconds: 3.1,
      forward: [0, 0, 1],
      position: [0, 0.52, 0],
      speed: 0,
      vehicleId: 'ambulance',
    });
    expect(frame.activeCount).toBeGreaterThan(0);

    updateVehicleActionVfxFrame(frame, {
      actionActive: false,
      deltaSeconds: 1 / 60,
      elapsedSeconds: 3.6,
      forward: [0, 0, 1],
      position: [0, 0.52, 0],
      speed: 0,
      vehicleId: 'ambulance',
    });
    expect(frame.activeCount).toBe(0);
    expect(frame.voxels.every(({ active }) => !active)).toBe(true);
  });

  it('消防車、未知位置、未知時刻では安全に全slotを隠す', () => {
    const frame = pressVehicleAction('police');

    updateVehicleActionVfxFrame(frame, {
      actionActive: true,
      deltaSeconds: Number.NaN,
      elapsedSeconds: Number.NaN,
      forward: [0, 0, 1],
      position: [Number.NaN, 0, 0],
      speed: Number.NaN,
      vehicleId: 'fire-truck',
    });

    expect(frame.activeCount).toBe(0);
    expect(frame.vehicleId).toBeNull();
  });
});

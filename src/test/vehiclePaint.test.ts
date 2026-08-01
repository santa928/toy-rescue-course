import { describe, expect, it } from 'vitest';
import {
  BULLDOZER_PALETTE,
  BULLDOZER_PALETTE_IDS,
  BULLDOZER_VOXELS,
} from '../vehicle-lab/model/bulldozerVoxels';
import {
  FIRE_TRUCK_PALETTE,
  FIRE_TRUCK_PALETTE_IDS,
  FIRE_TRUCK_VOXELS,
} from '../vehicle-lab/model/fireTruckVoxels';
import {
  VEHICLE_PAINTABLE_PALETTE_IDS,
  resolveVehiclePaintColor,
} from '../vehicle-lab/model/vehiclePaint';
import { BULLDOZER_RENDER_PLAN } from '../vehicle-lab/scene/VoxelBulldozer';
import { FIRE_TRUCK_RENDER_PLAN } from '../vehicle-lab/scene/VoxelFireTruck';

describe('vehicle paint palette', () => {
  it('消防車redとブルドーザーyellowだけをpaint対象にする', () => {
    expect(VEHICLE_PAINTABLE_PALETTE_IDS).toEqual({
      'fire-truck': ['red'],
      bulldozer: ['yellow'],
    });
  });

  it.each([
    ['#ef4444'],
    ['#3b82f6'],
    ['#facc15'],
  ])('消防車bodyへ%sを適用し、役割識別paletteは元色を残す', (paintColor) => {
    for (const paletteId of FIRE_TRUCK_PALETTE_IDS) {
      const baseColor = FIRE_TRUCK_PALETTE[paletteId].color;
      expect(resolveVehiclePaintColor({
        baseColor,
        paintColor,
        paletteId,
        vehicleId: 'fire-truck',
      })).toBe(paletteId === 'red' ? paintColor : baseColor);
    }
  });

  it.each([
    ['#ef4444'],
    ['#3b82f6'],
    ['#facc15'],
  ])('ブルドーザーbodyへ%sを適用し、履帯・blade・窓・灯火は元色を残す', (paintColor) => {
    for (const paletteId of BULLDOZER_PALETTE_IDS) {
      const baseColor = BULLDOZER_PALETTE[paletteId].color;
      expect(resolveVehiclePaintColor({
        baseColor,
        paintColor,
        paletteId,
        vehicleId: 'bulldozer',
      })).toBe(paletteId === 'yellow' ? paintColor : baseColor);
    }
  });

  it.each([null, '', 'blue', '#zzzzzz', '#12345', '#1234567']) (
    'paintColor=%sは元paletteへ安全にfallbackする',
    (paintColor) => {
      expect(resolveVehiclePaintColor({
        baseColor: FIRE_TRUCK_PALETTE.red.color,
        paintColor,
        paletteId: 'red',
        vehicleId: 'fire-truck',
      })).toBe(FIRE_TRUCK_PALETTE.red.color);
    },
  );

  it('一時塗装でvoxel数とvehicle draw callを増やさない', () => {
    expect(FIRE_TRUCK_RENDER_PLAN.voxelCount).toBe(FIRE_TRUCK_VOXELS.length);
    expect(BULLDOZER_RENDER_PLAN.voxelCount).toBe(BULLDOZER_VOXELS.length);
    expect(FIRE_TRUCK_RENDER_PLAN.drawCalls).toBe(7);
    expect(BULLDOZER_RENDER_PLAN.drawCalls).toBe(7);
  });
});

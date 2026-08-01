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
  EXCAVATOR_PALETTE,
  EXCAVATOR_PALETTE_IDS,
  EXCAVATOR_VOXELS,
} from '../vehicle-lab/model/excavatorVoxels';
import {
  AMBULANCE_PALETTE,
  AMBULANCE_PALETTE_IDS,
  AMBULANCE_VOXELS,
} from '../vehicle-lab/model/ambulanceVoxels';
import {
  VEHICLE_PAINTABLE_PALETTE_IDS,
  resolveVehiclePaintColor,
} from '../vehicle-lab/model/vehiclePaint';
import { BULLDOZER_RENDER_PLAN } from '../vehicle-lab/scene/VoxelBulldozer';
import { FIRE_TRUCK_RENDER_PLAN } from '../vehicle-lab/scene/VoxelFireTruck';
import { EXCAVATOR_RENDER_PLAN } from '../vehicle-lab/scene/VoxelExcavator';
import { AMBULANCE_RENDER_PLAN } from '../vehicle-lab/scene/VoxelAmbulance';
import {
  POLICE_PALETTE,
  POLICE_PALETTE_IDS,
  POLICE_VOXELS,
} from '../vehicle-lab/model/policeVoxels';
import { POLICE_RENDER_PLAN } from '../vehicle-lab/scene/VoxelPolice';

describe('vehicle paint palette', () => {
  it('5台のbody paletteだけをpaint対象にする', () => {
    expect(VEHICLE_PAINTABLE_PALETTE_IDS).toEqual({
      'fire-truck': ['red'],
      bulldozer: ['yellow'],
      excavator: ['orange'],
      ambulance: ['white'],
      police: ['white'],
    });
  });

  it.each([
    ['#ef4444'],
    ['#3b82f6'],
    ['#facc15'],
  ])('パトカーbodyへ%sを適用し、黒帯・窓・車輪・赤青灯は残す', (paintColor) => {
    for (const paletteId of POLICE_PALETTE_IDS) {
      const baseColor = POLICE_PALETTE[paletteId].color;
      expect(resolveVehiclePaintColor({
        baseColor,
        paintColor,
        paletteId,
        vehicleId: 'police',
      })).toBe(paletteId === 'white' ? paintColor : baseColor);
    }
  });

  it.each([
    ['#ef4444'],
    ['#3b82f6'],
    ['#facc15'],
  ])('救急車bodyへ%sを適用し、赤帯・赤十字・窓・車輪・灯火は残す', (paintColor) => {
    for (const paletteId of AMBULANCE_PALETTE_IDS) {
      const baseColor = AMBULANCE_PALETTE[paletteId].color;
      expect(resolveVehiclePaintColor({
        baseColor,
        paintColor,
        paletteId,
        vehicleId: 'ambulance',
      })).toBe(paletteId === 'white' ? paintColor : baseColor);
    }
  });

  it.each([
    ['#ef4444'],
    ['#3b82f6'],
    ['#facc15'],
  ])('ショベルカーbodyへ%sを適用し、履帯・arm・bucket・窓・灯火は残す', (paintColor) => {
    for (const paletteId of EXCAVATOR_PALETTE_IDS) {
      const baseColor = EXCAVATOR_PALETTE[paletteId].color;
      expect(resolveVehiclePaintColor({
        baseColor,
        paintColor,
        paletteId,
        vehicleId: 'excavator',
      })).toBe(paletteId === 'orange' ? paintColor : baseColor);
    }
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
    expect(EXCAVATOR_RENDER_PLAN.voxelCount).toBe(EXCAVATOR_VOXELS.length);
    expect(AMBULANCE_RENDER_PLAN.voxelCount).toBe(AMBULANCE_VOXELS.length);
    expect(POLICE_RENDER_PLAN.voxelCount).toBe(POLICE_VOXELS.length);
    expect(FIRE_TRUCK_RENDER_PLAN.drawCalls).toBe(7);
    expect(BULLDOZER_RENDER_PLAN.drawCalls).toBe(7);
    expect(EXCAVATOR_RENDER_PLAN.drawCalls).toBe(7);
    expect(AMBULANCE_RENDER_PLAN.drawCalls).toBe(7);
    expect(POLICE_RENDER_PLAN.drawCalls).toBe(7);
  });
});

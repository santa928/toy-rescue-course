import { describe, expect, it } from 'vitest';
import { getVehicleById, VEHICLES } from '../game/data/vehicles';

describe('VEHICLES', () => {
  it('救急車、パトカー、消防車、ブルドーザー、ショベルカーを選べる', () => {
    expect(VEHICLES.map((vehicle) => vehicle.id)).toEqual([
      'ambulance',
      'police',
      'firetruck',
      'bulldozer',
      'excavator',
    ]);
  });

  it('車種ごとに操作差がある', () => {
    const bulldozer = getVehicleById('bulldozer');
    const police = getVehicleById('police');
    const ambulance = getVehicleById('ambulance');
    const firetruck = getVehicleById('firetruck');

    expect(bulldozer.pushPower).toBeGreaterThan(police.pushPower);
    expect(police.maxSpeed).toBeGreaterThan(bulldozer.maxSpeed);
    expect(ambulance.acceleration).toBeGreaterThanOrEqual(8);
    expect(firetruck.maxSpeed).toBeGreaterThanOrEqual(7);
    expect(bulldozer.turnPower).toBeGreaterThanOrEqual(2);
  });
});

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { advanceWheelAngle, findWheelCenter, writeWheelMatrix } from '../vehicle-lab/model/vehicleWheelMotion';
import { FIRE_TRUCK_RENDER_PLAN } from '../vehicle-lab/scene/VoxelFireTruck';
import { AMBULANCE_RENDER_PLAN } from '../vehicle-lab/scene/VoxelAmbulance';
import { POLICE_RENDER_PLAN } from '../vehicle-lab/scene/VoxelPolice';

describe('走行に連動するタイヤ', () => {
  it('半径0.6の車輪が円周分進むと一周し、後退で逆回転する', () => {
    expect(advanceWheelAngle(0, 0.6 * Math.PI)).toBeCloseTo(-Math.PI);
    expect(advanceWheelAngle(0, 0.6 * Math.PI * 2)).toBeCloseTo(0);
    expect(advanceWheelAngle(-1, -0.6)).toBeCloseTo(0);
    expect(advanceWheelAngle(1, 0)).toBe(1);
  });

  it.each([
    ['fire-truck', FIRE_TRUCK_RENDER_PLAN],
    ['ambulance', AMBULANCE_RENDER_PLAN],
    ['police', POLICE_RENDER_PLAN],
  ] as const)('%sのタイヤとハブだけを各21セルの4輪へ分ける', (id, plan) => {
    const wheels = new Map<string, number>();
    for (const batch of plan.batches) for (const position of batch.positions) {
      const center = findWheelCenter(id, position);
      if (center) wheels.set(center.join(','), (wheels.get(center.join(',')) ?? 0) + 1);
    }
    expect([...wheels.values()]).toEqual([21, 21, 21, 21]);
    expect(findWheelCenter(id, [0, 0.48, -0.96])).toBeNull();
  });

  it('車軸を固定してセルの位置と向きを回し、タイヤ上端が前方へ動く', () => {
    const matrix = new THREE.Matrix4();
    const center = [-1.2, 0.48, -0.96] as const;
    writeWheelMatrix(matrix, [-1.2, 0.72, -0.96], center, -Math.PI / 2);
    const point = new THREE.Vector3().setFromMatrixPosition(matrix);
    expect(point.x).toBeCloseTo(-1.2);
    expect(point.y).toBeCloseTo(0.48);
    expect(point.z).toBeCloseTo(-1.2); // 車体modelの前方は-Z
    writeWheelMatrix(matrix, center, center, -Math.PI / 2);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([...center]);
  });
});

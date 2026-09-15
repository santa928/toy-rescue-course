import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { advanceTrackTravel, findTrackLink, getTrackLoopLength, writeTrackMatrix } from '../vehicle-lab/model/vehicleTrackMotion';
import { BULLDOZER_RENDER_PLAN } from '../vehicle-lab/scene/VoxelBulldozer';
import { EXCAVATOR_RENDER_PLAN } from '../vehicle-lab/scene/VoxelExcavator';

describe('キャタピラ走行', () => {
  it.each([
    ['bulldozer', BULLDOZER_RENDER_PLAN, 64],
    ['excavator', EXCAVATOR_RENDER_PLAN, 72],
  ] as const)('%sの外周だけが循環し、一周後は元へ戻る', (id, plan, count) => {
    const matrix = new THREE.Matrix4();
    let links = 0;
    for (const batch of plan.batches) for (const position of batch.positions) {
      const link = findTrackLink(id, position);
      if (!link) continue;
      links++;
      writeTrackMatrix(matrix, link, getTrackLoopLength(id), id);
      const actual = new THREE.Vector3().setFromMatrixPosition(matrix);
      position.forEach((value, axis) => expect(actual.getComponent(axis)).toBeCloseTo(value));
    }
    expect(links).toBe(count);
    expect(findTrackLink(id, [-1.2, 0.24, 0])).toBeNull(); // 内部の転輪
    expect(findTrackLink(id, [0, 0.48, 0])).toBeNull(); // 車体
  });

  it('前進時は上側が前へ、地面側が後ろへ動き、後退では逆になる', () => {
    const matrix = new THREE.Matrix4();
    const top = findTrackLink('bulldozer', [-1.2, 0.48, 0])!;
    const bottom = findTrackLink('bulldozer', [-1.2, 0, 0])!;
    writeTrackMatrix(matrix, top, 0.1, 'bulldozer');
    expect(matrix.elements[14]).toBeCloseTo(-0.1);
    writeTrackMatrix(matrix, bottom, 0.1, 'bulldozer');
    expect(matrix.elements[14]).toBeCloseTo(0.1);
    writeTrackMatrix(matrix, top, -0.1, 'bulldozer');
    expect(matrix.elements[14]).toBeCloseTo(0.1);
  });

  it('停止時は位置を保持し、その場旋回では左右が逆方向に動く', () => {
    const travel = { left: 0, right: 0 };
    advanceTrackTravel(travel, 0.5, 0, 'bulldozer');
    expect(travel).toEqual({ left: 0.5, right: 0.5 });
    advanceTrackTravel(travel, 0, 0, 'bulldozer');
    expect(travel).toEqual({ left: 0.5, right: 0.5 });
    advanceTrackTravel(travel, 0, 0.5, 'bulldozer');
    expect(travel.left).toBeCloseTo(-0.1);
    expect(travel.right).toBeCloseTo(1.1);
  });
});

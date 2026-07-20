import { describe, expect, it } from 'vitest';
import {
  resolveScreenRelativeMovement,
  shortestAngleDelta,
} from '../voxel-game/scene/screenRelativeMovement';
import { WORLD_CAMERA_LOOK_OFFSET, WORLD_CAMERA_OFFSET } from '../voxel-game/scene/worldCameraConfig';

const cameraForward = (() => {
  const x = WORLD_CAMERA_LOOK_OFFSET[0] - WORLD_CAMERA_OFFSET[0];
  const z = WORLD_CAMERA_LOOK_OFFSET[2] - WORLD_CAMERA_OFFSET[2];
  const length = Math.hypot(x, z);
  return [x / length, z / length] as const;
})();
const screenRight = [-cameraForward[1], cameraForward[0]] as const;

/** XZ平面の2方向ベクトル同士の内積を返す。 */
function dotXZ(left: readonly [number, number, number], right: readonly [number, number]): number {
  return left[0] * right[0] + left[2] * right[1];
}

describe('screenRelativeMovement', () => {
  it.each([
    [{ moveX: -1, moveY: 0, spray: false }, screenRight, -1, cameraForward],
    [{ moveX: 1, moveY: 0, spray: false }, screenRight, 1, cameraForward],
    [{ moveX: 0, moveY: 1, spray: false }, cameraForward, 1, screenRight],
    [{ moveX: 0, moveY: -1, spray: false }, cameraForward, -1, screenRight],
  ] as const)('画面入力%jを固定camera basisの対応方向へ写す', (command, expectedAxis, directionSign, orthogonalAxis) => {
    const movement = resolveScreenRelativeMovement(command);
    expect(dotXZ(movement.direction, expectedAxis) * directionSign).toBeCloseTo(1, 9);
    expect(dotXZ(movement.direction, orthogonalAxis)).toBeCloseTo(0, 9);
    expect(Math.hypot(movement.velocity[0], movement.velocity[2])).toBeCloseTo(7.4, 6);
  });

  it('中間touch入力の大きさを速度へ残す', () => {
    const movement = resolveScreenRelativeMovement({ moveX: 0.3, moveY: 0.4, spray: false });
    expect(movement.magnitude).toBeCloseTo(0.5, 9);
    expect(Math.hypot(movement.velocity[0], movement.velocity[2])).toBeCloseTo(3.7, 6);
  });

  it('π境界を越えるyaw差を最短方向へ正規化する', () => {
    expect(shortestAngleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 9);
    expect(shortestAngleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 9);
  });

  it('停止commandへ有限なzero movementを返す', () => {
    expect(resolveScreenRelativeMovement({ moveX: 0, moveY: 0, spray: false }))
      .toMatchObject({ magnitude: 0, screenProjection: [0, 0], velocity: [0, 0, 0] });
  });
});

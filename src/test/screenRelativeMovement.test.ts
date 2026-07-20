import { describe, expect, it } from 'vitest';
import {
  resolveScreenRelativeMovement,
  shortestAngleDelta,
} from '../voxel-game/scene/screenRelativeMovement';

describe('screenRelativeMovement', () => {
  it.each([
    [{ moveX: -1, moveY: 0, spray: false }, -1, 0],
    [{ moveX: 1, moveY: 0, spray: false }, 1, 0],
    [{ moveX: 0, moveY: 1, spray: false }, 0, 1],
    [{ moveX: 0, moveY: -1, spray: false }, 0, -1],
  ] as const)('画面入力%jを固定camera basisの対応方向へ写す', (command, screenX, screenY) => {
    const movement = resolveScreenRelativeMovement(command);
    expect(movement.screenProjection).toEqual([screenX, screenY]);
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

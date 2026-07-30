import { describe, expect, it } from 'vitest';
import {
  createWaterFlowPath,
  createWaterFlowFrame,
  WATER_INSTANCE_COUNT,
  WATER_SPLASH_COUNT,
  WATER_STREAM_COUNT,
  type WaterFlowPath,
} from '../voxel-game/scene/waterFlow';

const straightPath: WaterFlowPath = {
  controlX: 3,
  controlY: 2,
  controlZ: 1,
  endX: 3,
  endY: 2,
  endZ: -2,
  startX: 3,
  startY: 2,
  startZ: 4,
};

const baseInput = {
  path: straightPath,
  splashElapsedSeconds: 0,
  sprayActive: true,
  sprayElapsedSeconds: 0.7,
  targeted: false,
};

describe('waterFlow', () => {
  it('固定32slotをstream 24とsplash 8へ分ける', () => {
    const frame = createWaterFlowFrame(baseInput);
    expect(frame.instances).toHaveLength(WATER_INSTANCE_COUNT);
    expect(frame.instances.filter(({ kind }) => kind === 'stream')).toHaveLength(WATER_STREAM_COUNT);
    expect(frame.instances.filter(({ kind }) => kind === 'splash')).toHaveLength(WATER_SPLASH_COUNT);
  });

  it('異なる時刻で複数stream粒が先端方向へ前進する', () => {
    const first = createWaterFlowFrame({ ...baseInput, sprayElapsedSeconds: 0.7 });
    const second = createWaterFlowFrame({ ...baseInput, sprayElapsedSeconds: 0.76 });
    const moved = first.instances.filter(({ active, kind }) => active && kind === 'stream')
      .filter((instance) => {
        const next = second.instances[instance.slot];
        return next?.active && next.position[2] < instance.position[2] - 0.01;
      });
    expect(moved.length).toBeGreaterThanOrEqual(4);
  });

  it('quadratic Bézier上の複数stream slot位置を固定する', () => {
    const frame = createWaterFlowFrame({
      ...baseInput,
      path: {
        controlX: 1,
        controlY: 2,
        controlZ: -2,
        endX: 3,
        endY: 0,
        endZ: -4,
        startX: 0,
        startY: 0,
        startZ: 0,
      },
    });

    expect(frame.instances[0]?.position).toEqual([
      1.5879017013232515,
      0.841730447468437,
      -2.4347826086956523,
    ]);
    expect(frame.instances[7]?.position).toEqual([
      0.9991500945179584,
      0.9605314013427197,
      -1.6556521739130434,
    ]);
    expect(frame.instances[20]?.position).toEqual([
      0.10706994328922485,
      0.16855992898092925,
      -0.20869565217391287,
    ]);
  });

  it('全stream粒を斜めのnozzleからvisible endの間へ収め、横ずれを制限する', () => {
    const direction = [1, 1, -1] as const;
    const nozzleOrigin = [3, 2, 4] as const;
    const visibleDistance = 6;
    const directionLength = Math.hypot(...direction);
    const normalizedDirection = direction.map((value) => value / directionLength) as [number, number, number];
    const end = nozzleOrigin.map(
      (value, axis) => value + normalizedDirection[axis] * visibleDistance,
    ) as [number, number, number];
    const control = nozzleOrigin.map(
      (value, axis) => value + normalizedDirection[axis] * visibleDistance / 2,
    ) as [number, number, number];
    const frame = createWaterFlowFrame({
      ...baseInput,
      path: {
        controlX: control[0],
        controlY: control[1],
        controlZ: control[2],
        endX: end[0],
        endY: end[1],
        endZ: end[2],
        startX: nozzleOrigin[0],
        startY: nozzleOrigin[1],
        startZ: nozzleOrigin[2],
      },
    });

    for (const instance of frame.instances.filter(({ active, kind }) => active && kind === 'stream')) {
      const offset = instance.position.map((value, axis) => value - nozzleOrigin[axis]) as [number, number, number];
      const distance = offset[0] * normalizedDirection[0]
        + offset[1] * normalizedDirection[1]
        + offset[2] * normalizedDirection[2];
      const orthogonalOffset = Math.hypot(
        offset[0] - normalizedDirection[0] * distance,
        offset[1] - normalizedDirection[1] * distance,
        offset[2] - normalizedDirection[2] * distance,
      );
      expect(distance).toBeGreaterThanOrEqual(0);
      expect(distance).toBeLessThanOrEqual(visibleDistance);
      expect(orthogonalOffset).toBeLessThanOrEqual(0.25);
    }
  });

  it('targeted中だけ飛沫を出し、220ms終端でscaleを0へ戻す', () => {
    const untargeted = createWaterFlowFrame(baseInput);
    const targeted = createWaterFlowFrame({ ...baseInput, splashElapsedSeconds: 0.1, targeted: true });
    const expired = createWaterFlowFrame({ ...baseInput, splashElapsedSeconds: 0.22, targeted: true });
    expect(untargeted.instances.some(({ active, kind }) => active && kind === 'splash')).toBe(false);
    expect(targeted.instances.some(({ active, kind }) => active && kind === 'splash')).toBe(true);
    expect(expired.instances.filter(({ kind }) => kind === 'splash').every(({ scale }) => scale === 0)).toBe(true);
  });

  it('停止中は全slotをinactiveかつscale 0にし、splash slotを24から31へ固定する', () => {
    const frame = createWaterFlowFrame({ ...baseInput, sprayActive: false, targeted: true, splashElapsedSeconds: 0.1 });
    expect(frame.instances.every(({ active, scale }) => !active && scale === 0)).toBe(true);
    expect(frame.instances.filter(({ kind }) => kind === 'splash').map(({ slot }) => slot)).toEqual([
      24, 25, 26, 27, 28, 29, 30, 31,
    ]);
  });

  it('targeted pathは45/55補正を初期接線に保ち、炎の0.55unit手前へ収束する', () => {
    const target = [3, 0, -4] as const;
    const initialDirection = [0.34765745321001684, 0, -0.9376216162330757] as const;
    const path = createWaterFlowPath({
      initialDirection,
      nozzleOrigin: [0, 0, 0],
      targetPosition: target,
      targeted: true,
    });
    const endpointError = Math.hypot(
      target[0] - path.endX,
      target[1] - path.endY,
      target[2] - path.endZ,
    );
    const tangent = [
      path.controlX - path.startX,
      path.controlY - path.startY,
      path.controlZ - path.startZ,
    ] as const;
    const tangentLength = Math.hypot(...tangent);

    expect(endpointError).toBeCloseTo(0.55, 12);
    tangent.forEach((value, axis) => {
      expect(value / tangentLength).toBeCloseTo(initialDirection[axis], 12);
    });
    expect(path.endX).toBeCloseTo(2.67, 12);
    expect(path.endY).toBe(0);
    expect(path.endZ).toBeCloseTo(-3.56, 12);
  });

  it('非targeted pathは既存方向へ6unitの直線を保つ', () => {
    expect(createWaterFlowPath({
      initialDirection: [0, 0, -1],
      nozzleOrigin: [3, 2, 4],
      targetPosition: [12.9, 1.45, -9.1],
      targeted: false,
    })).toEqual(straightPath);
  });
});

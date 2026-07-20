import * as THREE from 'three';
import type { DriveCommand } from '../input/controlState';
import { WORLD_CAMERA_LOOK_OFFSET, WORLD_CAMERA_OFFSET } from './worldCameraConfig';

export interface ScreenRelativeMovement {
  readonly direction: readonly [number, number, number];
  readonly magnitude: number;
  readonly screenProjection: readonly [number, number];
  readonly targetYaw: number | null;
  readonly velocity: readonly [number, number, number];
}

const MAX_SPEED = 7.4;
const cameraForward = new THREE.Vector3(
  WORLD_CAMERA_LOOK_OFFSET[0] - WORLD_CAMERA_OFFSET[0],
  0,
  WORLD_CAMERA_LOOK_OFFSET[2] - WORLD_CAMERA_OFFSET[2],
).normalize();
const screenRight = new THREE.Vector3().crossVectors(cameraForward, THREE.Object3D.DEFAULT_UP).normalize();

/** 任意角差を[-π, π]へ畳み、現在yawから目標yawへの最短差を返す。 */
export function shortestAngleDelta(currentYaw: number, targetYaw: number): number {
  return Math.atan2(Math.sin(targetYaw - currentYaw), Math.cos(targetYaw - currentYaw));
}

/** 画面方向commandを固定camera basis上のworld平面速度と目標yawへ変換する。 */
export function resolveScreenRelativeMovement(command: DriveCommand): ScreenRelativeMovement {
  const safeX = Number.isFinite(command.moveX) ? command.moveX : 0;
  const safeY = Number.isFinite(command.moveY) ? command.moveY : 0;
  const rawMagnitude = Math.hypot(safeX, safeY);
  const magnitude = Math.min(1, rawMagnitude);
  if (magnitude === 0) {
    return { direction: [0, 0, 0], magnitude: 0, screenProjection: [0, 0], targetYaw: null, velocity: [0, 0, 0] };
  }
  const normalizedX = safeX / rawMagnitude;
  const normalizedY = safeY / rawMagnitude;
  const worldX = screenRight.x * normalizedX + cameraForward.x * normalizedY;
  const worldZ = screenRight.z * normalizedX + cameraForward.z * normalizedY;
  return {
    direction: [worldX, 0, worldZ],
    magnitude,
    screenProjection: [normalizedX, normalizedY],
    targetYaw: Math.atan2(worldX, worldZ),
    velocity: [worldX * MAX_SPEED * magnitude, 0, worldZ * MAX_SPEED * magnitude],
  };
}

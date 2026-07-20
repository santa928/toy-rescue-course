import * as THREE from 'three';
import type { DriveCommand } from '../input/controlState';
import { WORLD_CAMERA_LOOK_OFFSET, WORLD_CAMERA_OFFSET } from './worldCameraConfig';

export interface ScreenRelativeMovement {
  /** world XZ平面における単位移動方向。 */
  readonly direction: readonly [number, number, number];
  /** commandの入力強度を0から1へclampした無次元値。 */
  readonly magnitude: number;
  /** camera画面の右・上を正とする正規化済み2次元入力。 */
  readonly screenProjection: readonly [number, number];
  /** world XZ平面でdirectionを向くためのラジアンyaw。停止時はnull。 */
  readonly targetYaw: number | null;
  /** world XZ平面上の目標速度。単位はworld unit/秒。 */
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

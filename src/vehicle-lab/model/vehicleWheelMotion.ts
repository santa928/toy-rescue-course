import type { Matrix4 } from 'three';

export type WheeledVehicleId = 'fire-truck' | 'ambulance' | 'police';
type Point = readonly [number, number, number];
export const VEHICLE_WHEEL_RADIUS = 0.6;

/** 実移動距離をmodel前方(-Z)へ転がる角度へ変換し、長時間走行でも一周以内へ保つ。 */
export function advanceWheelAngle(angle: number, signedDistance: number): number {
  return (angle - signedDistance / VEHICLE_WHEEL_RADIUS) % (Math.PI * 2);
}

/** 車体から外側へ独立したタイヤとハブのセルだけに、未offsetの車軸中心を返す。 */
export function findWheelCenter(vehicleId: WheeledVehicleId, position: Point): Point | null {
  const [x, y, z] = position.map((value) => Math.round(value / 0.24));
  const leftX = vehicleId === 'fire-truck' ? -6 : -5;
  if ((x !== leftX && x !== 5) || y < 0 || y > 4) return null;
  const centerZ = z < 0 ? -4 : 4;
  if (Math.abs(z - centerZ) > 2) return null;
  return [x * 0.24, 0.48, centerZ * 0.24];
}

/** 車軸の周りでvoxelの位置と姿勢を回し、既存matrixへ書く。frame内で新規objectは作らない。 */
export function writeWheelMatrix(matrix: Matrix4, position: Point, center: Point, angle: number): void {
  const dy = position[1] - center[1];
  const dz = position[2] - center[2];
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  matrix.makeRotationX(angle);
  matrix.setPosition(position[0], center[1] + dy * cosine - dz * sine, center[2] + dy * sine + dz * cosine);
}

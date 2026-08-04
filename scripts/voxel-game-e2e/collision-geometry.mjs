import assert from 'node:assert/strict';

/** XZ平面の2次元vectorが有限値であることを保証する。 */
function assertFinitePlanarVector(vector, description) {
  assert(Array.isArray(vector) && vector.length >= 3,
    `${description} must be an XYZ vector.`);
  assert(Number.isFinite(vector[0]) && Number.isFinite(vector[2]),
    `${description} must contain finite X/Z values.`);
}

/** 指定軸に投影した、回転車体と軸平行obstacleの中心間clearanceを返す。 */
function calculateAxisClearance(centerDelta, axis, vehicleAxes, vehicleHalfExtents, obstacleHalfExtents) {
  const centerDistance = Math.abs(centerDelta.x * axis.x + centerDelta.z * axis.z);
  const vehicleRadius = vehicleHalfExtents.x * Math.abs(
    vehicleAxes.right.x * axis.x + vehicleAxes.right.z * axis.z,
  ) + vehicleHalfExtents.z * Math.abs(
    vehicleAxes.forward.x * axis.x + vehicleAxes.forward.z * axis.z,
  );
  const obstacleRadius = obstacleHalfExtents.x * Math.abs(axis.x)
    + obstacleHalfExtents.z * Math.abs(axis.z);
  return centerDistance - vehicleRadius - obstacleRadius;
}

/**
 * 回転した車体OBBと軸平行obstacle AABBをXZ平面の4分離軸で評価する。
 * 正のaxis clearanceが1つでもあれば分離、全て0以下なら最小重なりを貫通深さとして返す。
 */
export function calculatePlanarBoxContact(vehicle, obstacle, vehicleColliderHalfExtents) {
  assertFinitePlanarVector(vehicle?.forward, 'vehicle.forward');
  assertFinitePlanarVector(vehicle?.position, 'vehicle.position');
  assertFinitePlanarVector(obstacle?.position, 'obstacle.position');
  assertFinitePlanarVector(obstacle?.scale, 'obstacle.scale');
  assertFinitePlanarVector(vehicleColliderHalfExtents, 'vehicleColliderHalfExtents');
  assert(obstacle.scale[0] > 0 && obstacle.scale[2] > 0,
    'obstacle.scale X/Z must be positive.');
  assert(vehicleColliderHalfExtents[0] > 0 && vehicleColliderHalfExtents[2] > 0,
    'vehicleColliderHalfExtents X/Z must be positive.');

  const forwardLength = Math.hypot(vehicle.forward[0], vehicle.forward[2]);
  assert(forwardLength > 0, 'vehicle.forward X/Z must not be zero.');
  const forward = {
    x: vehicle.forward[0] / forwardLength,
    z: vehicle.forward[2] / forwardLength,
  };
  const right = { x: forward.z, z: -forward.x };
  const centerDelta = {
    x: obstacle.position[0] - vehicle.position[0],
    z: obstacle.position[2] - vehicle.position[2],
  };
  const vehicleHalfExtents = {
    x: vehicleColliderHalfExtents[0],
    z: vehicleColliderHalfExtents[2],
  };
  const obstacleHalfExtents = {
    x: obstacle.scale[0] / 2,
    z: obstacle.scale[2] / 2,
  };
  const axes = {
    vehicleForward: forward,
    vehicleRight: right,
    worldX: { x: 1, z: 0 },
    worldZ: { x: 0, z: 1 },
  };
  const axisClearances = Object.fromEntries(Object.entries(axes).map(([name, axis]) => [
    name,
    calculateAxisClearance(
      centerDelta,
      axis,
      { forward, right },
      vehicleHalfExtents,
      obstacleHalfExtents,
    ),
  ]));
  const maximumAxisClearance = Math.max(...Object.values(axisClearances));

  return {
    axisClearances,
    intersects: maximumAxisClearance <= 0,
    penetrationDepth: Math.max(0, -maximumAxisClearance),
    separationDistance: Math.max(0, maximumAxisClearance),
  };
}

/**
 * keyboard衝突接近で、横ずれが閾値を超えた間だけworld補正軸を返す。
 * 閾値内では本来の接近軸へ戻し、接触後の保持入力と同じ方向へ揃える。
 */
export function selectCollisionKeyboardAxis({
  approachAxis,
  approachDirection,
  obstaclePosition,
  perpendicularTolerance,
  vehiclePosition,
}) {
  assert(approachAxis === 'x' || approachAxis === 'z', 'approachAxis must be x or z.');
  assert(approachDirection === -1 || approachDirection === 1,
    'approachDirection must be -1 or 1.');
  assertFinitePlanarVector(obstaclePosition, 'obstaclePosition');
  assertFinitePlanarVector(vehiclePosition, 'vehiclePosition');
  assert(Number.isFinite(perpendicularTolerance) && perpendicularTolerance >= 0,
    'perpendicularTolerance must be finite and non-negative.');

  const perpendicularAxis = approachAxis === 'x' ? 'z' : 'x';
  const perpendicularIndex = perpendicularAxis === 'x' ? 0 : 2;
  const perpendicularDelta = obstaclePosition[perpendicularIndex]
    - vehiclePosition[perpendicularIndex];
  if (Math.abs(perpendicularDelta) > perpendicularTolerance) {
    return {
      axis: `${perpendicularDelta < 0 ? 'negative' : 'positive'}${perpendicularAxis.toUpperCase()}`,
      correcting: true,
    };
  }
  return {
    axis: `${approachDirection < 0 ? 'negative' : 'positive'}${approachAxis.toUpperCase()}`,
    correcting: false,
  };
}

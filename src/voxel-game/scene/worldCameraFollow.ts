/** 接触解決の微振動をcameraが追わないためのworld-space片側余白。 */
export const CAMERA_FOLLOW_DEAD_ZONE = 0.18;

/** 現在anchorからdead zoneを越えた意図的な軸移動だけを追従目標へ反映する。 */
export function resolveCameraFollowAxis(
  currentAnchor: number,
  vehicleCoordinate: number,
  deadZone = CAMERA_FOLLOW_DEAD_ZONE,
): number {
  const safeDeadZone = Number.isFinite(deadZone) ? Math.max(0, deadZone) : CAMERA_FOLLOW_DEAD_ZONE;
  const delta = vehicleCoordinate - currentAnchor;
  if (!Number.isFinite(delta) || Math.abs(delta) <= safeDeadZone) return currentAnchor;
  return vehicleCoordinate - Math.sign(delta) * safeDeadZone;
}

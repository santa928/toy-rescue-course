import type { WorldPoint } from '../scene/productionWorldMap';

/** 車種別仕事が共有する距離、速度、継続時間の接触条件。 */
export interface ActionTargetInteraction {
  readonly contactRadius: number;
  readonly forwardOffset: number;
  readonly holdDurationMs: number;
  readonly maximumSpeed: number;
  readonly minimumSpeed: number;
}

/** 接触判定へ渡す現在のactual位置・入力・速度。 */
export interface ActionTargetContactSample {
  readonly actionActive: boolean;
  readonly contactPoint: WorldPoint;
  readonly interaction: ActionTargetInteraction;
  readonly speed: number;
  readonly targetPosition: WorldPoint;
  readonly targetRadius: number;
}

/** 接触中心を導出する車両telemetryの最小契約。 */
export interface ActionTargetVehiclePose {
  readonly forward: WorldPoint;
  readonly position: WorldPoint;
}

/** 車両位置と水平前方から主操作のworld接触中心を返す。 */
export function getActionTargetContactPoint(
  pose: ActionTargetVehiclePose,
  forwardOffset: number,
  target: [number, number, number] = [0, 0, 0],
): WorldPoint {
  const [forwardX, , forwardZ] = pose.forward;
  const horizontalLength = Math.hypot(forwardX, forwardZ);
  if (
    !pose.position.every(Number.isFinite)
    || !Number.isFinite(horizontalLength)
    || horizontalLength <= 0
    || !Number.isFinite(forwardOffset)
    || forwardOffset < 0
  ) {
    throw new Error('Action contact requires a finite horizontal forward vector');
  }
  target[0] = pose.position[0] + forwardX / horizontalLength * forwardOffset;
  target[1] = pose.position[1] + 0.35;
  target[2] = pose.position[2] + forwardZ / horizontalLength * forwardOffset;
  return target;
}

/** 主操作、速度範囲、水平距離の全gateを満たすactual接触だけを受理する。 */
export function isActionTargetContact(sample: ActionTargetContactSample): boolean {
  const { interaction } = sample;
  if (
    !sample.actionActive
    || !sample.contactPoint.every(Number.isFinite)
    || !sample.targetPosition.every(Number.isFinite)
    || !Number.isFinite(sample.speed)
    || !Number.isFinite(sample.targetRadius)
    || sample.targetRadius <= 0
    || !Number.isFinite(interaction.contactRadius)
    || interaction.contactRadius <= 0
    || !Number.isFinite(interaction.minimumSpeed)
    || interaction.minimumSpeed < 0
    || !Number.isFinite(interaction.maximumSpeed)
    || interaction.maximumSpeed < interaction.minimumSpeed
    || sample.speed < interaction.minimumSpeed
    || sample.speed > interaction.maximumSpeed
  ) {
    return false;
  }
  return Math.hypot(
    sample.contactPoint[0] - sample.targetPosition[0],
    sample.contactPoint[2] - sample.targetPosition[2],
  ) <= interaction.contactRadius + sample.targetRadius;
}

/** 接触中だけ最大50msずつ累積し、必要時間へ到達したら上限で固定する。 */
export function advanceActionTargetHold(
  currentMilliseconds: number,
  contactActive: boolean,
  deltaMilliseconds: number,
  requiredMilliseconds: number,
): number {
  if (!contactActive) return 0;
  const current = Number.isFinite(currentMilliseconds) && currentMilliseconds >= 0
    ? currentMilliseconds
    : 0;
  const delta = Number.isFinite(deltaMilliseconds) && deltaMilliseconds > 0
    ? Math.min(deltaMilliseconds, 50)
    : 0;
  const required = Number.isFinite(requiredMilliseconds) && requiredMilliseconds > 0
    ? requiredMilliseconds
    : 0;
  if (required === 0) return 0;
  return Math.min(required, current + delta);
}

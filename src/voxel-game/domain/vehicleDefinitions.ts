import type { WorldPoint } from '../scene/productionWorldMap';

/** 本番箱庭で最初から選べる働く車の識別子。 */
export type VehicleId = 'fire-truck' | 'bulldozer';

/** 車両ごとに割り当てる仕事の識別子。 */
export type VehicleMissionId = 'fire-rescue' | 'debris-clearance';

/** HUDへ表示する車両固有primary actionの文言。 */
export interface VehicleActionDefinition {
  readonly ariaLabel: string;
  readonly label: string;
}

/** Rapier colliderのmodel-space配置。 */
export interface VehicleColliderDefinition {
  readonly halfExtents: WorldPoint;
  readonly offset: WorldPoint;
}

/** 毎frameの車両応答へ使う正の物理パラメーター。 */
export interface VehiclePhysicsDefinition {
  readonly idleResponse: number;
  readonly mass: number;
  readonly movingResponse: number;
  readonly yawClamp: number;
}

/** actual telemetryと画面投影で共有する車両外接直方体。 */
export interface VehicleVisualBoundsDefinition {
  readonly offset: WorldPoint;
  readonly scale: WorldPoint;
}

/** 見た目、操作、物理、仕事を1つのIDへ結び付ける静的車両定義。 */
export interface VehicleDefinition {
  readonly action: VehicleActionDefinition;
  readonly collider: VehicleColliderDefinition;
  readonly id: VehicleId;
  readonly label: string;
  readonly missionId: VehicleMissionId;
  readonly physics: VehiclePhysicsDefinition;
  readonly visualBounds: VehicleVisualBoundsDefinition;
}

/** 車庫内での乗り換え可否を判定する現在状態。 */
export interface VehicleSwitchContext {
  readonly atGarage: boolean;
  readonly speed: number;
}

const MAX_SWITCH_SPEED = 0.35;

/** 本番箱庭で選べる全車両の唯一の静的registry。 */
export const VEHICLE_DEFINITIONS = [
  {
    action: { ariaLabel: '水を出す', label: 'みず' },
    collider: { halfExtents: [1.45, 0.95, 1.7], offset: [0, 0.95, 0] },
    id: 'fire-truck',
    label: 'しょうぼうしゃ',
    missionId: 'fire-rescue',
    physics: {
      idleResponse: 4.8,
      mass: 1.4,
      movingResponse: 7.5,
      yawClamp: 5.2,
    },
    visualBounds: { offset: [0, 0.84, 0], scale: [2.88, 1.92, 3.36] },
  },
  {
    action: { ariaLabel: 'ブレードを動かす', label: 'ブレード' },
    collider: { halfExtents: [1.68, 0.95, 1.56], offset: [0, 0.9, 0] },
    id: 'bulldozer',
    label: 'ブルドーザー',
    missionId: 'debris-clearance',
    physics: {
      idleResponse: 4.4,
      mass: 1.9,
      movingResponse: 6.8,
      yawClamp: 4.8,
    },
    visualBounds: { offset: [0, 0.78, 0], scale: [3.36, 1.92, 3.12] },
  },
] as const satisfies readonly VehicleDefinition[];

/** 3成分すべてが有限値か判定する。 */
function isFinitePoint(point: WorldPoint): boolean {
  return point.every(Number.isFinite);
}

/** 3成分すべてが正の有限値か判定する。 */
function isPositivePoint(point: WorldPoint): boolean {
  return point.every((value) => Number.isFinite(value) && value > 0);
}

/** 車両registryの重複、文言、物理、外接寸法を決定的なerror一覧へ変換する。 */
export function validateVehicleDefinitions(
  definitions: readonly VehicleDefinition[],
): readonly string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const definition of definitions) {
    if (ids.has(definition.id)) errors.push(`Duplicate vehicle id: ${definition.id}`);
    ids.add(definition.id);

    if (
      definition.label.trim().length === 0
      || definition.action.label.trim().length === 0
      || definition.action.ariaLabel.trim().length === 0
    ) {
      errors.push(`Vehicle ${definition.id} must have non-empty labels`);
    }

    for (const [name, value] of Object.entries(definition.physics)) {
      if (!Number.isFinite(value) || value <= 0) {
        errors.push(`Vehicle ${definition.id} has invalid physics value: ${name}`);
      }
    }

    if (!isFinitePoint(definition.collider.offset)
      || !isPositivePoint(definition.collider.halfExtents)) {
      errors.push(`Vehicle ${definition.id} has invalid collider`);
    }
    if (!isFinitePoint(definition.visualBounds.offset)
      || !isPositivePoint(definition.visualBounds.scale)) {
      errors.push(`Vehicle ${definition.id} has invalid visual bounds`);
    }
  }

  return errors;
}

/** 外部値を既知の車両定義へ解決し、不正値は初期消防車へ戻す。 */
export function getVehicleDefinition(id: unknown): VehicleDefinition {
  return VEHICLE_DEFINITIONS.find((definition) => definition.id === id)
    ?? VEHICLE_DEFINITIONS[0];
}

/** 車庫内かつ停止同等の有限速度でだけ乗り換えを許可する。 */
export function canSwitchVehicle({ atGarage, speed }: VehicleSwitchContext): boolean {
  return atGarage && Number.isFinite(speed) && speed >= 0 && speed <= MAX_SWITCH_SPEED;
}

const VEHICLE_DEFINITION_ERRORS = validateVehicleDefinitions(VEHICLE_DEFINITIONS);
if (VEHICLE_DEFINITION_ERRORS.length > 0) {
  throw new Error(`Invalid vehicle definitions: ${VEHICLE_DEFINITION_ERRORS.join('; ')}`);
}

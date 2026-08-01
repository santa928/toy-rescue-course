import type {
  BulldozerDebrisLandmarkDefinition,
  WorldDistrictId,
  WorldPoint,
} from '../scene/productionWorldMap';
import {
  PRODUCTION_WORLD_MAP,
  resolveWorldDistrict,
} from '../scene/productionWorldMap';
import type {
  VehicleId,
  VehicleMissionId,
} from './vehicleDefinitions';

/** 1 session内で抽選する全仕事の識別子。 */
export type VehicleJobId =
  | 'fire-side'
  | 'fire-window-left'
  | 'fire-window-right'
  | 'debris-north'
  | 'debris-south'
  | 'debris-west';

/** HUD、scene、telemetryが共有する車種別仕事の共通定義。 */
interface BaseVehicleJobDefinition {
  readonly destinationDistrict: WorldDistrictId;
  readonly id: VehicleJobId;
  readonly kind: VehicleMissionId;
  readonly label: string;
  readonly routeMarkers: readonly WorldPoint[];
  readonly vehicleId: VehicleId;
}

/** 消防車の炎、照準、道しるべ、成功星を同じ仕事へ束ねる。 */
export interface FireVehicleJobDefinition extends BaseVehicleJobDefinition {
  readonly celebrationStarCenters: readonly WorldPoint[];
  readonly destinationDistrict: 'fire';
  readonly kind: 'fire-rescue';
  readonly sprayTarget: WorldPoint;
  readonly vehicleId: 'fire-truck';
}

/** ブルドーザーの3がれきと道しるべを同じ仕事へ束ねる。 */
export interface BulldozerVehicleJobDefinition extends BaseVehicleJobDefinition {
  readonly debris: readonly BulldozerDebrisLandmarkDefinition[];
  readonly destinationDistrict: 'blocks';
  readonly kind: 'debris-clearance';
  readonly vehicleId: 'bulldozer';
}

/** 全車種仕事を扱うdiscriminated union。 */
export type VehicleJobDefinition = FireVehicleJobDefinition | BulldozerVehicleJobDefinition;

/** 車種ごとに型を保った仕事registry。 */
export interface VehicleJobRegistry {
  readonly bulldozer: readonly BulldozerVehicleJobDefinition[];
  readonly 'fire-truck': readonly FireVehicleJobDefinition[];
}

const FIRE_ROUTE_COMMON = PRODUCTION_WORLD_MAP.landmarks.fireRouteMarkers.slice(0, 9);

/** 火災照準点の周囲へ既存数と同じ6個の成功星中心を作る。 */
function createFireCelebrationCenters([x, y, z]: WorldPoint): readonly WorldPoint[] {
  return [
    [x - 2.1, y - 0.4, z + 4.8],
    [x + 1.4, y - 0.2, z + 4.4],
    [x - 0.5, y + 1.4, z + 4.2],
    [x - 2.6, y + 0.4, z + 3.8],
    [x + 2.2, y + 1.6, z + 3.2],
    [x + 0.7, y + 0.2, z + 2.8],
  ];
}

const FIRE_WINDOW_LEFT_TARGET = [22.2, 1.45, -19.6] as const;
const FIRE_WINDOW_RIGHT_TARGET = [24.8, 1.45, -19.6] as const;

/** 抽選対象となる各車種3件のcanonical仕事定義。 */
export const VEHICLE_JOBS = {
  'fire-truck': [
    {
      celebrationStarCenters: PRODUCTION_WORLD_MAP.landmarks.celebrationStarCenters,
      destinationDistrict: 'fire',
      id: 'fire-side',
      kind: 'fire-rescue',
      label: 'よこの火をけそう',
      routeMarkers: PRODUCTION_WORLD_MAP.landmarks.fireRouteMarkers,
      sprayTarget: PRODUCTION_WORLD_MAP.landmarks.fireSprayTarget,
      vehicleId: 'fire-truck',
    },
    {
      celebrationStarCenters: createFireCelebrationCenters(FIRE_WINDOW_LEFT_TARGET),
      destinationDistrict: 'fire',
      id: 'fire-window-left',
      kind: 'fire-rescue',
      label: 'ひだりのまどをけそう',
      routeMarkers: [
        ...FIRE_ROUTE_COMMON,
        [30, 0.26, -5],
        [28, 0.26, -10],
        [23, 0.26, -15],
      ],
      sprayTarget: FIRE_WINDOW_LEFT_TARGET,
      vehicleId: 'fire-truck',
    },
    {
      celebrationStarCenters: createFireCelebrationCenters(FIRE_WINDOW_RIGHT_TARGET),
      destinationDistrict: 'fire',
      id: 'fire-window-right',
      kind: 'fire-rescue',
      label: 'みぎのまどをけそう',
      routeMarkers: [
        ...FIRE_ROUTE_COMMON,
        [30, 0.26, -5],
        [29, 0.26, -10],
        [26, 0.26, -15],
      ],
      sprayTarget: FIRE_WINDOW_RIGHT_TARGET,
      vehicleId: 'fire-truck',
    },
  ],
  bulldozer: [
    {
      debris: PRODUCTION_WORLD_MAP.landmarks.bulldozerDebris,
      destinationDistrict: 'blocks',
      id: 'debris-north',
      kind: 'debris-clearance',
      label: 'きたのがれきをかたづけよう',
      routeMarkers: PRODUCTION_WORLD_MAP.landmarks.bulldozerRouteMarkers,
      vehicleId: 'bulldozer',
    },
    {
      debris: [
        { id: 'debris-south-timber', palette: 'timber', position: [-29.5, 0.8, -6.5], radius: 1.15 },
        { id: 'debris-south-stone', palette: 'stone', position: [-24, 0.8, -7], radius: 1.15 },
        { id: 'debris-south-crate', palette: 'crate', position: [-18.5, 0.8, -6], radius: 1.15 },
      ],
      destinationDistrict: 'blocks',
      id: 'debris-south',
      kind: 'debris-clearance',
      label: 'みなみのがれきをかたづけよう',
      routeMarkers: [
        [-3, 0.26, 0],
        [-7, 0.26, 0],
        [-11, 0.26, 0],
        [-15, 0.26, 0],
        [-18, 0.26, -2],
        [-21, 0.26, -5],
        [-24, 0.26, -7],
      ],
      vehicleId: 'bulldozer',
    },
    {
      debris: [
        { id: 'debris-west-timber', palette: 'timber', position: [-32, 0.8, -6], radius: 1.15 },
        { id: 'debris-west-stone', palette: 'stone', position: [-32, 0.8, 2], radius: 1.15 },
        { id: 'debris-west-crate', palette: 'crate', position: [-32, 0.8, 10], radius: 1.15 },
      ],
      destinationDistrict: 'blocks',
      id: 'debris-west',
      kind: 'debris-clearance',
      label: 'にしのみちをかたづけよう',
      routeMarkers: [
        [-3, 0.26, 0],
        [-7, 0.26, 0],
        [-11, 0.26, 0],
        [-15, 0.26, 0],
        [-20, 0.26, 0],
        [-25, 0.26, 0],
        [-30, 0.26, 0],
      ],
      vehicleId: 'bulldozer',
    },
  ],
} as const satisfies VehicleJobRegistry;

/** registryの件数、ID、文言、車種、対象数、座標契約を決定的に列挙する。 */
export function validateVehicleJobs(registry: VehicleJobRegistry): readonly string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const vehicleIds: readonly VehicleId[] = ['fire-truck', 'bulldozer'];

  for (const vehicleId of vehicleIds) {
    const jobs: readonly VehicleJobDefinition[] = registry[vehicleId];
    if (jobs.length !== 3) errors.push(`Vehicle ${vehicleId} must have exactly 3 jobs`);
    for (const job of jobs) {
      if (ids.has(job.id)) errors.push(`Duplicate vehicle job id: ${job.id}`);
      ids.add(job.id);
      if (job.label.trim().length === 0) {
        errors.push(`Vehicle job ${job.id} must have a non-empty label`);
      }
      if (job.vehicleId !== vehicleId) {
        errors.push(`Vehicle job ${job.id} belongs to ${job.vehicleId}, expected ${vehicleId}`);
      }

      const expectedRouteLength = job.kind === 'fire-rescue' ? 12 : 7;
      if (job.routeMarkers.length !== expectedRouteLength
        || job.routeMarkers.some((position) => !position.every(Number.isFinite))) {
        errors.push(`Vehicle job ${job.id} has invalid route markers`);
      }

      if (job.kind === 'fire-rescue') {
        if (job.destinationDistrict !== 'fire'
          || resolveWorldDistrict(job.sprayTarget) !== 'fire') {
          errors.push(`Fire job ${job.id} must target the fire district`);
        }
        if (job.celebrationStarCenters.length !== 6
          || job.celebrationStarCenters.some((position) => !position.every(Number.isFinite))) {
          errors.push(`Fire job ${job.id} must have exactly 6 finite star centers`);
        }
      } else {
        if (job.debris.length !== 3) {
          errors.push(`Bulldozer job ${job.id} must have exactly 3 debris`);
        }
        const debrisIds = new Set(job.debris.map(({ id }) => id));
        const palettes = new Set(job.debris.map(({ palette }) => palette));
        if (debrisIds.size !== job.debris.length
          || job.debris.some(({ id }) => id.trim().length === 0)) {
          errors.push(`Bulldozer job ${job.id} must have unique non-empty debris ids`);
        }
        if (palettes.size !== 3) {
          errors.push(`Bulldozer job ${job.id} must include timber, stone, and crate`);
        }
        if (job.destinationDistrict !== 'blocks'
          || job.debris.some(({ position }) => resolveWorldDistrict(position) !== 'blocks')) {
          errors.push(`Bulldozer job ${job.id} must stay in the blocks district`);
        }
      }
    }
  }
  return errors;
}

/** 外部車種IDを既知の仕事一覧へ解決し、不正値は初期消防車へ戻す。 */
export function getVehicleJobs(vehicleId: unknown): readonly VehicleJobDefinition[] {
  return vehicleId === 'bulldozer' ? VEHICLE_JOBS.bulldozer : VEHICLE_JOBS['fire-truck'];
}

const VEHICLE_JOB_ERRORS = validateVehicleJobs(VEHICLE_JOBS);
if (VEHICLE_JOB_ERRORS.length > 0) {
  throw new Error(`Invalid vehicle jobs: ${VEHICLE_JOB_ERRORS.join('; ')}`);
}

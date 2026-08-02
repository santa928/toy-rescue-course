import type {
  ProductionWorldMapDefinition,
  WorldBounds2D,
  WorldDecorationClusterDefinition,
  WorldDistrictDefinition,
  WorldDistrictId,
  WorldPoint,
  WorldRoadDefinition,
  WorldSurfaceTileDefinition,
  WorldBoxDefinition,
} from './productionWorldMap';

/** 地区床の上面を道路上面より十分低く保つ最大world Y。 */
export const WORLD_SURFACE_MAX_TOP_Y = 0.08;

/** 各地区の道路外で固有床が覆う最低比率。 */
export const WORLD_MIN_NON_ROAD_COVERAGE = 0.7;

/** 既存と新規を合わせたstatic colliderの上限。 */
export const WORLD_MAX_STATIC_COLLIDERS = 40;

/** 新しいsolid装飾を道路から車体半幅分だけ離す安全余白。 */
export const WORLD_ROAD_SOLID_CLEARANCE = 1.6;

/** 新しいsolid装飾を車庫入口と色遊びtriggerから離す安全余白。 */
export const WORLD_INTERACTION_SOLID_CLEARANCE = 1.5;

/** 地区床へ許可する承認済みの基底色と模様色。 */
export const WORLD_SURFACE_PALETTE = {
  blocks: ['#d8ba76', '#f2d995'],
  construction: ['#d5b468', '#a9adb3'],
  fire: ['#d99275', '#efb7a3'],
  hub: ['#dfcda8', '#f6e8c9'],
  park: ['#91bd70', '#b9d798'],
  south: ['#82b8d7', '#aed5e9'],
  town: ['#d7d0b9', '#eee7d2'],
} as const satisfies Readonly<Record<WorldDistrictId, readonly [string, string]>>;

const COVERAGE_SAMPLE_STEP = 0.5;
const GARAGE_ENTRY_CLEARANCE_BOUNDS: WorldBounds2D = {
  maxX: 5.5,
  maxZ: 10,
  minX: -5.5,
  minZ: 2.5,
};

/** boxのXZ外形をfull scaleから導出する。 */
function getBoxBounds(position: WorldPoint, scale: WorldPoint): WorldBounds2D {
  return {
    maxX: position[0] + scale[0] / 2,
    maxZ: position[2] + scale[2] / 2,
    minX: position[0] - scale[0] / 2,
    minZ: position[2] - scale[2] / 2,
  };
}

/** XZ境界を指定量だけ全方向へ拡張する。 */
function expandBounds(bounds: WorldBounds2D, amount: number): WorldBounds2D {
  return {
    maxX: bounds.maxX + amount,
    maxZ: bounds.maxZ + amount,
    minX: bounds.minX - amount,
    minZ: bounds.minZ - amount,
  };
}

/** 点が境界上を含むXZ矩形内にあるかを返す。 */
function containsPoint(bounds: WorldBounds2D, x: number, z: number): boolean {
  return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
}

/** 内側のXZ境界が外側へはみ出さないかを返す。 */
function containsBounds(outer: WorldBounds2D, inner: WorldBounds2D): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX
    && inner.minZ >= outer.minZ && inner.maxZ <= outer.maxZ;
}

/** 2つのXZ境界が正の面積で重なるかを返す。 */
function overlapsBounds(first: WorldBounds2D, second: WorldBounds2D): boolean {
  return Math.max(first.minX, second.minX) < Math.min(first.maxX, second.maxX)
    && Math.max(first.minZ, second.minZ) < Math.min(first.maxZ, second.maxZ);
}

/** 3成分tupleが有限値だけを持つかを返す。 */
function isFinitePoint(point: WorldPoint): boolean {
  return point.every(Number.isFinite);
}

/** 3成分scaleが正の有限値だけを持つかを返す。 */
function isPositiveScale(scale: WorldPoint): boolean {
  return scale.every((value) => Number.isFinite(value) && value > 0);
}

/** 全装飾群のboxを定義順の単一canonical列へ平坦化する。 */
export function flattenDecorationBoxes(
  clusters: readonly WorldDecorationClusterDefinition[],
): readonly WorldBoxDefinition[] {
  return clusters.flatMap(({ boxes }) => boxes);
}

/** 7地区ごとの装飾群数を0件の地区も含めて返す。 */
export function countDecorationClustersByDistrict(
  clusters: readonly WorldDecorationClusterDefinition[],
): Readonly<Record<WorldDistrictId, number>> {
  const counts: Record<WorldDistrictId, number> = {
    blocks: 0,
    construction: 0,
    fire: 0,
    hub: 0,
    park: 0,
    south: 0,
    town: 0,
  };
  for (const cluster of clusters) counts[cluster.districtId] += 1;
  return counts;
}

/** 地区内の道路外sample点を固有床が覆う比率を決定的に計算する。 */
export function calculateDistrictNonRoadSurfaceCoverage(
  district: WorldDistrictDefinition,
  roads: readonly WorldRoadDefinition[],
  surfaces: readonly WorldSurfaceTileDefinition[],
): number {
  const roadBounds = roads.map(({ position, scale }) => getBoxBounds(position, scale));
  const surfaceBounds = surfaces
    .filter(({ districtId }) => districtId === district.id)
    .map(({ position, scale }) => getBoxBounds(position, scale));
  let nonRoadSamples = 0;
  let coveredSamples = 0;

  for (
    let x = district.bounds.minX + COVERAGE_SAMPLE_STEP / 2;
    x < district.bounds.maxX;
    x += COVERAGE_SAMPLE_STEP
  ) {
    for (
      let z = district.bounds.minZ + COVERAGE_SAMPLE_STEP / 2;
      z < district.bounds.maxZ;
      z += COVERAGE_SAMPLE_STEP
    ) {
      if (roadBounds.some((bounds) => containsPoint(bounds, x, z))) continue;
      nonRoadSamples += 1;
      if (surfaceBounds.some((bounds) => containsPoint(bounds, x, z))) coveredSamples += 1;
    }
  }

  return nonRoadSamples === 0 ? 0 : coveredSamples / nonRoadSamples;
}

/** canonical streetscapeの床、装飾、安全余白、性能上限をpureに検証する。 */
export function validateWorldStreetscape(
  map: ProductionWorldMapDefinition,
): readonly string[] {
  const errors: string[] = [];
  const districtById = new Map(map.districts.map((district) => [district.id, district]));
  const decorationPalette = new Set(map.visualBoxes.map(({ color }) => color));
  const streetscapeIds = new Set<string>();

  const recordId = (id: string): void => {
    if (streetscapeIds.has(id)) errors.push(`duplicate streetscape id: ${id}`);
    streetscapeIds.add(id);
  };

  for (const surface of map.surfaceTiles) {
    recordId(surface.id);
    const district = districtById.get(surface.districtId);
    const positionIsFinite = isFinitePoint(surface.position);
    const scaleIsValid = isPositiveScale(surface.scale);
    if (!positionIsFinite) errors.push(`non-finite surface position: ${surface.id}`);
    if (!scaleIsValid) errors.push(`invalid surface scale: ${surface.id}`);
    if (!WORLD_SURFACE_PALETTE[surface.districtId]?.includes(surface.color as never)) {
      errors.push(`surface color outside district palette: ${surface.id}`);
    }
    if (positionIsFinite && scaleIsValid) {
      const bounds = getBoxBounds(surface.position, surface.scale);
      if (!containsBounds(map.bounds, bounds)) errors.push(`surface outside world bounds: ${surface.id}`);
      if (!district || !containsBounds(district.bounds, bounds)) {
        errors.push(`surface outside district bounds: ${surface.id}`);
      }
      if (surface.position[1] + surface.scale[1] / 2 > WORLD_SURFACE_MAX_TOP_Y) {
        errors.push(`surface above road-safe height: ${surface.id}`);
      }
    }
  }

  const clusterCounts = countDecorationClustersByDistrict(map.decorationClusters);
  for (const district of map.districts) {
    const count = clusterCounts[district.id];
    if (count < 2 || count > 4) {
      errors.push(`district decoration cluster count outside 2..4: ${district.id} (${count})`);
    }
    const hasEntry = map.decorationClusters.some(
      ({ districtId, purpose }) => districtId === district.id && purpose === 'entry',
    );
    if (!hasEntry) errors.push(`district missing entry decoration: ${district.id}`);

    const coverage = calculateDistrictNonRoadSurfaceCoverage(
      district,
      map.roads,
      map.surfaceTiles,
    );
    if (coverage < WORLD_MIN_NON_ROAD_COVERAGE) {
      errors.push(`district surface coverage below 70 percent: ${district.id}`);
    }
  }

  const expandedRoadBounds = map.roads.map(({ position, scale }) => (
    expandBounds(getBoxBounds(position, scale), WORLD_ROAD_SOLID_CLEARANCE)
  ));
  const expandedInteractionBounds = map.landmarks.colorPlaySources.map(({ triggerBounds }) => (
    expandBounds(triggerBounds, WORLD_INTERACTION_SOLID_CLEARANCE)
  ));
  expandedInteractionBounds.push(expandBounds(
    GARAGE_ENTRY_CLEARANCE_BOUNDS,
    WORLD_INTERACTION_SOLID_CLEARANCE,
  ));

  for (const cluster of map.decorationClusters) {
    recordId(cluster.id);
    const district = districtById.get(cluster.districtId);
    if (cluster.purpose.length === 0) errors.push(`empty decoration purpose: ${cluster.id}`);
    for (const box of cluster.boxes) {
      recordId(box.id);
      const positionIsFinite = isFinitePoint(box.position);
      const scaleIsValid = isPositiveScale(box.scale);
      if (!positionIsFinite) errors.push(`non-finite decoration position: ${box.id}`);
      if (!scaleIsValid) errors.push(`invalid decoration scale: ${box.id}`);
      if (box.rotation && !box.rotation.every(Number.isFinite)) {
        errors.push(`non-finite decoration rotation: ${box.id}`);
      }
      if (!decorationPalette.has(box.color)) {
        errors.push(`decoration color outside visual palette: ${box.id}`);
      }
      if (!positionIsFinite || !scaleIsValid) continue;

      const bounds = getBoxBounds(box.position, box.scale);
      if (!containsBounds(map.bounds, bounds)) errors.push(`decoration outside world bounds: ${box.id}`);
      if (!district || !containsBounds(district.bounds, bounds)) {
        errors.push(`decoration outside district bounds: ${box.id}`);
      }
      if (!box.solid) continue;
      if (expandedRoadBounds.some((roadBounds) => overlapsBounds(bounds, roadBounds))) {
        errors.push(`decoration solid overlaps expanded road: ${box.id}`);
      }
      if (expandedInteractionBounds.some((interactionBounds) => (
        overlapsBounds(bounds, interactionBounds)
      ))) {
        errors.push(`decoration solid overlaps interaction clearance: ${box.id}`);
      }
    }
  }

  const legacySolidCount = map.visualBoxes.filter(({ solid }) => solid).length;
  const decorationSolidCount = flattenDecorationBoxes(map.decorationClusters)
    .filter(({ solid }) => solid).length;
  if (legacySolidCount + decorationSolidCount > WORLD_MAX_STATIC_COLLIDERS) {
    errors.push(
      `static collider count exceeds ${WORLD_MAX_STATIC_COLLIDERS}: ${legacySolidCount + decorationSolidCount}`,
    );
  }

  return errors;
}

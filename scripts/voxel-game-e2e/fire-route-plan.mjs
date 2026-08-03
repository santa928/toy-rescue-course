import assert from 'node:assert/strict';

const EAST_TRUNK_X = 30;
const EAST_FACE_LATITUDE_OFFSET = 3.1;
const TARGET_STAGING_OFFSET = 5.8;

/** 描画中の案内ルートがE2Eで追跡できる有限座標列かを検証する。 */
function assertRouteMarkers(routeMarkers) {
  assert(
    Array.isArray(routeMarkers)
      && routeMarkers.length >= 2
      && routeMarkers.every((position) => (
        Array.isArray(position)
        && position.length === 3
        && position.every(Number.isFinite)
      )),
    'fire route markers must contain at least two finite 3D points.',
  );
}

/** 仕事ごとの火災面と描画ルートから、安全な接近・帰還経路の基準座標を返す。 */
export function createFireRoutePlan(jobId, target, routeMarkers) {
  assert(
    Array.isArray(target) && target.length === 3 && target.every(Number.isFinite),
    'fire route target must be a finite 3D point.',
  );
  assert(
    jobId === 'fire-side' || jobId === 'fire-window-left' || jobId === 'fire-window-right',
    `unsupported fire job: ${jobId}`,
  );
  assertRouteMarkers(routeMarkers);

  const approachesNorthFace = jobId !== 'fire-side';
  const approachStart = routeMarkers.at(-2);
  const approachEnd = routeMarkers.at(-1);
  if (approachesNorthFace) {
    assert(
      approachStart[2] < target[2] && approachEnd[2] < target[2],
      'window fire route must stay north of target.',
    );
    assert(
      Math.abs(approachEnd[0] - target[0]) <= 0.01,
      'window fire route must align with target X.',
    );
    assert(
      approachEnd[2] > approachStart[2],
      'window fire route must finish facing south toward the target.',
    );
  }
  const latitudeZ = approachesNorthFace
    ? approachEnd[2]
    : target[2] + EAST_FACE_LATITUDE_OFFSET;
  return Object.freeze({
    acquisitionAxis: approachesNorthFace ? 'positiveZ' : 'negativeX',
    arrivalDistrict: approachesNorthFace ? 'road' : 'fire',
    approachFace: approachesNorthFace ? 'north' : 'east',
    approachStartZ: approachesNorthFace ? approachStart[2] : latitudeZ,
    latitudeZ,
    requiresEastLaneBeforeReturn: approachesNorthFace,
    stagingX: approachesNorthFace ? approachEnd[0] : target[0] + TARGET_STAGING_OFFSET,
    trunkX: EAST_TRUNK_X,
  });
}

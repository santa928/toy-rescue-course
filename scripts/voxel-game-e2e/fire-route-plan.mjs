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
    jobId === 'fire-side' || jobId === 'fire-hydrant' || jobId === 'fire-planter',
    `unsupported fire job: ${jobId}`,
  );
  assertRouteMarkers(routeMarkers);

  const approachesOpenTarget = jobId !== 'fire-side';
  const approachStart = routeMarkers.at(-2);
  const approachEnd = routeMarkers.at(-1);
  if (approachesOpenTarget) {
    assert(
      Math.abs(approachStart[2] - target[2]) <= 0.01
        && Math.abs(approachEnd[2] - target[2]) <= 0.01,
      'outdoor fire route must share the target latitude.',
    );
    assert(
      approachEnd[0] > target[0],
      'outdoor fire route must stay east of target.',
    );
    assert(
      approachEnd[0] < approachStart[0],
      'outdoor fire route must finish facing west toward the target.',
    );
  }
  const latitudeZ = approachesOpenTarget
    ? target[2]
    : target[2] + EAST_FACE_LATITUDE_OFFSET;
  return Object.freeze({
    acquisitionAxis: 'negativeX',
    arrivalDistrict: 'fire',
    approachFace: approachesOpenTarget ? 'open-east' : 'east',
    approachStartZ: approachesOpenTarget ? approachStart[2] : latitudeZ,
    latitudeZ,
    requiresEastLaneBeforeReturn: false,
    stagingX: approachesOpenTarget ? approachEnd[0] : target[0] + TARGET_STAGING_OFFSET,
    trunkX: EAST_TRUNK_X,
  });
}

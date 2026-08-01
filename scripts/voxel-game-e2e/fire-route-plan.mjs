import assert from 'node:assert/strict';

const EAST_TRUNK_X = 30;
const EAST_FACE_LATITUDE_OFFSET = 3.1;
const TARGET_STAGING_OFFSET = 5.8;

/** 仕事ごとの火災面に応じ、安全な接近・帰還経路の基準座標を返す。 */
export function createFireRoutePlan(jobId, target) {
  assert(
    Array.isArray(target) && target.length === 3 && target.every(Number.isFinite),
    'fire route target must be a finite 3D point.',
  );
  assert(
    jobId === 'fire-side' || jobId === 'fire-window-left' || jobId === 'fire-window-right',
    `unsupported fire job: ${jobId}`,
  );

  const approachesNorthFace = jobId !== 'fire-side';
  return Object.freeze({
    acquisitionAxis: approachesNorthFace ? 'positiveZ' : 'negativeX',
    arrivalDistrict: approachesNorthFace ? 'road' : 'fire',
    approachFace: approachesNorthFace ? 'north' : 'east',
    latitudeZ: approachesNorthFace
      ? target[2] - TARGET_STAGING_OFFSET
      : target[2] + EAST_FACE_LATITUDE_OFFSET,
    requiresEastLaneBeforeReturn: approachesNorthFace,
    stagingX: approachesNorthFace ? target[0] : target[0] + TARGET_STAGING_OFFSET,
    trunkX: EAST_TRUNK_X,
  });
}

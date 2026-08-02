import type { WorldBounds2D, WorldPoint } from '../scene/productionWorldMap';

/** world座標をおしごとマップ内の0〜100%へクランプして投影する。 */
export function projectWorldToMissionMap(
  position: WorldPoint,
  bounds: WorldBounds2D,
): { readonly leftPercent: number; readonly topPercent: number } {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxZ - bounds.minZ;
  if (
    !position.every(Number.isFinite)
    || ![bounds.maxX, bounds.maxZ, bounds.minX, bounds.minZ, width, height].every(Number.isFinite)
    || width <= 0
    || height <= 0
  ) {
    return { leftPercent: 50, topPercent: 50 };
  }
  const leftPercent = Math.min(100, Math.max(0, ((position[0] - bounds.minX) / width) * 100));
  const topPercent = Math.min(100, Math.max(0, ((position[2] - bounds.minZ) / height) * 100));
  return { leftPercent, topPercent };
}

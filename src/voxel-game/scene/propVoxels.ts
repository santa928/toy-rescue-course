import { VOXEL_SIZE } from '../../voxelGrid';
import type { WorldBoxDefinition, WorldPoint } from './productionWorldMap';

/** 模型の原点から数えた最小セル座標とセル数を、既存の箱batchへ渡す。 */
export function voxelPartsAt(prefix: string, [x, y, z]: WorldPoint) {
  return (name: string, color: string, [i, j, k]: WorldPoint, [w, h, d]: WorldPoint,
    solid = false): WorldBoxDefinition => ({
    id: name ? `${prefix}-${name}` : prefix,
    color,
    position: [x + (i + w / 2) * VOXEL_SIZE, y + (j + h / 2) * VOXEL_SIZE, z + (k + d / 2) * VOXEL_SIZE],
    scale: [w * VOXEL_SIZE, h * VOXEL_SIZE, d * VOXEL_SIZE],
    solid,
  });
}

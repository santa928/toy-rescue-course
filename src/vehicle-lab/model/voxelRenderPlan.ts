import {
  calculateModelOffset,
  groupVoxelsByPalette,
  type VoxelBounds,
  type VoxelCell,
} from './voxelModel';

export interface VoxelRenderBatch<PaletteId extends string> {
  readonly paletteId: PaletteId;
  readonly positions: readonly (readonly [number, number, number])[];
}

export interface VoxelRenderPlan<PaletteId extends string> {
  readonly batches: readonly VoxelRenderBatch<PaletteId>[];
  readonly drawCalls: number;
  readonly offset: readonly [number, number, number];
  readonly voxelCount: number;
  readonly voxelSize: number;
}

/** 検証済みセルから色別instance位置とモデル中央オフセットを作る。 */
export function createVoxelRenderPlan<PaletteId extends string>(
  cells: readonly VoxelCell<PaletteId>[],
  paletteIds: readonly PaletteId[],
  bounds: VoxelBounds,
  voxelSize: number,
): VoxelRenderPlan<PaletteId> {
  const groups = groupVoxelsByPalette(cells, paletteIds);
  const batches = [...groups.entries()].map(([paletteId, paletteCells]) => ({
    paletteId,
    positions: paletteCells.map((cell) => [
      cell.x * voxelSize,
      cell.y * voxelSize,
      cell.z * voxelSize,
    ] as const),
  }));

  return {
    batches,
    drawCalls: batches.length,
    offset: calculateModelOffset(bounds, voxelSize),
    voxelCount: cells.length,
    voxelSize,
  };
}

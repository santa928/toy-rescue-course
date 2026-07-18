export interface VoxelCoordinate {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface VoxelCell<PaletteId extends string = string> extends VoxelCoordinate {
  readonly paletteId: PaletteId;
}

export interface VoxelBounds {
  readonly min: VoxelCoordinate;
  readonly max: VoxelCoordinate;
  readonly size: VoxelCoordinate;
  readonly center: VoxelCoordinate;
}

export const DEFAULT_MAX_VOXELS = 800;

/** ボクセル座標を重複検査用の安定した文字列へ変換する。 */
function coordinateKey(cell: VoxelCoordinate): string {
  return `${cell.x},${cell.y},${cell.z}`;
}

/** ボクセル定義の座標、パレット、重複、セル数を検証する。 */
export function assertValidVoxelModel<PaletteId extends string>(
  cells: readonly VoxelCell<PaletteId>[],
  paletteIds: readonly PaletteId[],
  maxVoxels = DEFAULT_MAX_VOXELS,
): void {
  if (cells.length === 0) {
    throw new Error('Voxel model must contain at least one cell');
  }
  if (cells.length > maxVoxels) {
    throw new Error(`Voxel model exceeds limit: ${cells.length}/${maxVoxels}`);
  }

  const knownPaletteIds = new Set<string>(paletteIds);
  const occupiedCoordinates = new Set<string>();

  for (const cell of cells) {
    if (![cell.x, cell.y, cell.z].every((value) => Number.isFinite(value) && Number.isInteger(value))) {
      throw new Error('Voxel coordinates must be finite integers');
    }
    if (!knownPaletteIds.has(cell.paletteId)) {
      throw new Error(`Unknown voxel palette id: ${cell.paletteId}`);
    }

    const key = coordinateKey(cell);
    if (occupiedCoordinates.has(key)) {
      throw new Error(`Duplicate voxel coordinate: ${key}`);
    }
    occupiedCoordinates.add(key);
  }
}

/** 空でないボクセル集合の外接境界、サイズ、中心を返す。 */
export function calculateVoxelBounds<PaletteId extends string>(
  cells: readonly VoxelCell<PaletteId>[],
): VoxelBounds {
  if (cells.length === 0) {
    throw new Error('Cannot calculate bounds for an empty voxel model');
  }

  const xs = cells.map((cell) => cell.x);
  const ys = cells.map((cell) => cell.y);
  const zs = cells.map((cell) => cell.z);
  const min = { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) } as const;
  const max = { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) } as const;

  return {
    min,
    max,
    size: {
      x: max.x - min.x + 1,
      y: max.y - min.y + 1,
      z: max.z - min.z + 1,
    },
    center: {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    },
  };
}

/** ボクセルをパレット順で色別バッチへまとめ、未使用色は除外する。 */
export function groupVoxelsByPalette<PaletteId extends string>(
  cells: readonly VoxelCell<PaletteId>[],
  paletteIds: readonly PaletteId[],
): ReadonlyMap<PaletteId, readonly VoxelCell<PaletteId>[]> {
  const mutableGroups = new Map<PaletteId, VoxelCell<PaletteId>[]>(
    paletteIds.map((paletteId) => [paletteId, []]),
  );

  for (const cell of cells) {
    mutableGroups.get(cell.paletteId)?.push(cell);
  }

  return new Map(
    [...mutableGroups.entries()].filter(([, paletteCells]) => paletteCells.length > 0),
  );
}

/** モデルをX/Z中央かつ地面Y=0へ配置するワールドオフセットを返す。 */
export function calculateModelOffset(
  bounds: VoxelBounds,
  voxelSize: number,
): readonly [number, number, number] {
  return [
    -bounds.center.x * voxelSize,
    -bounds.min.y * voxelSize,
    -bounds.center.z * voxelSize,
  ];
}

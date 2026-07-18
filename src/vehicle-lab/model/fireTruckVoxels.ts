import type { VoxelCell } from './voxelModel';

export const FIRE_TRUCK_PALETTE = {
  red: { color: '#d92d24', roughness: 0.72 },
  white: { color: '#f3eee3', roughness: 0.78 },
  black: { color: '#171b22', roughness: 0.82 },
  silver: { color: '#aab1b9', roughness: 0.58 },
  blue: { color: '#1769ff', roughness: 0.42, emissive: '#0d47c7', emissiveIntensity: 0.35 },
  amber: { color: '#ffad19', roughness: 0.58, emissive: '#a95800', emissiveIntensity: 0.15 },
  darkGray: { color: '#4a515a', roughness: 0.7 },
} as const;

export type FireTruckPaletteId = keyof typeof FIRE_TRUCK_PALETTE;

export const FIRE_TRUCK_PALETTE_IDS = Object.keys(
  FIRE_TRUCK_PALETTE,
) as readonly FireTruckPaletteId[];

type MutableVoxelMap = Map<string, VoxelCell<FireTruckPaletteId>>;

/** 指定座標へボクセルを置き、既存セルがあれば色を上書きする。 */
function setVoxel(
  voxels: MutableVoxelMap,
  x: number,
  y: number,
  z: number,
  paletteId: FireTruckPaletteId,
): void {
  voxels.set(`${x},${y},${z}`, { x, y, z, paletteId });
}

/** 軸平行な直方体を同色ボクセルで埋める。 */
function fillBox(
  voxels: MutableVoxelMap,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  paletteId: FireTruckPaletteId,
): void {
  for (let x = min[0]; x <= max[0]; x += 1) {
    for (let y = min[1]; y <= max[1]; y += 1) {
      for (let z = min[2]; z <= max[2]; z += 1) {
        setVoxel(voxels, x, y, z, paletteId);
      }
    }
  }
}

/** 軸平行な直方体の外周だけを同色ボクセルで作る。 */
function shellBox(
  voxels: MutableVoxelMap,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  paletteId: FireTruckPaletteId,
): void {
  for (let x = min[0]; x <= max[0]; x += 1) {
    for (let y = min[1]; y <= max[1]; y += 1) {
      for (let z = min[2]; z <= max[2]; z += 1) {
        const onBoundary =
          x === min[0] || x === max[0]
          || y === min[1] || y === max[1]
          || z === min[2] || z === max[2];
        if (onBoundary) {
          setVoxel(voxels, x, y, z, paletteId);
        }
      }
    }
  }
}

/** 3×3の角を落とした純ボクセルタイヤを車体側面へ置く。 */
function addWheel(voxels: MutableVoxelMap, x: number, zCenter: number): void {
  const wheelPattern = [
    [-1, 0],
    [0, -1],
    [0, 0],
    [0, 1],
    [1, 0],
  ] as const;

  for (const [dy, dz] of wheelPattern) {
    setVoxel(voxels, x, 1 + dy, zCenter + dz, 'black');
  }
  setVoxel(voxels, x, 1, zCenter, 'darkGray');
}

/** 選定した純ボクセル案の消防車データを決定的に生成する。 */
function buildFireTruckVoxels(): readonly VoxelCell<FireTruckPaletteId>[] {
  const voxels: MutableVoxelMap = new Map();

  fillBox(voxels, [-5, 1, -6], [4, 1, 6], 'darkGray');
  shellBox(voxels, [-5, 2, -6], [4, 6, -2], 'red');
  shellBox(voxels, [-5, 2, -1], [4, 6, 6], 'red');

  fillBox(voxels, [-3, 4, -6], [2, 5, -6], 'black');
  fillBox(voxels, [-5, 4, -5], [-5, 5, -3], 'black');
  fillBox(voxels, [4, 4, -5], [4, 5, -3], 'black');

  fillBox(voxels, [-5, 3, -6], [-5, 3, 6], 'white');
  fillBox(voxels, [4, 3, -6], [4, 3, 6], 'white');
  fillBox(voxels, [-5, 3, 1], [-5, 5, 4], 'silver');
  fillBox(voxels, [4, 3, 1], [4, 5, 4], 'silver');

  fillBox(voxels, [-5, 1, -7], [4, 1, -7], 'white');
  fillBox(voxels, [-2, 2, -7], [1, 2, -7], 'darkGray');
  setVoxel(voxels, -4, 2, -7, 'amber');
  setVoxel(voxels, 3, 2, -7, 'amber');

  for (const x of [-6, 5]) {
    addWheel(voxels, x, -4);
    addWheel(voxels, x, 4);
  }

  for (let z = -1; z <= 6; z += 1) {
    setVoxel(voxels, -3, 7, z, 'silver');
    setVoxel(voxels, 3, 7, z, 'silver');
  }
  for (const z of [-1, 1, 3, 5]) {
    fillBox(voxels, [-3, 7, z], [3, 7, z], 'silver');
  }
  fillBox(voxels, [-2, 7, -5], [-2, 7, -5], 'blue');
  fillBox(voxels, [1, 7, -5], [1, 7, -5], 'blue');
  fillBox(voxels, [-3, 7, -5], [-3, 7, -5], 'blue');
  fillBox(voxels, [2, 7, -5], [2, 7, -5], 'blue');

  return [...voxels.values()].sort(
    (left, right) => left.y - right.y || left.z - right.z || left.x - right.x,
  );
}

export const FIRE_TRUCK_VOXELS = buildFireTruckVoxels();

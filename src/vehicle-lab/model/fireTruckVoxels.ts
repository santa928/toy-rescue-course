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

/** 5×5の角を落とした純ボクセルタイヤを車体側面へ置く。 */
function addWheel(voxels: MutableVoxelMap, x: number, zCenter: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dz = -2; dz <= 2; dz += 1) {
      if (Math.abs(dy) === 2 && Math.abs(dz) === 2) continue;
      setVoxel(voxels, x, 2 + dy, zCenter + dz, 'black');
    }
  }
  setVoxel(voxels, x, 2, zCenter, 'silver');
  setVoxel(voxels, x, 3, zCenter, 'silver'); // 回転が見える短いスポーク
}

/** 運転席・低い機器室・開いた梯子の輪郭で消防車を識別できる造形。 */
function buildFireTruckVoxels(): readonly VoxelCell<FireTruckPaletteId>[] {
  const voxels: MutableVoxelMap = new Map();
  fillBox(voxels, [-4, 1, -6], [3, 1, 6], 'darkGray');
  shellBox(voxels, [-4, 2, -6], [3, 6, -2], 'red');
  shellBox(voxels, [-5, 2, 0], [4, 4, 6], 'red');
  fillBox(voxels, [-3, 4, -6], [2, 5, -6], 'blue');
  fillBox(voxels, [-4, 4, -5], [-4, 5, -3], 'blue');
  fillBox(voxels, [3, 4, -5], [3, 5, -3], 'blue');
  for (const x of [-5, 4]) {
    fillBox(voxels, [x, 3, 0], [x, 3, 6], 'white');
    fillBox(voxels, [x, 2, 4], [x, 4, 5], 'silver');
    for (const [y, z] of [[2, 2], [3, 1], [4, 2], [3, 3]]) setVoxel(voxels, x, y, z, 'white');
  }
  fillBox(voxels, [-4, 1, -7], [3, 1, -7], 'white');
  fillBox(voxels, [-2, 2, -7], [1, 2, -7], 'silver');
  setVoxel(voxels, -4, 2, -7, 'amber');
  setVoxel(voxels, 3, 2, -7, 'amber');
  for (const x of [-6, 5]) for (const z of [-4, 4]) addWheel(voxels, x, z);
  for (const z of [0, 5]) fillBox(voxels, [-2, 5, z], [2, 6, z], 'darkGray');
  for (const x of [-2, 2]) fillBox(voxels, [x, 7, -1], [x, 7, 6], 'silver');
  for (const z of [-1, 2, 5]) fillBox(voxels, [-2, 7, z], [2, 7, z], 'silver');
  fillBox(voxels, [-3, 7, -5], [-2, 7, -5], 'blue');
  fillBox(voxels, [1, 7, -5], [2, 7, -5], 'blue');

  return [...voxels.values()].sort(
    (left, right) => left.y - right.y || left.z - right.z || left.x - right.x,
  );
}

export const FIRE_TRUCK_VOXELS = buildFireTruckVoxels();

import type { VoxelCell } from './voxelModel';

/** 玩具ショベルカーを構成する7色の共有material定義。 */
export const EXCAVATOR_PALETTE = {
  orange: { color: '#ed8b16', roughness: 0.72 },
  track: { color: '#171b22', roughness: 0.84 },
  window: { color: '#5caed1', roughness: 0.42 },
  arm: { color: '#f2b90f', roughness: 0.7 },
  bucket: { color: '#9ba5b1', roughness: 0.62 },
  beacon: { color: '#ff8a18', emissive: '#9b3500', emissiveIntensity: 0.22, roughness: 0.55 },
  darkGray: { color: '#505761', roughness: 0.76 },
} as const;

export type ExcavatorPaletteId = keyof typeof EXCAVATOR_PALETTE;

export const EXCAVATOR_PALETTE_IDS = Object.keys(
  EXCAVATOR_PALETTE,
) as readonly ExcavatorPaletteId[];

type MutableVoxelMap = Map<string, VoxelCell<ExcavatorPaletteId>>;

/** 指定model座標へvoxelを置き、同座標の既存色を決定的に上書きする。 */
function setVoxel(
  voxels: MutableVoxelMap,
  x: number,
  y: number,
  z: number,
  paletteId: ExcavatorPaletteId,
): void {
  voxels.set(`${x},${y},${z}`, { paletteId, x, y, z });
}

/** 閉区間の軸平行boxを同色voxelで埋める。 */
function fillBox(
  voxels: MutableVoxelMap,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  paletteId: ExcavatorPaletteId,
): void {
  for (let x = min[0]; x <= max[0]; x += 1) {
    for (let y = min[1]; y <= max[1]; y += 1) {
      for (let z = min[2]; z <= max[2]; z += 1) {
        setVoxel(voxels, x, y, z, paletteId);
      }
    }
  }
}

/** 閉区間の軸平行box外周だけを同色voxelで作る。 */
function shellBox(
  voxels: MutableVoxelMap,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  paletteId: ExcavatorPaletteId,
): void {
  for (let x = min[0]; x <= max[0]; x += 1) {
    for (let y = min[1]; y <= max[1]; y += 1) {
      for (let z = min[2]; z <= max[2]; z += 1) {
        if (
          x === min[0] || x === max[0]
          || y === min[1] || y === max[1]
          || z === min[2] || z === max[2]
        ) {
          setVoxel(voxels, x, y, z, paletteId);
        }
      }
    }
  }
}

/** 長い段付きarm、幅広bucket、左右履帯を持つ純voxelショベルカーを生成する。 */
function buildExcavatorVoxels(): readonly VoxelCell<ExcavatorPaletteId>[] {
  const voxels: MutableVoxelMap = new Map();

  fillBox(voxels, [-5, 0, -4], [-4, 2, 5], 'track');
  fillBox(voxels, [5, 0, -4], [6, 2, 5], 'track');
  for (const x of [-5, 6]) {
    for (const z of [-3, 0, 3]) setVoxel(voxels, x, 1, z, 'darkGray');
  }

  fillBox(voxels, [-3, 2, -4], [4, 3, 4], 'orange');
  fillBox(voxels, [-3, 4, -1], [1, 4, 5], 'orange');
  shellBox(voxels, [-3, 4, 0], [1, 7, 5], 'orange');
  fillBox(voxels, [-2, 5, 0], [0, 6, 0], 'window');
  fillBox(voxels, [-3, 5, 1], [-3, 6, 4], 'window');
  fillBox(voxels, [1, 5, 1], [1, 6, 4], 'window');
  fillBox(voxels, [-2, 5, 5], [0, 6, 5], 'window');
  setVoxel(voxels, -1, 7, 3, 'beacon');
  setVoxel(voxels, 0, 7, 3, 'beacon');

  fillBox(voxels, [0, 4, -4], [1, 5, -1], 'arm');
  fillBox(voxels, [0, 6, -6], [1, 6, -4], 'arm');
  fillBox(voxels, [0, 4, -8], [1, 5, -6], 'arm');
  fillBox(voxels, [-1, 3, -8], [2, 4, -8], 'arm');
  fillBox(voxels, [-2, 1, -9], [3, 2, -9], 'bucket');
  fillBox(voxels, [-2, 1, -8], [3, 1, -8], 'bucket');
  setVoxel(voxels, -2, 0, -9, 'bucket');
  setVoxel(voxels, 3, 0, -9, 'bucket');

  return [...voxels.values()].sort(
    (left, right) => left.y - right.y || left.z - right.z || left.x - right.x,
  );
}

export const EXCAVATOR_VOXELS = buildExcavatorVoxels();

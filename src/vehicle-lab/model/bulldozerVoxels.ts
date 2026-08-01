import type { VoxelCell } from './voxelModel';

/** 玩具ブルドーザーを構成する7色の共有material定義。 */
export const BULLDOZER_PALETTE = {
  yellow: { color: '#f2b90f', roughness: 0.72 },
  track: { color: '#171b22', roughness: 0.84 },
  blade: { color: '#aeb7c2', roughness: 0.6 },
  window: { color: '#5caed1', roughness: 0.42 },
  beacon: { color: '#ff8a18', emissive: '#9b3500', emissiveIntensity: 0.22, roughness: 0.55 },
  darkGray: { color: '#505761', roughness: 0.76 },
  silver: { color: '#d0d5da', roughness: 0.58 },
} as const;

export type BulldozerPaletteId = keyof typeof BULLDOZER_PALETTE;

export const BULLDOZER_PALETTE_IDS = Object.keys(
  BULLDOZER_PALETTE,
) as readonly BulldozerPaletteId[];

type MutableVoxelMap = Map<string, VoxelCell<BulldozerPaletteId>>;

/** 指定model座標へvoxelを置き、同座標の既存色を決定的に上書きする。 */
function setVoxel(
  voxels: MutableVoxelMap,
  x: number,
  y: number,
  z: number,
  paletteId: BulldozerPaletteId,
): void {
  voxels.set(`${x},${y},${z}`, { paletteId, x, y, z });
}

/** 閉区間の軸平行boxを同色voxelで埋める。 */
function fillBox(
  voxels: MutableVoxelMap,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  paletteId: BulldozerPaletteId,
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
  paletteId: BulldozerPaletteId,
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

/** 幅広blade、左右履帯、運転席を持つ純voxelブルドーザーを生成する。 */
function buildBulldozerVoxels(): readonly VoxelCell<BulldozerPaletteId>[] {
  const voxels: MutableVoxelMap = new Map();

  fillBox(voxels, [-5, 0, -3], [-4, 2, 5], 'track');
  fillBox(voxels, [5, 0, -3], [6, 2, 5], 'track');
  for (const x of [-5, 6]) {
    for (const z of [-2, 1, 4]) setVoxel(voxels, x, 1, z, 'darkGray');
  }

  fillBox(voxels, [-3, 2, -4], [4, 3, 5], 'yellow');
  fillBox(voxels, [-3, 4, -4], [4, 5, -1], 'yellow');
  shellBox(voxels, [-3, 4, 0], [4, 7, 4], 'yellow');
  fillBox(voxels, [-2, 5, 0], [3, 6, 0], 'window');
  fillBox(voxels, [-3, 5, 1], [-3, 6, 3], 'window');
  fillBox(voxels, [4, 5, 1], [4, 6, 3], 'window');
  fillBox(voxels, [-1, 5, 4], [2, 6, 4], 'window');
  fillBox(voxels, [0, 7, 1], [1, 7, 2], 'beacon');
  fillBox(voxels, [3, 6, -1], [3, 7, -1], 'darkGray');

  fillBox(voxels, [-6, 0, -7], [7, 2, -7], 'blade');
  fillBox(voxels, [-5, 0, -6], [6, 1, -6], 'blade');
  fillBox(voxels, [-4, 1, -5], [-4, 3, -4], 'silver');
  fillBox(voxels, [5, 1, -5], [5, 3, -4], 'silver');

  return [...voxels.values()].sort(
    (left, right) => left.y - right.y || left.z - right.z || left.x - right.x,
  );
}

export const BULLDOZER_VOXELS = buildBulldozerVoxels();

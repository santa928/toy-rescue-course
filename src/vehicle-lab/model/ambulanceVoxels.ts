import type { VoxelCell } from './voxelModel';

/** 玩具救急車を構成する7色の共有material定義。 */
export const AMBULANCE_PALETTE = {
  white: { color: '#f5f1e8', roughness: 0.76 },
  red: { color: '#d92d24', roughness: 0.7 },
  cross: { color: '#e53935', emissive: '#8e1714', emissiveIntensity: 0.16, roughness: 0.62 },
  window: { color: '#57b7c7', roughness: 0.4 },
  wheel: { color: '#171b22', roughness: 0.84 },
  darkGray: { color: '#505761', roughness: 0.76 },
  beacon: { color: '#f04438', emissive: '#9e1813', emissiveIntensity: 0.28, roughness: 0.5 },
} as const;

export type AmbulancePaletteId = keyof typeof AMBULANCE_PALETTE;

export const AMBULANCE_PALETTE_IDS = Object.keys(
  AMBULANCE_PALETTE,
) as readonly AmbulancePaletteId[];

type MutableVoxelMap = Map<string, VoxelCell<AmbulancePaletteId>>;

/** 指定model座標へvoxelを置き、同座標の既存色を決定的に上書きする。 */
function setVoxel(
  voxels: MutableVoxelMap,
  x: number,
  y: number,
  z: number,
  paletteId: AmbulancePaletteId,
): void {
  voxels.set(`${x},${y},${z}`, { paletteId, x, y, z });
}

/** 閉区間の軸平行boxを同色voxelで埋める。 */
function fillBox(
  voxels: MutableVoxelMap,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  paletteId: AmbulancePaletteId,
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
  paletteId: AmbulancePaletteId,
): void {
  for (let x = min[0]; x <= max[0]; x += 1) {
    for (let y = min[1]; y <= max[1]; y += 1) {
      for (let z = min[2]; z <= max[2]; z += 1) {
        if (
          x === min[0] || x === max[0]
          || y === min[1] || y === max[1]
          || z === min[2] || z === max[2]
        ) setVoxel(voxels, x, y, z, paletteId);
      }
    }
  }
}

/** 角を落とした5 voxel車輪を車体側面へ置く。 */
function addWheel(voxels: MutableVoxelMap, x: number, zCenter: number): void {
  for (const [dy, dz] of [[-1, 0], [0, -1], [0, 0], [0, 1], [1, 0]] as const) {
    setVoxel(voxels, x, 1 + dy, zCenter + dz, 'wheel');
  }
  setVoxel(voxels, x, 1, zCenter, 'darkGray');
}

/** 白い箱形、赤帯、両側赤十字、青緑窓、赤色灯を持つ純voxel救急車を生成する。 */
function buildAmbulanceVoxels(): readonly VoxelCell<AmbulancePaletteId>[] {
  const voxels: MutableVoxelMap = new Map();

  fillBox(voxels, [-4, 1, -6], [4, 1, 6], 'darkGray');
  shellBox(voxels, [-4, 2, -5], [4, 6, 5], 'white');
  for (const x of [-5, 5]) {
    addWheel(voxels, x, -4);
    addWheel(voxels, x, 4);
  }

  fillBox(voxels, [-3, 4, -5], [3, 5, -5], 'window');
  fillBox(voxels, [-4, 4, -4], [-4, 5, -2], 'window');
  fillBox(voxels, [4, 4, -4], [4, 5, -2], 'window');

  fillBox(voxels, [-4, 3, -5], [-4, 3, 5], 'red');
  fillBox(voxels, [4, 3, -5], [4, 3, 5], 'red');
  fillBox(voxels, [-3, 3, 5], [3, 3, 5], 'red');

  for (const x of [-4, 4]) {
    fillBox(voxels, [x, 4, 2], [x, 6, 2], 'cross');
    fillBox(voxels, [x, 5, 1], [x, 5, 3], 'cross');
  }
  fillBox(voxels, [-1, 4, 5], [1, 6, 5], 'cross');
  fillBox(voxels, [-2, 5, 5], [2, 5, 5], 'cross');

  fillBox(voxels, [-1, 7, 1], [1, 7, 1], 'beacon');
  setVoxel(voxels, -3, 2, -6, 'red');
  setVoxel(voxels, 3, 2, -6, 'red');

  return [...voxels.values()].sort(
    (left, right) => left.y - right.y || left.z - right.z || left.x - right.x,
  );
}

export const AMBULANCE_VOXELS = buildAmbulanceVoxels();

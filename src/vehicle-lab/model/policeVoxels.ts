import type { VoxelCell } from './voxelModel';

/** 玩具パトカーを構成する7色の共有material定義。 */
export const POLICE_PALETTE = {
  white: { color: '#f5f1e8', roughness: 0.76 },
  black: { color: '#222833', roughness: 0.8 },
  window: { color: '#57b7c7', roughness: 0.4 },
  wheel: { color: '#151922', roughness: 0.86 },
  darkGray: { color: '#535b66', roughness: 0.76 },
  redBeacon: { color: '#f04438', emissive: '#a51b16', emissiveIntensity: 0.34, roughness: 0.46 },
  blueBeacon: { color: '#2780ff', emissive: '#0d3b98', emissiveIntensity: 0.38, roughness: 0.44 },
} as const;

export type PolicePaletteId = keyof typeof POLICE_PALETTE;

export const POLICE_PALETTE_IDS = Object.keys(
  POLICE_PALETTE,
) as readonly PolicePaletteId[];

type MutableVoxelMap = Map<string, VoxelCell<PolicePaletteId>>;

/** 指定model座標へvoxelを置き、同座標の既存色を決定的に上書きする。 */
function setVoxel(
  voxels: MutableVoxelMap,
  x: number,
  y: number,
  z: number,
  paletteId: PolicePaletteId,
): void {
  voxels.set(`${x},${y},${z}`, { paletteId, x, y, z });
}

/** 閉区間の軸平行boxを同色voxelで埋める。 */
function fillBox(
  voxels: MutableVoxelMap,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  paletteId: PolicePaletteId,
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
  paletteId: PolicePaletteId,
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

/** 5×5の角を落としたタイヤと中心のハブを側面へ置く。 */
function addWheel(voxels: MutableVoxelMap, x: number, zCenter: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dz = -2; dz <= 2; dz += 1) {
      if (Math.abs(dy) === 2 && Math.abs(dz) === 2) continue;
      setVoxel(voxels, x, 2 + dy, zCenter + dz, 'wheel');
    }
  }
  setVoxel(voxels, x, 2, zCenter, 'darkGray');
}

/** 肩まで高さのある白黒車体、二段の窓、屋根の赤青灯を持つ玩具パトカーを作る。 */
function buildPoliceVoxels(): readonly VoxelCell<PolicePaletteId>[] {
  const voxels: MutableVoxelMap = new Map();

  fillBox(voxels, [-4, 1, -6], [4, 1, 6], 'darkGray');
  shellBox(voxels, [-4, 2, -5], [4, 4, 5], 'white');
  shellBox(voxels, [-3, 5, -2], [3, 7, 2], 'white');
  for (const x of [-5, 5]) {
    addWheel(voxels, x, -4);
    addWheel(voxels, x, 4);
  }

  fillBox(voxels, [-2, 5, -2], [2, 6, -2], 'window');
  fillBox(voxels, [-3, 5, -1], [-3, 6, 1], 'window');
  fillBox(voxels, [3, 5, -1], [3, 6, 1], 'window');

  fillBox(voxels, [-2, 5, 2], [2, 6, 2], 'window');
  fillBox(voxels, [-3, 2, -6], [3, 2, -6], 'white');

  fillBox(voxels, [-4, 3, -5], [-4, 3, 5], 'black');
  fillBox(voxels, [4, 3, -5], [4, 3, 5], 'black');
  fillBox(voxels, [-3, 3, 5], [3, 3, 5], 'black');
  fillBox(voxels, [-1, 2, -6], [1, 2, -6], 'white');
  setVoxel(voxels, -3, 2, 6, 'redBeacon');
  setVoxel(voxels, 3, 2, 6, 'redBeacon');

  fillBox(voxels, [-2, 8, 0], [-1, 8, 0], 'redBeacon');
  fillBox(voxels, [1, 8, 0], [2, 8, 0], 'blueBeacon');
  setVoxel(voxels, 0, 8, 0, 'darkGray');

  return [...voxels.values()].sort(
    (left, right) => left.y - right.y || left.z - right.z || left.x - right.x,
  );
}

export const POLICE_VOXELS = buildPoliceVoxels();

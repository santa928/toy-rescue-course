import { VOXEL_SIZE } from '../../voxelGrid';
import { voxelPartsAt } from './propVoxels';
import type { WorldBoxDefinition, WorldPoint } from './productionWorldMap';

const WOOD = '#86552f';
const LIGHT_WOOD = '#a86f3f';
const CREAM = '#f1efe6';
const RED = '#e24b3f';
const BLUE = '#3b82f6';

/** 小さな部品も街の共有instance batchへ渡す。 */
function part(id: string, color: string, position: WorldPoint, scale: WorldPoint,
  solid = false, rotation?: WorldPoint): WorldBoxDefinition {
  return { id, color, position, scale, solid, ...(rotation ? { rotation } : {}) };
}

/** 角を一段ずつ落とした樹冠。公園はりんご、街路には淡い花をつける。 */
export function createTreeCrown(id: string, x: number, z: number, kind: 'apple' | 'blossom'): WorldBoxDefinition[] {
  const leaf = voxelPartsAt(id, [x - VOXEL_SIZE / 2, 2.16, z - VOXEL_SIZE / 2]);
  const apple = kind === 'apple';
  const shade = apple ? '#579759' : '#d98988';
  const middle = apple ? '#7ab362' : '#efa2a0';
  const light = apple ? '#a0c972' : '#f8bcb0';
  const fruit = apple ? '#ec6249' : '#ffe4c4';
  const pieces = [
    leaf('', shade, [-2, 0, -2], [5, 1, 5]),
    // 段ごとに幅の異なる帯を合わせ、葉の四隅に丸みをつける。
    leaf('lower', shade, [-4, 1, -2], [9, 2, 5]),
    leaf('middle', middle, [-5, 3, -2], [11, 3, 5]),
    leaf('upper', middle, [-4, 6, -2], [9, 1, 5]),
    leaf('cap', light, [-2, 7, -2], [5, 1, 5]),
    leaf('new-growth', light, [-1, 8, -1], [3, 1, 3]),
  ];
  for (const side of [-1, 1]) {
    pieces.push(
      leaf(`lower-${side}`, shade, [-2, 1, side < 0 ? -4 : 3], [5, 2, 2]),
      leaf(`middle-${side}`, middle, [-3, 3, side < 0 ? -4 : 3], [7, 3, 2]),
      leaf(`edge-${side}`, middle, [-2, 3, side < 0 ? -5 : 5], [5, 3, 1]),
      leaf(`upper-${side}`, middle, [-2, 6, side < 0 ? -4 : 3], [5, 1, 2]),
    );
  }
  return [...pieces,
    leaf('fruit-front', fruit, [-2, 3, 6], [2, 2, 1]),
    leaf('fruit-right', fruit, [6, 4, 0], [1, 2, 2]),
    leaf('fruit-back', fruit, [1, 4, -6], [2, 2, 1]),
  ];
}

/** 屋外用の一体型ベンチ・板張り天板と、低い市松敷物・開いたかごを作る。 */
export function createParkPicnicCorner(): readonly WorldBoxDefinition[] {
  const x = -5.2;
  const z = -17.2;
  return [
    part('park-picnic-table', WOOD, [x, 1.05, z], [1.2, 0.2, 2.8], true),
    ...[-0.45, -0.15, 0.15, 0.45].map((dx, i) => part(`park-table-board-${i}`,
      i % 2 ? LIGHT_WOOD : '#86552f', [x + dx, 1.18, z], [0.27, 0.06, 2.8])),
    ...[-1, 1].flatMap(side => [
      part(`park-picnic-bench-${side}`, LIGHT_WOOD, [x + side * 0.85, 0.6, z], [0.4, 0.18, 2.8], true),
      ...[-0.92, 0.92].map(dz => part(`park-table-leg-${side}-${dz}`, WOOD,
        [x + side * 0.52, 0.59, z + dz], [0.22, 1.05, 0.25], false, [0, 0, side * 0.35])),
    ]),
    ...[-0.92, 0.92].map(dz => part(`park-table-crossbar-${dz}`, WOOD,
      [x, 0.45, z + dz], [2.1, 0.18, 0.24])),
    part('park-table-plate', CREAM, [x, 1.25, z - 0.5], [0.48, 0.06, 0.48]),
    part('park-table-apple', RED, [x, 1.42, z - 0.5], [0.24, 0.24, 0.24]),
    part('park-picnic-blanket', CREAM, [5.8, 0.1, -17.1], [2.4, 0.04, 1.8]),
    ...Array.from({ length: 24 }, (_, i) => {
      const column = i % 6;
      const row = Math.floor(i / 6);
      const color = [CREAM, '#efa2a0', RED][column % 2 + row % 2];
      return part(`park-blanket-check-${i}`, color,
        [4.8 + column * 0.4, 0.13, -17.775 + row * 0.45], [0.395, 0.02, 0.445]);
    }),
    part('park-picnic-basket', '#6f4327', [6.4, 0.22, -17.35], [0.9, 0.15, 0.75]),
    ...[-1, 1].flatMap(side => [
      part(`park-basket-end-${side}`, LIGHT_WOOD, [6.4 + side * 0.42, 0.45, -17.35], [0.12, 0.45, 0.75]),
      part(`park-basket-side-${side}`, LIGHT_WOOD, [6.4, 0.45, -17.35 + side * 0.34], [0.9, 0.45, 0.12]),
      part(`park-basket-handle-post-${side}`, WOOD, [6.4 + side * 0.36, 0.88, -17.35], [0.12, 0.5, 0.12]),
    ]),
    part('park-basket-handle-top', WOOD, [6.4, 1.13, -17.35], [0.84, 0.12, 0.12]),
    ...[-0.25, 0, 0.25].map(dx => part(`park-basket-weave-${dx}`, WOOD,
      [6.4 + dx, 0.45, -16.945], [0.06, 0.4, 0.035])),
    part('park-picnic-bottle', CREAM, [5.1, 0.38, -17.2], [0.24, 0.5, 0.24]),
    part('park-picnic-bottle-lid', BLUE, [5.1, 0.66, -17.2], [0.18, 0.1, 0.18]),
    part('park-picnic-apple', RED, [5.2, 0.25, -16.65], [0.25, 0.24, 0.25]),
  ];
}

/** 傾いた板と同じ局所座標で座席・U字握りを接続し、中央の支点を見せる。 */
export function createSeesawDetails(beam: WorldBoxDefinition): readonly WorldBoxDefinition[] {
  const [x, y, z] = beam.position;
  const angle = beam.rotation?.[0] ?? 0;
  const onBeam = (id: string, color: string, offset: WorldPoint, scale: WorldPoint): WorldBoxDefinition => {
    const [dx, dy, dz] = offset;
    return part(id, color, [x + dx, y + dy * Math.cos(angle) - dz * Math.sin(angle),
      z + dy * Math.sin(angle) + dz * Math.cos(angle)], scale, false, beam.rotation);
  };
  return [
    ...[-1, 1].flatMap(side => [
      onBeam(`playground-seat-${side}`, BLUE, [0, 0.2, side * 0.85], [0.95, 0.16, 0.6]),
      ...[-0.27, 0.27].map(dx => onBeam(`playground-handle-post-${side}-${dx}`, '#f2c94c',
        [dx, 0.48, side * 0.45], [0.13, 0.65, 0.13])),
      onBeam(`playground-handle-grip-${side}`, '#f2c94c', [0, 0.8, side * 0.45], [0.67, 0.14, 0.14]),
      ...[0, 1, 2, 3].map(level => part(`playground-pivot-${side}-${level}`, WOOD,
        [x + side * 0.42, 0.2 + level * 0.23, z], [0.18, 0.23, 1.05 - level * 0.23])),
      part(`playground-axle-${side}`, CREAM, [x + side * 0.56, y, z], [0.17, 0.24, 0.24]),
    ]),
    ...Array.from({ length: 7 }, (_, i) => onBeam(`playground-board-joint-${i}`, '#c83e34',
      [0, 0.145, -0.9 + i * 0.3], [0.7, 0.02, 0.035])),
  ];
}

/** 段差のある石縁と葦、くちばしのついた小さなあひるを水面に並べる。 */
export function createPondDetails(pond: WorldBoxDefinition): readonly WorldBoxDefinition[] {
  const [x, y, z] = pond.position;
  const rim = voxelPartsAt(pond.id, [x, y + pond.scale[1] / 2, z]);
  const stone = '#aaa997';
  const reed = '#669255';
  return [
    ...[-1, 1].flatMap(side => [
      rim(`rim-x-${side}`, stone, [side < 0 ? -6 : 5, 0, -3], [1, 1, 6]),
      rim(`rim-z-${side}`, stone, [-4, 0, side < 0 ? -5 : 4], [8, 1, 1]),
      ...[-1, 1].map(end => rim(`corner-${side}-${end}`, '#bcb9a2',
        [side < 0 ? -5 : 4, 0, end < 0 ? -4 : 3], [1, 1, 1])),
    ]),
    rim('reed-left', reed, [-4, 0, -3], [1, 3, 1]),
    rim('reed-right', reed, [-2, 0, -3], [1, 2, 1]),
    rim('reed-tip', WOOD, [-4, 3, -3], [1, 1, 1]),
    rim('duck-body', '#ffd46c', [-3, 0, -1], [5, 1, 3]),
    rim('duck-back', '#ffd46c', [-3, 1, -1], [5, 1, 2]),
    rim('duck-tail', '#ffe294', [-4, 1, -1], [1, 1, 2]),
    rim('duck-cheek', '#ffe294', [0, 2, -1], [3, 1, 2]),
    rim('duck-nape', '#ffe294', [0, 3, -1], [1, 1, 2]),
    rim('duck-eyes', '#654c39', [1, 3, -1], [1, 1, 2]),
    rim('duck-face', '#ffe294', [2, 3, -1], [1, 1, 2]),
    rim('duck-crown', '#ffe294', [0, 4, -1], [3, 1, 2]),
    rim('duck-bill', '#ec8d49', [3, 2, -1], [1, 1, 2]),
  ];
}

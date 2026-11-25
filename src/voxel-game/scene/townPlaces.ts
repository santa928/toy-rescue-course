import { VOXEL_SIZE } from '../../voxelGrid';
import { voxelPartsAt } from './propVoxels';
import { createParkPicnicCorner } from './parkScenery';
import type { WorldBoxDefinition, WorldDecorationClusterDefinition, WorldPoint } from './productionWorldMap';

const WOOD = '#86552f';
const CREAM = '#f1efe6';
const RED = '#e24b3f';
const GOLD = '#f2c94c';

/** 街角の部品を描画と衝突へ同じ座標で渡す。 */
function box(id: string, color: string, position: WorldPoint, scale: WorldPoint,
  solid = false): WorldBoxDefinition {
  return { id, color, position, scale, solid };
}

/** 薄い座面・背板・地面まで届く脚で、一目で座れる家具に見せる。 */
function bench(id: string, x: number, z: number): readonly WorldBoxDefinition[] {
  return [
    box(`${id}-seat`, WOOD, [x, 0.75, z], [2.6, 0.22, 0.8], true),
    box(`${id}-back`, WOOD, [x, 1.25, z + 0.35], [2.6, 0.65, 0.18]),
    ...[-0.95, 0.95].map(dx => box(`${id}-leg-${dx}`, CREAM,
      [x + dx, 0.39, z], [0.24, 0.62, 0.65])),
  ];
}

/** 花は鉢・茎・花びらで表現し、単色の積み木との混同を避ける。 */
function flowers(id: string, x: number, z: number): readonly WorldBoxDefinition[] {
  const bloom = voxelPartsAt(id, [x - VOXEL_SIZE / 2, 0.06, z - VOXEL_SIZE / 2]);
  return [
    bloom('pot', WOOD, [-3, 0, -1], [7, 1, 3]),
    bloom('rim', '#a86f3f', [-3, 1, -1], [7, 1, 3]),
    ...[-2, 2].flatMap((stem, i) => {
      const petals = i === 0 ? RED : GOLD;
      return [
        bloom(`stem-${i}`, '#579759', [stem, 2, 0], [1, 2, 1]),
        bloom(`leaf-${i}`, '#7ab362', [stem + (i === 0 ? 1 : -1), 3, 0], [1, 1, 1]),
        bloom(`petals-top-${i}`, petals, [stem, 6, 0], [1, 1, 1]),
        bloom(`petals-bottom-${i}`, petals, [stem, 4, 0], [1, 1, 1]),
        bloom(`petals-left-${i}`, petals, [stem - 1, 5, 0], [1, 1, 1]),
        bloom(`petals-right-${i}`, petals, [stem + 1, 5, 0], [1, 1, 1]),
        bloom(`center-${i}`, CREAM, [stem, 5, 0], [1, 1, 2]),
      ];
    }),
  ];
}

/** 両側の送水口と上部の角ナットが読める赤い消火栓。 */
function hydrant(): readonly WorldBoxDefinition[] {
  const fixture = voxelPartsAt('fire-hydrant', [16 - VOXEL_SIZE / 2, 0.06, -12 - VOXEL_SIZE / 2]);
  return [
    fixture('body', RED, [-1, 1, -1], [3, 4, 3], true),
    fixture('foot', '#c83e34', [-2, 0, -2], [5, 1, 5]),
    fixture('cap', RED, [-2, 5, -1], [5, 1, 3]),
    fixture('cap-top', RED, [-1, 6, -1], [3, 1, 3]),
    fixture('nut', GOLD, [0, 7, 0], [1, 1, 1]),
    fixture('outlet', CREAM, [0, 2, 2], [1, 2, 1]),
    ...[-1, 1].flatMap(side => [
      fixture(`collar-${side}`, RED, [side < 0 ? -2 : 2, 2, -1], [1, 2, 3]),
      fixture(`valve-${side}`, GOLD, [side < 0 ? -3 : 3, 2, 0], [1, 2, 1]),
    ]),
  ];
}

/** 遊び場へ装飾を散らさず、公園・家・工事場の用途が読めるまとまりだけを置く。 */
export function createTownPlaces(): readonly WorldDecorationClusterDefinition[] {
  return [
    {
      id: 'hub-entry-guides', districtId: 'hub', purpose: 'entry',
      boxes: [
        box('hub-entry-guide-red', GOLD, [-4.6, 0.075, 4.8], [1.4, 0.01, 0.15]),
        box('hub-entry-guide-white', GOLD, [-4.6, 0.075, 7.2], [1.4, 0.01, 0.15]),
      ],
    },
    {
      id: 'park-picnic-corner', districtId: 'park', purpose: 'rest',
      boxes: createParkPicnicCorner(),
    },
    {
      id: 'fire-entry-hydrant', districtId: 'fire', purpose: 'service',
      boxes: hydrant(),
    },
    {
      id: 'fire-flower-garden', districtId: 'fire', purpose: 'landmark',
      boxes: flowers('fire-planter', 25.5, -8),
    },
    {
      id: 'construction-material-bay', districtId: 'construction', purpose: 'service',
      boxes: [
        box('construction-material-stack', WOOD, [-32, 0.65, -38], [3, 1.1, 2], true),
        ...[-0.9, 0.9].map(dx => box(`construction-material-band-${dx}`, GOLD,
          [-32 + dx, 1.23, -38], [0.18, 0.06, 2])),
        ...[-0.3, 0.3].map(dy => box(`construction-material-joint-${dy}`, '#6f4327',
          [-32, 0.65 + dy, -36.98], [3, 0.06, 0.04])),
      ],
    },
    {
      id: 'town-neighbor-bench', districtId: 'town', purpose: 'rest',
      boxes: bench('town-bench', 37, 31),
    },
    {
      id: 'town-front-gardens', districtId: 'town', purpose: 'landmark',
      boxes: [
        ...flowers('town-west-flowers', 26.8, 28),
        ...flowers('town-east-flowers', 38.8, 28),
        box('town-west-door-path', CREAM, [25, 0.075, 29], [1.4, 0.01, 3]),
        box('town-east-door-path', CREAM, [37, 0.075, 29], [1.4, 0.01, 3]),
        box('town-north-door-path', CREAM, [31, 0.075, 33], [1.4, 0.01, 3]),
      ],
    },
  ];
}

import { createPondDetails, createSeesawDetails } from './parkScenery';
import { VOXEL_SIZE as CELL } from '../../voxelGrid';
import type { WorldBoxDefinition, WorldPoint } from './productionWorldMap';

const CREAM = '#f1efe6';
const RED = '#c83e34';
const WOOD = '#86552f';
const GOLD = '#f2c94c';

/** 造形と衝突が同じ寸法を使う、街の固定部品を作る。 */
function box(id: string, color: string, position: readonly [number, number, number],
  scale: readonly [number, number, number], solid = false): WorldBoxDefinition {
  return { id, color, position, scale, solid };
}

/** 固定カメラへ先端を向けたハートの象嵌。水平面の奥行きには縦2粒を使う。 */
function depotHeart(): WorldBoxDefinition[] {
  const rows = [
    '..##.....##..',
    '.####...####.',
    '######.######',
    '#############',
    '#############',
    '.###########.',
    '..#########..',
    '...#######...',
    '....#####....',
    '.....###.....',
    '......#......',
  ];
  const angle = Math.PI / 5;
  return rows.flatMap((row, rowIndex) => [...row.matchAll(/#+/g)].map(({ 0: run, index }) => {
    const dx = (index + run.length / 2 - row.length / 2) * CELL;
    const dz = (rowIndex - (rows.length - 1) / 2) * 2 * CELL;
    const position: WorldPoint = [
      -9 + dx * Math.cos(angle) + dz * Math.sin(angle),
      4.8 + CELL / 2,
      6 - dx * Math.sin(angle) + dz * Math.cos(angle),
    ];
    return { ...box(`garage-heart-${rowIndex}-${index}`, CREAM, position, [run.length * CELL, CELL, 2 * CELL]),
      rotation: [0, angle, 0] as const };
  }));
}

/** 前庭の西側に東向き開口を持つ車庫。帰庫点と敷地を連続させる。 */
export function createRescueDepot(): readonly WorldBoxDefinition[] {
  const shell = [
    box('garage-back-wall', CREAM, [-6, 1.8, -9.2], [6.8, 3.6, 0.6], true),
    box('garage-left-wall', CREAM, [-9.1, 1.8, -6.5], [0.6, 3.6, 5.4], true),
    box('garage-right-wall', CREAM, [-2.9, 1.8, -6.5], [0.6, 3.6, 5.4], true),
    box('garage-header', RED, [-6, 3.3, -3.8], [6.8, 0.6, 0.6]),
    box('garage-roof-eaves', '#ad3a37', [-6, 3.8, -6.5], [7.6, 0.4, 6.4]),
    box('garage-roof-middle', RED, [-6, 4.2, -6.5], [7.2, 0.4, 4.6]),
    box('garage-roof-ridge', '#df554b', [-6, 4.6, -6.5], [6.8, 0.4, 4.2]),
    box('garage-left-foot', GOLD, [-9.1, 0.4, -3.8], [0.64, 0.8, 0.65]),
    box('garage-right-foot', GOLD, [-2.9, 0.4, -3.8], [0.64, 0.8, 0.65]),
    box('garage-bay-floor', '#68717a', [-6, 0.07, -6.4], [5.6, 0.02, 5.4]),
    box('garage-forecourt', CREAM, [-2, 0.05, 6], [13, 0.04, 8]),
    box('garage-parking-left', GOLD, [-2.1, 0.075, 6], [0.16, 0.01, 4.8]),
    box('garage-parking-right', GOLD, [2.1, 0.075, 6], [0.16, 0.01, 4.8]),
    box('garage-parking-back', GOLD, [0, 0.075, 8.4], [4.36, 0.01, 0.16]),
    box('garage-bay-mark-left', GOLD, [-8.35, 0.18, -5.7], [0.15, 0.04, 3.7]),
    box('garage-bay-mark-right', GOLD, [-3.65, 0.18, -5.7], [0.15, 0.04, 3.7]),
    box('garage-interior-back-panel', '#56616b', [-6, 1.7, -8.85], [5.6, 3, 0.08]),
    box('garage-interior-side-panel', '#68717a', [-3.25, 1.7, -6.5], [0.08, 3, 5.1]),
    box('garage-sign-backing', RED, [-2.5, 2.1, -5.2], [0.22, 1.25, 1.3]),
    box('garage-sign-truck-body', CREAM, [-2.36, 2.12, -5.2], [0.1, 0.4, 0.85]),
    box('garage-sign-truck-cab', CREAM, [-2.36, 2.42, -4.95], [0.1, 0.2, 0.35]),
    box('garage-sign-wheel-a', WOOD, [-2.3, 1.86, -5.45], [0.12, 0.18, 0.18]),
    box('garage-sign-wheel-b', WOOD, [-2.3, 1.86, -4.95], [0.12, 0.18, 0.18]),
  ].map(part => {
    if (part.id === 'garage-forecourt' || part.id.startsWith('garage-parking-')) return part;
    // 開口は交差点北端から離し、車高を保った小型の救援車庫へ揃える。
    return { ...part,
      position: [-9 + (part.position[2] + 6.5) * (6.2 / 5.4), part.position[1], 6 - (part.position[0] + 6)] as const,
      scale: [part.scale[2] * (6.2 / 5.4), part.scale[1], part.scale[0]] as const,
    };
  });

  // 窓と照明は車庫の外面へ、完成後のワールド座標で取り付ける。
  const windows = [-1, 1].flatMap(side => {
    const x = -9 + side * 5 * CELL;
    return [
      box(`garage-window-frame-${side}`, WOOD, [x, 2.16, 9.4], [8 * CELL, 6 * CELL, CELL]),
      box(`garage-window-pane-${side}`, '#7ecdd2', [x, 2.16, 9.4 + CELL / 2], [6 * CELL, 4 * CELL, CELL]),
      box(`garage-window-divider-${side}`, CREAM, [x, 2.16, 9.4 + CELL], [CELL, 4 * CELL, CELL]),
    ];
  });
  const lamps = [-1, 1].flatMap(side => {
    const z = 6 + side * 3.1;
    return [
      box(`garage-lamp-mount-${side}`, WOOD, [-5.9 + CELL / 2, 2.4, z], [CELL, 3 * CELL, 3 * CELL]),
      box(`garage-lamp-lens-${side}`, '#ffdc82', [-5.9 + 1.5 * CELL, 2.4, z], [CELL, 2 * CELL, 2 * CELL]),
    ];
  });
  return [...shell, ...depotHeart(), ...windows, ...lamps];
}

/** 建物の寸法を変えずに、窓・入口・段屋根・道具の意味を共有paletteで付ける。 */
export function addTownDetails(boxes: readonly WorldBoxDefinition[]): readonly WorldBoxDefinition[] {
  const details: WorldBoxDefinition[] = [];
  for (const source of boxes) {
    const [x, y, z] = source.position;
    const [w, h, d] = source.scale;
    if (source.id === 'fire-building-body' || source.id === 'construction-office-body'
      || (source.id.startsWith('town-house-') && source.id.endsWith('-body'))) {
      const side = source.id === 'town-house-white-body' ? -1 : 1;
      const bottom = y - h / 2;
      const front = z + side * d / 2;
      const facade = (name: string, color: string, [dx, dy, depth]: WorldPoint, [width, height, thickness]: WorldPoint) =>
        box(`${source.id}-${name}`, color, [x + dx * CELL, bottom + dy * CELL, front + side * depth * CELL],
          [width * CELL, height * CELL, thickness * CELL]);

      details.push(facade('door', WOOD, [0, 4, 0], [5, 8, 1]));
      details.push(facade('door-handle', GOLD, [1, 4, 1], [1, 1, 1]));
      for (const column of [-8, 8]) {
        const suffix = column < 0 ? 'left' : 'right';
        details.push(facade(`window-frame-${suffix}`, CREAM, [column, 6.5, 0], [7, 6, 1]));
        details.push(facade(`window-glass-${suffix}`, '#80c7d1', [column, 6.5, 0.5], [5, 4, 1]));
        details.push(facade(`window-mullion-${suffix}`, CREAM, [column, 6.5, 1], [1, 4, 1]));
      }

      if (source.id.startsWith('town-house-')) {
        // カメラに面する妻側にも、額縁と出窓の棚を付ける。
        const sideWall = x + w / 2;
        details.push(box(`${source.id}-side-window-frame`, WOOD, [sideWall, bottom + 6.5 * CELL, z], [CELL, 6 * CELL, 8 * CELL]));
        details.push(box(`${source.id}-side-window-pane`, '#80c7d1', [sideWall + CELL / 2, bottom + 6.5 * CELL, z],
          [CELL, 4 * CELL, 6 * CELL]));
        details.push(box(`${source.id}-side-window-divider`, CREAM, [sideWall + CELL, bottom + 6.5 * CELL, z],
          [CELL, 4 * CELL, CELL]));
        details.push(box(`${source.id}-side-window-sill`, CREAM, [sideWall + CELL / 2, bottom + 3 * CELL, z],
          [2 * CELL, CELL, 10 * CELL]));
        const awning = source.id === 'town-house-yellow-body' ? '#35887e' : '#df7056';
        for (const column of [-1, 0, 1]) {
          const stripeColor = column === 0 ? CREAM : awning;
          details.push(facade(`door-canopy-${column}`, stripeColor, [column * 3, 9, 1.5], [3, 1, 3]));
          details.push(facade(`door-valance-${column}`, stripeColor, [column * 3, 8, 2.5], [3, 1, 1]));
        }
      }
    }
    if ((source.id.startsWith('town-house-') || source.id === 'fire-building-roof') && source.id.endsWith('-roof')) {
      const roofTop = y + h / 2;
      for (let level = 1; level <= 5; level++) {
        details.push(box(`${source.id}-step-${level}`, source.color,
          [x, roofTop + (level - 0.5) * CELL, z], [w - 2 * CELL, CELL, d - level * 4 * CELL]));
      }
      if (source.id.startsWith('town-house-')) {
        const chimneyX = x - 8 * CELL;
        details.push(box(`${source.id}-chimney`, '#a96550', [chimneyX, roofTop + 6 * CELL, z], [3 * CELL, 6 * CELL, 3 * CELL]));
        details.push(box(`${source.id}-chimney-cap`, CREAM, [chimneyX, roofTop + 9.5 * CELL, z], [5 * CELL, CELL, 5 * CELL]));
      }
    }
    if (source.id === 'playground-plank') details.push(...createSeesawDetails(source));
    if (source.id === 'park-pond') details.push(...createPondDetails(source));
    if (source.id === 'construction-crane-beam') {
      details.push(box('construction-crane-trolley', WOOD, [x, y - 0.35, z], [1.1, 0.4, 1.05]));
      details.push(box('construction-crane-cable', WOOD, [x, y - 1.15, z], [0.12, 1.3, 0.12]));
      details.push(box('construction-crane-hook-stem', GOLD, [x, y - 1.95, z], [0.18, 0.35, 0.18]));
      details.push(box('construction-crane-hook-foot', GOLD, [x + 0.15, y - 2.1, z], [0.45, 0.16, 0.18]));
    }
  }
  return [...boxes, ...details];
}

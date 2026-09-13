import type { WorldBoxDefinition } from './productionWorldMap';

const CREAM = '#f1efe6';
const RED = '#c83e34';
const WOOD = '#86552f';
const GOLD = '#f2c94c';

/** 造形と衝突が同じ寸法を使う、街の固定部品を作る。 */
function box(id: string, color: string, position: readonly [number, number, number],
  scale: readonly [number, number, number], solid = false): WorldBoxDefinition {
  return { id, color, position, scale, solid };
}

/** 前庭の西側に東向き開口を持つ車庫。帰庫点と敷地を連続させる。 */
export function createRescueDepot(): readonly WorldBoxDefinition[] {
  return [
    box('garage-back-wall', CREAM, [-6, 1.8, -9.2], [6.8, 3.6, 0.6], true),
    box('garage-left-wall', CREAM, [-9.1, 1.8, -6.5], [0.6, 3.6, 5.4], true),
    box('garage-right-wall', CREAM, [-2.9, 1.8, -6.5], [0.6, 3.6, 5.4], true),
    box('garage-header', RED, [-6, 3.3, -3.8], [6.8, 0.6, 0.6]),
    box('garage-roof-eaves', RED, [-6, 3.8, -6.5], [7.6, 0.4, 6.4]),
    box('garage-roof-middle', RED, [-6, 4.2, -6.5], [7.2, 0.4, 4.6]),
    box('garage-roof-ridge', RED, [-6, 4.6, -6.5], [6.8, 0.4, 2.8]),
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
}

/** 薄い壁に見えないよう、南地区の入口旗を歩道上の柱と段付き三角にする。 */
export function createPaintLaneFlags(): readonly WorldBoxDefinition[] {
  return ['#e24b3f', GOLD, '#3b82f6'].flatMap((color, index) => {
    const x = 4 + index * 1.5;
    const id = ['red', 'yellow', 'blue'][index];
    return [
      box(`south-flag-base-${id}`, WOOD, [x, 0.15, 15], [0.65, 0.3, 0.65]),
      box(`south-flag-post-${id}`, WOOD, [x, 1.1, 15], [0.16, 1.9, 0.16]),
      ...[0, 1, 2].map(step => box(`south-entry-flag-${id}-${step}`, color,
        [x + 0.22 + step * 0.22, 1.66, 15], [0.22, 0.84 - step * 0.24, 0.14])),
    ];
  });
}

/** 建物の寸法を変えずに、窓・入口・段屋根・道具の意味を共有paletteで付ける。 */
export function addTownDetails(boxes: readonly WorldBoxDefinition[]): readonly WorldBoxDefinition[] {
  const details: WorldBoxDefinition[] = [];
  for (const source of boxes) {
    const [x, y, z] = source.position;
    const [w, h, d] = source.scale;
    if (source.id === 'fire-building-body' || source.id === 'construction-office-body'
      || (source.id.startsWith('town-house-') && source.id.endsWith('-body'))) {
      const front = z + d / 2 + 0.04;
      details.push(box(`${source.id}-door`, WOOD, [x, y - h / 2 + 0.85, front], [0.9, 1.6, 0.1]));
      for (const dx of [-w * 0.3, w * 0.3]) {
        const suffix = dx < 0 ? 'left' : 'right';
        details.push(box(`${source.id}-window-frame-${suffix}`, CREAM, [x + dx, y + 0.25, front], [1.5, 1.3, 0.12]));
        details.push(box(`${source.id}-window-glass-${suffix}`, '#7ed1e6', [x + dx, y + 0.25, front + 0.09], [1.15, 0.95, 0.1]));
        details.push(box(`${source.id}-window-mullion-${suffix}`, CREAM, [x + dx, y + 0.25, front + 0.15], [0.1, 0.95, 0.06]));
      }
    }
    if (source.id.includes('town-house-') && source.id.endsWith('-roof')) {
      for (const level of [1, 2, 3]) details.push(box(`${source.id}-step-${level}`, source.color,
        [x, y + level * 0.35, z], [w - level * 0.45, 0.35, d - level * 1.2]));
    }
    if (source.id.includes('tree-crown')) {
      details.push(box(`${source.id}-top`, source.color, [x, y + h * 0.6, z], [w * 0.65, h * 0.5, d * 0.65]));
    }
    if (source.id.includes('sign-board') || source.id === 'hub-wayfinding-board') {
      // 矢印はカメラ側の両面に置き、空白の横棒を残さない。
      for (const side of [-1, 1]) {
        const face = z + side * (d / 2 + 0.05);
        details.push(box(`${source.id}-arrow-shaft-${side}`, WOOD, [x, y, face], [w * 0.4, h * 0.18, 0.08]));
        for (const sign of [-1, 1]) details.push(box(`${source.id}-arrow-tip-${side}-${sign}`, WOOD,
          [x + w * 0.15, y + sign * h * 0.14, face], [w * 0.1, h * 0.2, 0.08]));
      }
    }
    if (source.id.startsWith('construction-timber-stack')) {
      for (const offset of [-0.9, 0.9]) details.push(box(`${source.id}-band-${offset}`, GOLD,
        [x + offset, y + h / 2 + 0.03, z], [0.18, 0.06, d]));
    }
    if (source.id === 'construction-crane-beam') {
      details.push(box('construction-crane-trolley', WOOD, [x, y - 0.35, z], [1.1, 0.4, 1.05]));
      details.push(box('construction-crane-cable', WOOD, [x, y - 1.15, z], [0.12, 1.3, 0.12]));
      details.push(box('construction-crane-hook-stem', GOLD, [x, y - 1.95, z], [0.18, 0.35, 0.18]));
      details.push(box('construction-crane-hook-foot', GOLD, [x + 0.15, y - 2.1, z], [0.45, 0.16, 0.18]));
    }
  }
  return [...boxes, ...details];
}

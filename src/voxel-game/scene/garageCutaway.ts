import type { WorldBoxDefinition } from './productionWorldMap';

/** 南東からの固定視点を遮る車庫の背面・右面だけ、同じ足元境界の腰壁へ描画する。 */
export function createGarageCutawayBoxes(boxes: readonly WorldBoxDefinition[]): readonly WorldBoxDefinition[] {
  return boxes.map((box) => {
    const wall = box.id === 'garage-back-wall' || box.id === 'garage-right-wall';
    const rim = box.id === 'garage-roof-back' || box.id === 'garage-roof-right';
    if (!wall && !rim) return box;
    return {
      ...box,
      position: [box.position[0], wall ? 0.55 : 1.1, box.position[2]],
      scale: [box.scale[0], wall ? 0.9 : 0.2, box.scale[2]],
    };
  });
}

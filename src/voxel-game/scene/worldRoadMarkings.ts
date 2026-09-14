import type { WorldPoint, WorldRoadDefinition } from './productionWorldMap';

/** 道路と同じ座標から描く、交差点に食い込まない中央線。 */
export interface RoadMarkingBox {
  readonly position: WorldPoint;
  readonly scale: WorldPoint;
}

/** 交差する道路の全幅と端の余白を避け、各道路の残った区間だけに中央線を置く。 */
export function createRoadMarkings(roads: readonly WorldRoadDefinition[]): readonly RoadMarkingBox[] {
  return roads.flatMap(road => {
    const axis = road.scale[0] >= road.scale[2] ? 0 : 2;
    const crossAxis = axis === 0 ? 2 : 0;
    let intervals: [number, number][] = [[
      road.position[axis] - road.scale[axis] / 2 + 0.3,
      road.position[axis] + road.scale[axis] / 2 - 0.3,
    ]];
    for (const other of roads) {
      if ((other.scale[0] >= other.scale[2] ? 0 : 2) === axis) continue;
      if (Math.abs(road.position[crossAxis] - other.position[crossAxis]) > other.scale[crossAxis] / 2) continue;
      const start = other.position[axis] - other.scale[axis] / 2 - 0.3;
      const end = other.position[axis] + other.scale[axis] / 2 + 0.3;
      intervals = intervals.flatMap(([low, high]) => {
        if (end <= low || start >= high) return [[low, high]];
        const remaining: [number, number][] = [];
        if (start > low) remaining.push([low, start]);
        if (end < high) remaining.push([end, high]);
        return remaining;
      });
    }
    return intervals.filter(([low, high]) => high - low > 0.1).map(([low, high]) => ({
      position: axis === 0
        ? [(low + high) / 2, 0.19, road.position[2]] as const
        : [road.position[0], 0.19, (low + high) / 2] as const,
      scale: axis === 0 ? [high - low, 0.05, 0.22] as const : [0.22, 0.05, high - low] as const,
    }));
  });
}

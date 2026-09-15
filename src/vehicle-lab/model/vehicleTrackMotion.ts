import type { Matrix4 } from 'three';

export type TrackedVehicleId = 'bulldozer' | 'excavator';
export interface TrackTravel { left: number; right: number }
export interface TrackLink { readonly x: number; readonly phase: number; readonly side: 'left' | 'right' }

/** 既存voxelの角を落とした履帯外周を、上面前進・下面後退の順に定義する。 */
function createLoop(front: number) {
  const points = [[0.48, 0.96], [0.48, (front + 1) * 0.24], [0.24, front * 0.24],
    [0, (front + 1) * 0.24], [0, 0.96], [0.24, 1.2], [0.48, 0.96]] as const;
  let length = 0;
  const segments = points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const segment = { start, end, distance, offset: length };
    length += distance;
    return segment;
  });
  return { front, length, segments };
}

const LOOPS = { bulldozer: createLoop(-3), excavator: createLoop(-4) };

/** 車種の実voxel外周に沿った一周の距離を返す。 */
export function getTrackLoopLength(id: TrackedVehicleId): number { return LOOPS[id].length; }

/** 転輪・車体・作業道具を除き、外周の踏み板だけを循環距離へ対応付ける。 */
export function findTrackLink(id: TrackedVehicleId, position: readonly [number, number, number]): TrackLink | null {
  const [x, y, z] = position.map(value => Math.round(value / 0.24));
  const loop = LOOPS[id];
  if (![-5, -4, 5, 6].includes(x)) return null;
  let phase: number;
  if (y === 2 && z > loop.front && z < 5) phase = (4 - z) * 0.24;
  else if (y === 0 && z > loop.front && z < 5) phase = loop.segments[3].offset + (z - loop.front - 1) * 0.24;
  else if (y === 1 && z === loop.front) phase = loop.segments[2].offset;
  else if (y === 1 && z === 5) phase = loop.segments[5].offset;
  else return null;
  return { x: position[0], phase, side: x < 0 ? 'left' : 'right' };
}

/** 実変位と実旋回角を幅2.4の左右履帯へ配分する。停止中は状態を保持する。 */
export function advanceTrackTravel(travel: TrackTravel, signedDistance: number, yawDelta: number, id: TrackedVehicleId): void {
  const length = getTrackLoopLength(id);
  travel.left = (travel.left + signedDistance - yawDelta * 1.2) % length;
  travel.right = (travel.right + signedDistance + yawDelta * 1.2) % length;
}

/** 踏み板を閉じた外周に沿って動かし、車体の寸法とvoxelの向きは保つ。 */
export function writeTrackMatrix(matrix: Matrix4, link: TrackLink, travel: number, id: TrackedVehicleId): void {
  const loop = LOOPS[id];
  const phase = ((link.phase + travel) % loop.length + loop.length) % loop.length;
  const segment = loop.segments.find(part => phase < part.offset + part.distance) ?? loop.segments[0];
  const fraction = (phase - segment.offset) / segment.distance;
  matrix.makeTranslation(link.x,
    segment.start[0] + (segment.end[0] - segment.start[0]) * fraction,
    segment.start[1] + (segment.end[1] - segment.start[1]) * fraction);
}

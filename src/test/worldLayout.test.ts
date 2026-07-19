import { describe, expect, it } from 'vitest';
import {
  BREAKABLE_BLOCKS,
  FIRE_POSITION,
  GARAGE_POSITION,
  WORLD_BOUNDS,
} from '../voxel-game/scene/worldLayout';

describe('voxel world layout', () => {
  it('36×36相当の境界内へ主要地点を置く', () => {
    expect(WORLD_BOUNDS).toEqual({ maxX: 18, maxZ: 18, minX: -18, minZ: -18 });

    for (const [x, , z] of [
      GARAGE_POSITION,
      FIRE_POSITION,
      ...BREAKABLE_BLOCKS.map((block) => block.position),
    ]) {
      expect(x).toBeGreaterThanOrEqual(WORLD_BOUNDS.minX);
      expect(x).toBeLessThanOrEqual(WORLD_BOUNDS.maxX);
      expect(z).toBeGreaterThanOrEqual(WORLD_BOUNDS.minZ);
      expect(z).toBeLessThanOrEqual(WORLD_BOUNDS.maxZ);
    }
  });

  it('壊せる積み木IDを重複させない', () => {
    expect(new Set(BREAKABLE_BLOCKS.map((block) => block.id)).size).toBe(
      BREAKABLE_BLOCKS.length,
    );
  });
});

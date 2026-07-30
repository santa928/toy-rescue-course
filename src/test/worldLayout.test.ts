import { describe, expect, it } from 'vitest';
import {
  BLOCK_PLAZA,
  BREAKABLE_BLOCKS,
  FIRE_POSITION,
  FIRE_SPRAY_TARGET_POSITION,
  GARAGE_POSITION,
  isInsideGarageRestartArea,
  WORLD_BOUNDS,
} from '../voxel-game/scene/worldLayout';

describe('voxel world layout', () => {
  it('36×36相当の境界内へ主要地点を置く', () => {
    expect(WORLD_BOUNDS).toEqual({ maxX: 18, maxZ: 18, minX: -18, minZ: -18 });

    for (const [x, , z] of [
      GARAGE_POSITION,
      FIRE_POSITION,
      FIRE_SPRAY_TARGET_POSITION,
      ...BREAKABLE_BLOCKS.map((block) => block.position),
    ]) {
      expect(x).toBeGreaterThanOrEqual(WORLD_BOUNDS.minX);
      expect(x).toBeLessThanOrEqual(WORLD_BOUNDS.maxX);
      expect(z).toBeGreaterThanOrEqual(WORLD_BOUNDS.minZ);
      expect(z).toBeLessThanOrEqual(WORLD_BOUNDS.maxZ);
    }
  });

  it('建物の代表位置と分離した見える炎の照準点を固定する', () => {
    expect(FIRE_POSITION).toEqual([12, 1.2, -11]);
    expect(FIRE_SPRAY_TARGET_POSITION).toEqual([12.9, 1.45, -9.1]);
    expect(FIRE_SPRAY_TARGET_POSITION).not.toEqual(FIRE_POSITION);
  });

  it('壊せる積み木IDを重複させない', () => {
    expect(new Set(BREAKABLE_BLOCKS.map((block) => block.id)).size).toBe(
      BREAKABLE_BLOCKS.length,
    );
  });

  it('車庫中心からXZ半径3以内だけを仕事の再開領域として扱う', () => {
    expect(isInsideGarageRestartArea(GARAGE_POSITION)).toBe(true);
    expect(isInsideGarageRestartArea([3, -99, 14])).toBe(true);
    expect(isInsideGarageRestartArea([0, 99, 17.001])).toBe(false);
    expect(isInsideGarageRestartArea([12, 0.8, -5])).toBe(false);
  });

  it('積み木4個を道路と中央公園の外へ車体外形ぶん離して置く', () => {
    const minimumBlockCenterClearance = 4.5;
    const blockHalfExtent = 0.75;
    const westRoadEastEdge = -13;
    const parkWestEdge = -6;
    const plazaMinX = BLOCK_PLAZA.position[0] - BLOCK_PLAZA.scale[0] / 2;
    const plazaMaxX = BLOCK_PLAZA.position[0] + BLOCK_PLAZA.scale[0] / 2;
    const plazaMinZ = BLOCK_PLAZA.position[2] - BLOCK_PLAZA.scale[2] / 2;
    const plazaMaxZ = BLOCK_PLAZA.position[2] + BLOCK_PLAZA.scale[2] / 2;

    expect(plazaMinX).toBeGreaterThanOrEqual(westRoadEastEdge);
    expect(plazaMaxX).toBeLessThanOrEqual(parkWestEdge);

    for (const [index, block] of BREAKABLE_BLOCKS.entries()) {
      const [x, , z] = block.position;
      expect(x - blockHalfExtent, `${block.id} enters the west road`).toBeGreaterThanOrEqual(
        westRoadEastEdge,
      );
      expect(x + blockHalfExtent, `${block.id} enters the central park`).toBeLessThanOrEqual(
        parkWestEdge,
      );
      expect(x - blockHalfExtent, `${block.id} leaves the plaza on the west`).toBeGreaterThanOrEqual(
        plazaMinX,
      );
      expect(x + blockHalfExtent, `${block.id} leaves the plaza on the east`).toBeLessThanOrEqual(
        plazaMaxX,
      );
      expect(z - blockHalfExtent, `${block.id} leaves the plaza on the north`).toBeGreaterThanOrEqual(
        plazaMinZ,
      );
      expect(z + blockHalfExtent, `${block.id} leaves the plaza on the south`).toBeLessThanOrEqual(
        plazaMaxZ,
      );

      for (const other of BREAKABLE_BLOCKS.slice(index + 1)) {
        const [otherX, , otherZ] = other.position;
        expect(
          Math.hypot(otherX - x, otherZ - z),
          `${block.id} and ${other.id} are too close for the vehicle outline`,
        ).toBeGreaterThanOrEqual(minimumBlockCenterClearance);
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { PRODUCTION_WORLD_MAP } from '../voxel-game/scene/productionWorldMap';
import * as WorldLayoutModule from '../voxel-game/scene/worldLayout';
import {
  BLOCK_PLAZA,
  BREAKABLE_BLOCKS,
  BULLDOZER_DEBRIS,
  BULLDOZER_ROUTE_MARKER_POSITIONS,
  FIRE_POSITION,
  FIRE_SPRAY_TARGET_POSITION,
  GARAGE_POSITION,
  isInsideGarageRestartArea,
  PARK_CENTER,
  resolveVehicleDistrict,
  WORLD_BOUNDS,
  VEHICLE_GARAGE_POSITION,
} from '../voxel-game/scene/worldLayout';

describe('voxel world layout', () => {
  it('道しるべと成功星のworld座標もproduction mapと同じ参照から公開する', () => {
    const map = PRODUCTION_WORLD_MAP as typeof PRODUCTION_WORLD_MAP & {
      readonly landmarks: typeof PRODUCTION_WORLD_MAP.landmarks & {
        readonly celebrationStarCenters?: readonly (readonly [number, number, number])[];
        readonly fireRouteMarkers?: readonly (readonly [number, number, number])[];
      };
    };
    const layout = WorldLayoutModule as typeof WorldLayoutModule & {
      readonly CELEBRATION_STAR_CENTER_POSITIONS?: readonly (readonly [number, number, number])[];
      readonly FIRE_ROUTE_MARKER_POSITIONS?: readonly (readonly [number, number, number])[];
    };

    expect(map.landmarks.fireRouteMarkers).toBeDefined();
    expect(map.landmarks.celebrationStarCenters).toBeDefined();
    expect(layout.FIRE_ROUTE_MARKER_POSITIONS).toBeDefined();
    expect(layout.CELEBRATION_STAR_CENTER_POSITIONS).toBeDefined();
    expect(layout.FIRE_ROUTE_MARKER_POSITIONS).toBe(map.landmarks.fireRouteMarkers);
    expect(layout.CELEBRATION_STAR_CENTER_POSITIONS).toBe(
      map.landmarks.celebrationStarCenters,
    );
  });

  it('ブルドーザーのがれきと道しるべもproduction mapと同じ参照から公開する', () => {
    expect(BULLDOZER_DEBRIS).toHaveLength(3);
    expect(BULLDOZER_ROUTE_MARKER_POSITIONS).toHaveLength(7);
    expect(BULLDOZER_DEBRIS).toBe(PRODUCTION_WORLD_MAP.landmarks.bulldozerDebris);
    expect(BULLDOZER_ROUTE_MARKER_POSITIONS)
      .toBe(PRODUCTION_WORLD_MAP.landmarks.bulldozerRouteMarkers);
  });

  it('全公開座標をproduction mapのlandmarksと同じ参照から導出する', () => {
    const map = PRODUCTION_WORLD_MAP as typeof PRODUCTION_WORLD_MAP & {
      readonly landmarks?: {
        readonly blockPlaza: typeof BLOCK_PLAZA;
        readonly breakableBlocks: typeof BREAKABLE_BLOCKS;
        readonly fire: typeof FIRE_POSITION;
        readonly fireSprayTarget: typeof FIRE_SPRAY_TARGET_POSITION;
        readonly garage: typeof GARAGE_POSITION;
        readonly park: typeof PARK_CENTER;
      };
    };

    expect(map.landmarks).toBeDefined();
    if (!map.landmarks) return;
    expect(GARAGE_POSITION).toBe(map.landmarks.garage);
    expect(PARK_CENTER).toBe(map.landmarks.park);
    expect(BLOCK_PLAZA).toBe(map.landmarks.blockPlaza);
    expect(BREAKABLE_BLOCKS).toBe(map.landmarks.breakableBlocks);
    expect(FIRE_POSITION).toBe(map.landmarks.fire);
    expect(FIRE_SPRAY_TARGET_POSITION).toBe(map.landmarks.fireSprayTarget);
  });

  it('96×96本番境界内へ既存遊びの座標を変えずに置く', () => {
    expect(WORLD_BOUNDS).toEqual({ maxX: 48, maxZ: 48, minX: -48, minZ: -48 });
    expect(GARAGE_POSITION).toEqual([0, 0.8, 6]);
    expect(VEHICLE_GARAGE_POSITION).toEqual([0, 0, 6]);
    expect(PARK_CENTER).toEqual([0, 0, -24]);
    expect(BLOCK_PLAZA).toEqual({
      position: [-24, 0.18, 6],
      scale: [14, 0.34, 16],
    });
    expect(FIRE_POSITION).toEqual([26, 1.2, -18]);
    expect(FIRE_SPRAY_TARGET_POSITION).toEqual([26.9, 1.45, -16.1]);
    expect(BREAKABLE_BLOCKS.map(({ position }) => position)).toEqual([
      [-26.7, 0.75, 9.5],
      [-21.5, 0.75, 0],
      [-21.3, 0.75, 4.6],
      [-26.7, 0.75, 2.5],
    ]);
  });

  it('車両位置を本番地区へ解決する', () => {
    expect(resolveVehicleDistrict(GARAGE_POSITION)).toBe('hub');
    expect(resolveVehicleDistrict(PARK_CENTER)).toBe('park');
    expect(resolveVehicleDistrict(FIRE_POSITION)).toBe('fire');
    expect(resolveVehicleDistrict(BLOCK_PLAZA.position)).toBe('blocks');
    expect(resolveVehicleDistrict([0, 0, 24])).toBe('south');
    expect(resolveVehicleDistrict([-31, 0, -31])).toBe('construction');
    expect(resolveVehicleDistrict([31, 0, 31])).toBe('town');
    expect(resolveVehicleDistrict([12, 0, 0])).toBe('road');
  });

  it('追加地区中心をproduction mapと同じ参照から公開する', () => {
    const map = PRODUCTION_WORLD_MAP as typeof PRODUCTION_WORLD_MAP & {
      readonly landmarks: typeof PRODUCTION_WORLD_MAP.landmarks & {
        readonly construction?: readonly [number, number, number];
        readonly town?: readonly [number, number, number];
      };
    };
    const layout = WorldLayoutModule as typeof WorldLayoutModule & {
      readonly CONSTRUCTION_CENTER?: readonly [number, number, number];
      readonly TOWN_CENTER?: readonly [number, number, number];
    };

    expect(layout.CONSTRUCTION_CENTER).toEqual([-31, 0, -31]);
    expect(layout.TOWN_CENTER).toEqual([31, 0, 31]);
    expect(layout.CONSTRUCTION_CENTER).toBe(map.landmarks.construction);
    expect(layout.TOWN_CENTER).toBe(map.landmarks.town);
  });

  it('建物の代表位置と分離した見える炎の照準点を固定する', () => {
    expect(FIRE_POSITION).toEqual([26, 1.2, -18]);
    expect(FIRE_SPRAY_TARGET_POSITION).toEqual([26.9, 1.45, -16.1]);
    expect(FIRE_SPRAY_TARGET_POSITION).not.toEqual(FIRE_POSITION);
  });

  it('壊せる積み木IDを重複させない', () => {
    expect(new Set(BREAKABLE_BLOCKS.map((block) => block.id)).size).toBe(
      BREAKABLE_BLOCKS.length,
    );
  });

  it('車庫中心からXZ半径3以内だけを仕事の再開領域として扱う', () => {
    expect(isInsideGarageRestartArea(GARAGE_POSITION)).toBe(true);
    expect(isInsideGarageRestartArea([3, -99, 6])).toBe(true);
    expect(isInsideGarageRestartArea([0, 99, 9.001])).toBe(false);
    expect(isInsideGarageRestartArea([12, 0.8, -5])).toBe(false);
  });

  it('積み木4個を積み木広場内へ車体外形ぶん離して置く', () => {
    const minimumBlockCenterClearance = 4.5;
    const blockHalfExtent = 0.75;
    const districtWestEdge = -31;
    const districtEastEdge = -17;
    const plazaMinX = BLOCK_PLAZA.position[0] - BLOCK_PLAZA.scale[0] / 2;
    const plazaMaxX = BLOCK_PLAZA.position[0] + BLOCK_PLAZA.scale[0] / 2;
    const plazaMinZ = BLOCK_PLAZA.position[2] - BLOCK_PLAZA.scale[2] / 2;
    const plazaMaxZ = BLOCK_PLAZA.position[2] + BLOCK_PLAZA.scale[2] / 2;

    expect(plazaMinX).toBeGreaterThanOrEqual(districtWestEdge);
    expect(plazaMaxX).toBeLessThanOrEqual(districtEastEdge);

    for (const [index, block] of BREAKABLE_BLOCKS.entries()) {
      const [x, , z] = block.position;
      expect(x - blockHalfExtent, `${block.id} leaves the district on the west`).toBeGreaterThanOrEqual(
        districtWestEdge,
      );
      expect(x + blockHalfExtent, `${block.id} leaves the district on the east`).toBeLessThanOrEqual(
        districtEastEdge,
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

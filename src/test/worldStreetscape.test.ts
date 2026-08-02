import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_WORLD_MAP,
  type ProductionWorldMapDefinition,
} from '../voxel-game/scene/productionWorldMap';
import {
  calculateDistrictNonRoadSurfaceCoverage,
  countDecorationClustersByDistrict,
  flattenDecorationBoxes,
  validateWorldStreetscape,
} from '../voxel-game/scene/worldStreetscape';

describe('world streetscape', () => {
  it('7地区を承認paletteの床で70%以上覆い、道路面より低く保つ', () => {
    const expectedPalette = {
      blocks: ['#d8ba76', '#f2d995'],
      construction: ['#a9adb3', '#d5b468'],
      fire: ['#d99275', '#efb7a3'],
      hub: ['#dfcda8', '#f6e8c9'],
      park: ['#91bd70', '#b9d798'],
      south: ['#82b8d7', '#aed5e9'],
      town: ['#d7d0b9', '#eee7d2'],
    } as const;

    for (const district of PRODUCTION_WORLD_MAP.districts) {
      const surfaces = PRODUCTION_WORLD_MAP.surfaceTiles.filter(
        ({ districtId }) => districtId === district.id,
      );
      const colors = [...new Set(surfaces.map(({ color }) => color))].sort();
      expect(colors, district.id).toEqual([...expectedPalette[district.id]].sort());
      expect(calculateDistrictNonRoadSurfaceCoverage(
        district,
        PRODUCTION_WORLD_MAP.roads,
        surfaces,
      ), district.id).toBeGreaterThanOrEqual(0.7);
      expect(surfaces.every(({ position, scale }) => (
        position[1] + scale[1] / 2 <= 0.08
      )), district.id).toBe(true);
    }
  });

  it('旧地面IDをsurfaceへ移し、7地区へ2〜4個ずつ計21の街角群を置く', () => {
    expect(PRODUCTION_WORLD_MAP.surfaceTiles.filter(({ id }) => [
      'park-ground',
      'block-plaza-ground',
      'construction-ground',
      'town-green-west',
      'town-green-east',
    ].includes(id)).map(({ id }) => id)).toEqual([
      'park-ground',
      'block-plaza-ground',
      'construction-ground',
      'town-green-west',
      'town-green-east',
    ]);
    expect(countDecorationClustersByDistrict(PRODUCTION_WORLD_MAP.decorationClusters)).toEqual({
      blocks: 3,
      construction: 3,
      fire: 3,
      hub: 2,
      park: 3,
      south: 3,
      town: 4,
    });
    expect(PRODUCTION_WORLD_MAP.decorationClusters).toHaveLength(21);
  });

  it('装飾boxを一意なcanonical列へ平坦化し、硬い大物だけを追加solidにする', () => {
    const boxes = flattenDecorationBoxes(PRODUCTION_WORLD_MAP.decorationClusters);
    const solidIds = boxes.filter(({ solid }) => solid).map(({ id }) => id);

    expect(new Set(boxes.map(({ id }) => id)).size).toBe(boxes.length);
    expect(solidIds).toEqual([
      'hub-tool-rack-post',
      'park-bench-seat',
      'park-lamp-post',
      'park-picnic-table',
      'fire-hydrant-body',
      'fire-lamp-post',
      'blocks-fence-post',
      'south-viewing-bench',
      'construction-barrier-post',
      'construction-work-lamp-post',
      'town-west-lamp-post',
      'town-east-lamp-post',
      'town-bench-seat',
    ]);
    expect(solidIds).toHaveLength(13);
  });

  it('canonical streetscapeを検証し、重複・高さ・群数・道路侵入をID付きで拒否する', () => {
    expect(validateWorldStreetscape(PRODUCTION_WORLD_MAP)).toEqual([]);

    const duplicateSurface = {
      ...PRODUCTION_WORLD_MAP,
      surfaceTiles: [
        ...PRODUCTION_WORLD_MAP.surfaceTiles,
        PRODUCTION_WORLD_MAP.surfaceTiles[0],
      ],
    } as ProductionWorldMapDefinition;
    expect(validateWorldStreetscape(duplicateSurface)).toContain(
      `duplicate streetscape id: ${PRODUCTION_WORLD_MAP.surfaceTiles[0].id}`,
    );

    const highSurface = {
      ...PRODUCTION_WORLD_MAP,
      surfaceTiles: PRODUCTION_WORLD_MAP.surfaceTiles.map((surface, index) => (
        index === 0 ? { ...surface, position: [surface.position[0], 0.09, surface.position[2]] } : surface
      )),
    } as ProductionWorldMapDefinition;
    expect(validateWorldStreetscape(highSurface)).toContain(
      `surface above road-safe height: ${PRODUCTION_WORLD_MAP.surfaceTiles[0].id}`,
    );

    const missingHubCluster = {
      ...PRODUCTION_WORLD_MAP,
      decorationClusters: PRODUCTION_WORLD_MAP.decorationClusters.filter(
        ({ id }) => id !== 'hub-entry-guides',
      ),
    } as ProductionWorldMapDefinition;
    expect(validateWorldStreetscape(missingHubCluster)).toContain(
      'district decoration cluster count outside 2..4: hub (1)',
    );

    const roadSolid = {
      ...PRODUCTION_WORLD_MAP,
      decorationClusters: PRODUCTION_WORLD_MAP.decorationClusters.map((cluster, index) => (
        index === 0
          ? {
              ...cluster,
              boxes: cluster.boxes.map((box, boxIndex) => (
                boxIndex === 0
                  ? { ...box, position: [0, box.position[1], 0], solid: true }
                  : box
              )),
            }
          : cluster
      )),
    } as ProductionWorldMapDefinition;
    expect(validateWorldStreetscape(roadSolid)).toContain(
      `decoration solid overlaps expanded road: ${roadSolid.decorationClusters[0].boxes[0].id}`,
    );
  });
});

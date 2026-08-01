import { describe, expect, it } from 'vitest';
import type { BulldozerMissionSnapshot } from '../voxel-game/domain/BulldozerMissionRuntime';
import {
  VEHICLE_JOBS,
  type BulldozerVehicleJobDefinition,
} from '../voxel-game/domain/vehicleJobs';
import {
  BULLDOZER_CHIP_POOL_SIZE,
  BULLDOZER_DEBRIS_VOXEL_POOL_SIZE,
  BULLDOZER_STAR_POOL_SIZE,
  createBulldozerVfxFrame,
  updateBulldozerVfxFrame,
} from '../voxel-game/scene/bulldozerVfx';
import { BULLDOZER_ROUTE_MARKER_POSITIONS } from '../voxel-game/scene/worldLayout';

const INITIAL_SNAPSHOT: BulldozerMissionSnapshot = {
  celebrationRemainingMs: 0,
  clearedCount: 0,
  debris: [
    { cleared: false, id: 'debris-timber' },
    { cleared: false, id: 'debris-stone' },
    { cleared: false, id: 'debris-crate' },
  ],
  elapsedMs: 0,
  missionPhase: 'assigned',
  routeVisible: true,
  targetCount: 3,
};

/** jobのID順と一致する未片付けsnapshotを作る。 */
function createJobSnapshot(job: BulldozerVehicleJobDefinition): BulldozerMissionSnapshot {
  return {
    ...INITIAL_SNAPSHOT,
    debris: job.debris.map(({ id }) => ({ cleared: false, id })),
  };
}

describe('bulldozer VFX frame', () => {
  it.each(VEHICLE_JOBS.bulldozer)(
    '$idの3対象・palette・7 routeを同じ固定frameへin-place転送する',
    (job) => {
      const frame = createBulldozerVfxFrame();
      const references = {
        chips: frame.chips,
        debris: frame.debris,
        routeMarkers: frame.routeMarkers,
        stars: frame.stars,
      };

      updateBulldozerVfxFrame(
        frame,
        createJobSnapshot(job),
        new Float64Array([-1, -1, -1]),
        0,
        job,
      );

      expect(frame.chips).toBe(references.chips);
      expect(frame.debris).toBe(references.debris);
      expect(frame.routeMarkers).toBe(references.routeMarkers);
      expect(frame.stars).toBe(references.stars);
      for (const [sourceIndex, source] of job.debris.entries()) {
        const sourceVoxels = frame.debris.filter((voxel) => voxel.sourceIndex === sourceIndex);
        expect(sourceVoxels).toHaveLength(4);
        expect(sourceVoxels.every(({ palette }) => palette === source.palette)).toBe(true);
        expect(sourceVoxels[0]?.position).toEqual([...source.position]);
      }
      expect(frame.routeMarkers.map(({ position }) => [position[0], position[2]])).toEqual(
        job.routeMarkers.map(([x, , z]) => [x, z]),
      );
    },
  );

  it.each(VEHICLE_JOBS.bulldozer)(
    '$idのclear chipと成功星を現在仕事の中心へ移す',
    (job) => {
      const frame = createBulldozerVfxFrame();
      const clearedSnapshot: BulldozerMissionSnapshot = {
        ...createJobSnapshot(job),
        celebrationRemainingMs: 1_800,
        clearedCount: 3,
        debris: job.debris.map(({ id }) => ({ cleared: true, id })),
        missionPhase: 'celebrating',
        routeVisible: false,
      };
      const center = job.debris.reduce(
        (sum, { position }) => [
          sum[0] + position[0],
          sum[1] + position[1],
          sum[2] + position[2],
        ],
        [0, 0, 0],
      ).map((sum) => sum / job.debris.length);

      updateBulldozerVfxFrame(
        frame,
        clearedSnapshot,
        new Float64Array([0, 0, 0]),
        0,
        job,
      );

      expect(frame.chips.filter(({ active }) => active)).toHaveLength(18);
      expect(frame.chips[0]?.position).toEqual([
        job.debris[0].position[0],
        job.debris[0].position[1] + 0.3,
        job.debris[0].position[2],
      ]);
      expect(frame.stars[0]?.position).toEqual([
        Math.round((center[0] ?? 0) * 2) / 2 - 1.8,
        (center[1] ?? 0) + 0.8,
        Math.round((center[2] ?? 0) * 2) / 2 - 0.5,
      ]);
    },
  );

  it('3塊×4 voxel、18 chip、7 route、固定成功星slotを一度だけ確保する', () => {
    const frame = createBulldozerVfxFrame();

    expect(frame.debris).toHaveLength(BULLDOZER_DEBRIS_VOXEL_POOL_SIZE);
    expect(frame.chips).toHaveLength(BULLDOZER_CHIP_POOL_SIZE);
    expect(frame.routeMarkers).toHaveLength(BULLDOZER_ROUTE_MARKER_POSITIONS.length);
    expect(frame.stars).toHaveLength(BULLDOZER_STAR_POOL_SIZE);
  });

  it('assigned中は3塊とrouteを表示し、chipと星を隠す', () => {
    const frame = createBulldozerVfxFrame();
    const debrisReference = frame.debris;
    const clearTimes = new Float64Array([-1, -1, -1]);

    updateBulldozerVfxFrame(frame, INITIAL_SNAPSHOT, clearTimes, 0);
    updateBulldozerVfxFrame(frame, INITIAL_SNAPSHOT, clearTimes, 0.1);

    expect(frame.debris).toBe(debrisReference);
    expect(frame.debris.filter(({ active }) => active)).toHaveLength(12);
    expect(frame.routeMarkers.filter(({ active }) => active)).toHaveLength(7);
    expect(frame.chips.filter(({ active }) => active)).toHaveLength(0);
    expect(frame.stars.filter(({ active }) => active)).toHaveLength(0);
  });

  it('片付けた1塊を隠し、そのpaletteの6 chipを流動的に飛ばす', () => {
    const frame = createBulldozerVfxFrame();
    const clearTimes = new Float64Array([0, -1, -1]);
    const snapshot: BulldozerMissionSnapshot = {
      ...INITIAL_SNAPSHOT,
      clearedCount: 1,
      debris: INITIAL_SNAPSHOT.debris.map((debris, index) => ({
        ...debris,
        cleared: index === 0,
      })),
      missionPhase: 'active',
    };

    updateBulldozerVfxFrame(frame, snapshot, clearTimes, 0.25);

    expect(frame.debris.filter(({ active }) => active)).toHaveLength(8);
    expect(frame.debris.filter(({ active, sourceIndex }) => active && sourceIndex === 0))
      .toHaveLength(0);
    expect(frame.chips.filter(({ active }) => active)).toHaveLength(6);
    expect(frame.chips.filter(({ active }) => active).some(({ position }) => position[1] > 0.8))
      .toBe(true);
  });

  it('成功中はrouteを隠し、固定slotの星を表示する', () => {
    const frame = createBulldozerVfxFrame();
    const snapshot: BulldozerMissionSnapshot = {
      ...INITIAL_SNAPSHOT,
      celebrationRemainingMs: 1_800,
      clearedCount: 3,
      debris: INITIAL_SNAPSHOT.debris.map((debris) => ({ ...debris, cleared: true })),
      missionPhase: 'celebrating',
      routeVisible: false,
    };

    updateBulldozerVfxFrame(frame, snapshot, new Float64Array([0, 0, 0]), 0.4);

    expect(frame.routeMarkers.filter(({ active }) => active)).toHaveLength(0);
    expect(frame.stars.filter(({ active }) => active)).toHaveLength(BULLDOZER_STAR_POOL_SIZE);
  });
});

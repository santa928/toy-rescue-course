import { describe, expect, it } from 'vitest';
import type { BulldozerMissionSnapshot } from '../voxel-game/domain/BulldozerMissionRuntime';
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

describe('bulldozer VFX frame', () => {
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

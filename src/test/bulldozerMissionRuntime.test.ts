import { describe, expect, it } from 'vitest';
import { BulldozerMissionRuntime } from '../voxel-game/domain/BulldozerMissionRuntime';

const DEBRIS_IDS = ['debris-a', 'debris-b', 'debris-c'] as const;

describe('BulldozerMissionRuntime', () => {
  it('3個の未処理がれきとassigned phaseから始まる', () => {
    const runtime = new BulldozerMissionRuntime(DEBRIS_IDS);

    expect(runtime.getSnapshot()).toMatchObject({
      celebrationRemainingMs: 0,
      clearedCount: 0,
      debris: [
        { cleared: false, id: 'debris-a' },
        { cleared: false, id: 'debris-b' },
        { cleared: false, id: 'debris-c' },
      ],
      missionPhase: 'assigned',
      routeVisible: true,
      targetCount: 3,
    });
  });

  it('既知のがれきを一度だけ片付け、未知IDと重複通知を無視する', () => {
    const runtime = new BulldozerMissionRuntime(DEBRIS_IDS);

    expect(runtime.registerDebrisClear('missing')).toBe(false);
    expect(runtime.registerDebrisClear('debris-a')).toBe(true);
    expect(runtime.registerDebrisClear('debris-a')).toBe(false);
    expect(runtime.getSnapshot()).toMatchObject({
      clearedCount: 1,
      missionPhase: 'active',
    });
  });

  it('3個を片付けて成功、自由走行、帰庫再開へ進む', () => {
    const runtime = new BulldozerMissionRuntime(DEBRIS_IDS);
    runtime.setAtGarage(false);
    runtime.registerDebrisClear('debris-a');
    runtime.registerDebrisClear('debris-b');
    runtime.registerDebrisClear('debris-c');

    expect(runtime.getSnapshot()).toMatchObject({
      celebrationRemainingMs: 1_800,
      clearedCount: 3,
      missionPhase: 'celebrating',
      routeVisible: false,
    });

    runtime.advance(1_800);
    expect(runtime.getSnapshot().missionPhase).toBe('freeRoam');

    runtime.setAtGarage(true);
    runtime.advance(1);
    expect(runtime.getSnapshot()).toMatchObject({
      clearedCount: 0,
      missionPhase: 'assigned',
      routeVisible: true,
    });
  });

  it('工事現場へ入ると片付け前でもactiveへ移る', () => {
    const runtime = new BulldozerMissionRuntime(DEBRIS_IDS);
    runtime.setAtWorksite(true);
    runtime.advance(1);

    expect(runtime.getSnapshot()).toMatchObject({
      clearedCount: 0,
      missionPhase: 'active',
    });
  });

  it('非有限・負の時間を状態へ加算しない', () => {
    const runtime = new BulldozerMissionRuntime(DEBRIS_IDS);
    runtime.advance(Number.NaN);
    runtime.advance(-10);

    expect(runtime.getSnapshot().elapsedMs).toBe(0);
  });

  it('重複したがれきIDをconstructorで拒否する', () => {
    expect(() => new BulldozerMissionRuntime(['same', 'same'])).toThrowError(
      'Duplicate bulldozer debris id: same',
    );
  });

  it('次仕事のがれきIDへ同じruntimeを再割当し、進捗とphaseを初期化する', () => {
    const runtime = new BulldozerMissionRuntime(DEBRIS_IDS);
    runtime.registerDebrisClear('debris-a');

    runtime.assignDebris(['next-a', 'next-b', 'next-c']);

    expect(runtime.getSnapshot()).toMatchObject({
      clearedCount: 0,
      debris: [
        { cleared: false, id: 'next-a' },
        { cleared: false, id: 'next-b' },
        { cleared: false, id: 'next-c' },
      ],
      missionPhase: 'assigned',
      targetCount: 3,
    });
    expect(runtime.registerDebrisClear('debris-a')).toBe(false);
  });
});

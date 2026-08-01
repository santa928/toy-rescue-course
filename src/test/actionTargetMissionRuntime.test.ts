import { describe, expect, it } from 'vitest';
import { ActionTargetMissionRuntime } from '../voxel-game/domain/ActionTargetMissionRuntime';

describe('ActionTargetMissionRuntime', () => {
  it('仕事地区へ入るとactiveになり、既知対象だけを冪等に完了する', () => {
    const runtime = new ActionTargetMissionRuntime(['target-a', 'target-b', 'target-c']);

    runtime.setAtWorksite(true);
    runtime.advance(16);
    expect(runtime.getSnapshot().missionPhase).toBe('active');
    expect(runtime.registerTargetCompletion('unknown')).toBe(false);
    expect(runtime.registerTargetCompletion('target-a')).toBe(true);
    expect(runtime.registerTargetCompletion('target-a')).toBe(false);
    expect(runtime.getSnapshot()).toMatchObject({
      completedCount: 1,
      missionPhase: 'active',
      targetCount: 3,
    });
  });

  it('全対象完了後1800msだけ成功演出し、帰庫で開始状態へ戻る', () => {
    const runtime = new ActionTargetMissionRuntime(['target-a']);

    expect(runtime.registerTargetCompletion('target-a')).toBe(true);
    expect(runtime.getSnapshot()).toMatchObject({
      celebrationRemainingMs: 1_800,
      missionPhase: 'celebrating',
    });
    runtime.advance(1_799);
    expect(runtime.getSnapshot().missionPhase).toBe('celebrating');
    runtime.advance(1);
    expect(runtime.getSnapshot().missionPhase).toBe('freeRoam');
    runtime.setAtGarage(true);
    runtime.advance(1);
    expect(runtime.getSnapshot()).toMatchObject({
      completedCount: 0,
      missionPhase: 'assigned',
      routeVisible: true,
    });
  });

  it('次仕事へ同じinstanceを再割当し、対象IDと進捗を同時に入れ替える', () => {
    const runtime = new ActionTargetMissionRuntime(['old-a', 'old-b']);
    runtime.registerTargetCompletion('old-a');

    runtime.assignTargets(['new-a']);

    expect(runtime.getSnapshot()).toMatchObject({
      completedCount: 0,
      missionPhase: 'assigned',
      targets: [{ completed: false, id: 'new-a' }],
    });
    expect(runtime.registerTargetCompletion('old-b')).toBe(false);
  });

  it('空、重複、空文字の対象IDを変更前に拒否する', () => {
    expect(() => new ActionTargetMissionRuntime([])).toThrowError(
      'Action target mission requires targets',
    );
    expect(() => new ActionTargetMissionRuntime(['same', 'same'])).toThrowError(
      'Duplicate action target id: same',
    );
    expect(() => new ActionTargetMissionRuntime([''])).toThrowError(
      'Action target mission requires non-empty target ids',
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0])(
    '不正なdelta=%sで状態を進めない',
    (milliseconds) => {
      const runtime = new ActionTargetMissionRuntime(['target-a']);
      const before = runtime.getSnapshot();
      runtime.advance(milliseconds);
      expect(runtime.getSnapshot()).toEqual(before);
    },
  );
});

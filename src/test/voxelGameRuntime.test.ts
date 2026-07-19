import { describe, expect, it } from 'vitest';
import { VoxelGameRuntime } from '../voxel-game/domain/VoxelGameRuntime';

describe('VoxelGameRuntime', () => {
  it('有効放水2500msで消火し、お礼演出後に自由走行へ移る', () => {
    const runtime = new VoxelGameRuntime(['plaza-red']);
    runtime.setSignals({ sprayActive: true, sprayOnFire: true });

    runtime.advance(2_500);
    expect(runtime.getSnapshot()).toMatchObject({ fireIntensity: 0, missionPhase: 'celebrating' });

    runtime.advance(1_800);
    expect(runtime.getSnapshot()).toMatchObject({ missionPhase: 'freeRoam', routeVisible: false });
  });

  it('分割した有効放水が合計2500msなら消火する', () => {
    const runtime = new VoxelGameRuntime(['plaza-red']);
    runtime.setSignals({ sprayActive: true, sprayOnFire: true });

    for (let step = 0; step < 2_500; step += 1) runtime.advance(1);

    expect(runtime.getSnapshot()).toMatchObject({ fireIntensity: 0, missionPhase: 'celebrating' });
  });

  it('小数msに分割した有効放水が合計2500msなら消火する', () => {
    const runtime = new VoxelGameRuntime(['plaza-red']);
    runtime.setSignals({ sprayActive: true, sprayOnFire: true });

    for (let step = 0; step < 25_000; step += 1) runtime.advance(0.1);

    expect(runtime.getSnapshot()).toMatchObject({ fireIntensity: 0, missionPhase: 'celebrating' });
  });

  it('火の範囲外へ放水しても強さを減らさない', () => {
    const runtime = new VoxelGameRuntime(['plaza-red']);
    runtime.setSignals({ sprayActive: true, sprayOnFire: false });
    runtime.advance(5_000);
    expect(runtime.getSnapshot().fireIntensity).toBe(1);
  });

  it('衝突速度4未満では壊さず、4以上で壊す', () => {
    const runtime = new VoxelGameRuntime(['plaza-red']);
    runtime.registerBlockImpact('plaza-red', 3.99);
    expect(runtime.getSnapshot().blocks[0]?.phase).toBe('intact');
    runtime.registerBlockImpact('plaza-red', 4);
    expect(runtime.getSnapshot().blocks[0]).toMatchObject({ phase: 'broken', respawnRemainingMs: 5_000 });
  });

  it('5秒後も車両が復元領域内なら待機し、離れたら復元する', () => {
    const runtime = new VoxelGameRuntime(['plaza-red']);
    runtime.registerBlockImpact('plaza-red', 7);
    runtime.setBlockClear('plaza-red', false);
    runtime.advance(5_000);
    expect(runtime.getSnapshot().blocks[0]?.phase).toBe('broken');
    runtime.setBlockClear('plaza-red', true);
    runtime.advance(16.67);
    expect(runtime.getSnapshot().blocks[0]?.phase).toBe('intact');
  });

  it('自由走行中に車庫へ戻ると仕事を初期化する', () => {
    const runtime = new VoxelGameRuntime(['plaza-red']);
    runtime.setSignals({ sprayActive: true, sprayOnFire: true });
    runtime.advance(2_500);
    runtime.advance(1_800);
    runtime.setSignals({ atGarage: true });
    runtime.advance(16.67);
    expect(runtime.getSnapshot()).toMatchObject({ fireIntensity: 1, missionPhase: 'assigned', routeVisible: true });
  });
});

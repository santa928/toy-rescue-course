import { describe, expect, it } from 'vitest';
import {
  advanceInFixedSteps,
  advanceRuntimeFrame,
  VoxelGameRuntime,
} from '../voxel-game/domain/VoxelGameRuntime';

describe('VoxelGameRuntime', () => {
  it('購読中はmission・火・block phaseの変化だけを通知し、解除後は通知しない', () => {
    const runtime = new VoxelGameRuntime(['plaza-red']);
    const snapshots: ReturnType<VoxelGameRuntime['getSnapshot']>[] = [];
    const unsubscribe = runtime.subscribe((snapshot) => snapshots.push(snapshot));

    runtime.advance(16.67);
    expect(snapshots).toHaveLength(0);

    runtime.setSignals({ sprayActive: true, sprayOnFire: false });
    runtime.advance(16.67);
    expect(snapshots).toHaveLength(1);
    expect(snapshots.at(-1)?.missionPhase).toBe('active');

    runtime.advance(16.67);
    expect(snapshots).toHaveLength(1);

    runtime.setSignals({ sprayOnFire: true });
    runtime.advance(100);
    expect(snapshots).toHaveLength(2);
    expect(snapshots.at(-1)?.fireIntensity).toBeLessThan(1);

    runtime.setSignals({ sprayActive: false, sprayOnFire: false });
    runtime.registerBlockImpact('plaza-red', 4);
    runtime.advance(1);
    expect(snapshots).toHaveLength(3);
    expect(snapshots.at(-1)?.blocks[0]?.phase).toBe('broken');

    runtime.advance(1);
    expect(snapshots).toHaveLength(3);
    unsubscribe();
    runtime.setSignals({ sprayActive: true, sprayOnFire: true });
    runtime.advance(100);
    expect(snapshots).toHaveLength(3);
  });

  it('手動clockを60Hz固定stepと最後の余りへ分割し、入力時間を過不足なく進める', () => {
    const deltas: number[] = [];

    advanceInFixedSteps(2_500.25, (deltaMs) => deltas.push(deltaMs));

    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.every((deltaMs) => deltaMs <= (1_000 / 60) + 1e-9)).toBe(true);
    expect(deltas.reduce((total, deltaMs) => total + deltaMs, 0)).toBeCloseTo(2_500.25, 9);
    expect(deltas.at(-1)).toBeCloseTo(0.25, 9);
  });

  it('手動clockは0・負数・非有限値を進めず、1step未満の小数はそのまま進める', () => {
    const deltas: number[] = [];

    advanceInFixedSteps(0, (deltaMs) => deltas.push(deltaMs));
    advanceInFixedSteps(-1, (deltaMs) => deltas.push(deltaMs));
    advanceInFixedSteps(Number.NaN, (deltaMs) => deltas.push(deltaMs));
    advanceInFixedSteps(0.125, (deltaMs) => deltas.push(deltaMs));

    expect(deltas).toEqual([0.125]);
  });

  it('手動clock直後の通常frameだけをskipし、次frameは50ms上限で進める', () => {
    const runtime = new VoxelGameRuntime([]);
    const manualClockFlag = { current: true };

    advanceRuntimeFrame(runtime, manualClockFlag, 0.2);
    expect(runtime.getSnapshot().elapsedMs).toBe(0);
    expect(manualClockFlag.current).toBe(false);

    advanceRuntimeFrame(runtime, manualClockFlag, 0.2);
    expect(runtime.getSnapshot().elapsedMs).toBe(50);
  });

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

  it('小数msに分割したお礼演出が合計1800msなら自由走行へ移る', () => {
    const runtime = new VoxelGameRuntime(['plaza-red']);
    runtime.setSignals({ sprayActive: true, sprayOnFire: true });
    runtime.advance(2_500);

    for (let step = 0; step < 18_000; step += 1) runtime.advance(0.1);

    expect(runtime.getSnapshot().missionPhase).toBe('freeRoam');
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

  it('小数msに分割した復元待ちが合計5000msなら積み木を復元する', () => {
    const runtime = new VoxelGameRuntime(['plaza-red']);
    runtime.registerBlockImpact('plaza-red', 4);

    for (let step = 0; step < 50_000; step += 1) runtime.advance(0.1);

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

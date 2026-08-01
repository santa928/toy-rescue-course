import assert from 'node:assert/strict';
import test from 'node:test';
import { createScenarioProgress } from './scenario-progress.mjs';

/** 経過時刻とinterval callbackを手動制御できるfake clockを作る。 */
function createFakeClock(initialNow = 1_000) {
  let intervalCallback = null;
  let now = initialNow;
  const cleared = [];
  return {
    advance(milliseconds) { now += milliseconds; },
    clearIntervalFn(intervalId) { cleared.push(intervalId); },
    get cleared() { return cleared; },
    heartbeat() {
      assert(intervalCallback, 'heartbeat callback is unavailable.');
      intervalCallback();
    },
    now: () => now,
    setIntervalFn(callback, milliseconds) {
      assert.equal(milliseconds, 30_000);
      intervalCallback = callback;
      return 71;
    },
  };
}

test('scenario開始・heartbeat・成功と経過秒をstdout用eventへ記録する', async () => {
  const clock = createFakeClock();
  const events = [];
  const updates = [];
  const progress = createScenarioProgress({
    clearIntervalFn: clock.clearIntervalFn,
    heartbeatMs: 30_000,
    logger: (line) => events.push(JSON.parse(line.replace(/^\[voxel-e2e\] /, ''))),
    now: clock.now,
    onUpdate: (snapshot) => updates.push(snapshot),
    setIntervalFn: clock.setIntervalFn,
  });

  const result = await progress.run('production-map', async () => {
    clock.advance(1_250);
    clock.heartbeat();
    clock.advance(750);
    return 'done';
  });

  assert.equal(result, 'done');
  assert.deepEqual(events.map(({ event }) => event), ['started', 'progress', 'succeeded']);
  assert.equal(events[1].elapsedSeconds, 1.25);
  assert.equal(events[2].elapsedSeconds, 2);
  assert.equal(updates.at(-1).lastScenario, 'production-map');
  assert.equal(updates.at(-1).scenarioElapsedSeconds, 2);
  assert.equal(updates.at(-1).scenarioStatus, 'succeeded');
  assert.deepEqual(clock.cleared, [71]);
});

test('scenario失敗をmanifest用snapshotへ残し元の例外を伝播する', async () => {
  const clock = createFakeClock(5_000);
  const events = [];
  const progress = createScenarioProgress({
    clearIntervalFn: clock.clearIntervalFn,
    logger: (line) => events.push(JSON.parse(line.replace(/^\[voxel-e2e\] /, ''))),
    now: clock.now,
    setIntervalFn: clock.setIntervalFn,
  });

  await assert.rejects(
    progress.run('collision', async () => {
      clock.advance(2_345);
      throw new Error('collision failed');
    }),
    /collision failed/,
  );

  assert.deepEqual(events.map(({ event }) => event), ['started', 'failed']);
  assert.equal(events[1].elapsedSeconds, 2.345);
  assert.equal(events[1].error, 'Error: collision failed');
  assert.deepEqual(progress.snapshot(), {
    lastScenario: 'collision',
    scenarioElapsedSeconds: 2.345,
    scenarioResults: [{ elapsedSeconds: 2.345, name: 'collision', status: 'failed' }],
    scenarioStatus: 'failed',
  });
});

test('空名とscenarioの重複実行を開始前に拒否する', async () => {
  const clock = createFakeClock();
  const progress = createScenarioProgress({
    clearIntervalFn: clock.clearIntervalFn,
    logger: () => {},
    now: clock.now,
    setIntervalFn: clock.setIntervalFn,
  });
  await assert.rejects(progress.run('', async () => {}), /name/);

  let releaseFirst;
  const first = progress.run('nonbreak', () => new Promise((resolve) => { releaseFirst = resolve; }));
  await assert.rejects(progress.run('break-red', async () => {}), /already running/);
  releaseFirst();
  await first;
});

import assert from 'node:assert/strict';

/** millisecond差を負値のない小数3桁の秒へ変換する。 */
function toElapsedSeconds(startedAt, currentTime) {
  return Math.round(Math.max(0, currentTime - startedAt)) / 1_000;
}

/** 長時間E2Eのscenario状態をstdoutとmanifest callbackへ同期する。 */
export function createScenarioProgress(options = {}) {
  const {
    clearIntervalFn = clearInterval,
    heartbeatMs = 30_000,
    logger = (line) => console.log(line),
    now = Date.now,
    onUpdate = () => {},
    setIntervalFn = setInterval,
  } = options;
  assert(Number.isFinite(heartbeatMs) && heartbeatMs > 0,
    'scenario heartbeatMs must be finite and positive.');
  assert.equal(typeof logger, 'function', 'scenario logger must be a function.');
  assert.equal(typeof now, 'function', 'scenario clock must be a function.');
  assert.equal(typeof onUpdate, 'function', 'scenario onUpdate must be a function.');

  let activeScenario = null;
  let lastResult = null;
  const scenarioResults = [];

  /** 現在状態をrun manifestへ直接spreadできるplain objectで返す。 */
  function snapshot() {
    if (activeScenario) {
      return {
        lastScenario: activeScenario.name,
        scenarioElapsedSeconds: toElapsedSeconds(activeScenario.startedAt, now()),
        scenarioResults: scenarioResults.map((result) => ({ ...result })),
        scenarioStatus: 'running',
      };
    }
    if (lastResult) {
      return {
        lastScenario: lastResult.name,
        scenarioElapsedSeconds: lastResult.elapsedSeconds,
        scenarioResults: scenarioResults.map((result) => ({ ...result })),
        scenarioStatus: lastResult.status,
      };
    }
    return {
      lastScenario: null,
      scenarioElapsedSeconds: 0,
      scenarioResults: [],
      scenarioStatus: 'idle',
    };
  }

  /** stdout eventとmanifest callbackを同一snapshotから更新する。 */
  function emit(event, details = {}) {
    const current = snapshot();
    logger(`[voxel-e2e] ${JSON.stringify({
      elapsedSeconds: current.scenarioElapsedSeconds,
      event,
      scenario: current.lastScenario,
      ...details,
    })}`);
    onUpdate(current);
  }

  /** 1 scenarioの開始、heartbeat、成功／失敗、経過秒、例外伝播を管理する。 */
  async function run(name, operation) {
    assert(typeof name === 'string' && name.trim().length > 0,
      'scenario name must be a non-empty string.');
    assert.equal(typeof operation, 'function', `${name}: scenario operation must be a function.`);
    assert(activeScenario === null,
      `${name}: scenario ${activeScenario?.name} is already running.`);

    activeScenario = { name, startedAt: now() };
    const startedAt = activeScenario.startedAt;
    emit('started');
    const intervalId = setIntervalFn(() => emit('progress'), heartbeatMs);
    intervalId?.unref?.();
    try {
      let result;
      try {
        result = await operation();
      } catch (error) {
        lastResult = {
          elapsedSeconds: toElapsedSeconds(startedAt, now()),
          name,
          status: 'failed',
        };
        scenarioResults.push(lastResult);
        activeScenario = null;
        const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        emit('failed', { error: errorMessage });
        throw error;
      }
      lastResult = {
        elapsedSeconds: toElapsedSeconds(startedAt, now()),
        name,
        status: 'succeeded',
      };
      scenarioResults.push(lastResult);
      activeScenario = null;
      emit('succeeded');
      return result;
    } finally {
      clearIntervalFn(intervalId);
    }
  }

  return Object.freeze({ run, snapshot });
}

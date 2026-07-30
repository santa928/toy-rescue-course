# 消火放水の寛容な照準判定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 見えている炎の近くでおおむね正面を向いて放水すれば消火でき、背後や範囲外では成功しない寛容な照準判定へ変更する。

**Architecture:** React・Three.js・Rapierへ依存しない`sprayTargeting`で、XZ水平距離7unitと前方60度の対象判定、55%の方向補正を行う。Sceneは建物の代表点とは別の見える炎用照準点を渡し、前方45%・炎方向55%の補正方向を初期接線とするquadratic Bézierで、炎中心の0.55unit手前の明示終点へ収束させる。対象外は既存6unit直線を維持する。既存の`VoxelGameRuntime`、消火時間2.5秒、車両物理、炎と水のpool構造は変更しない。

**Tech Stack:** React 19、TypeScript、React Three Fiber、Three.js、Rapier、Vitest、Playwright、Docker Compose

## Global Constraints

- `REQ-017`だけを変更し、見える炎を基準に水平7unit以内・前方60度以内を対象とする。
- 対象内の水流は、正規化した車両前方45%と炎方向55%を混合して再正規化した方向を初期接線とする。
- `FIRE_SPRAY_TARGET_POSITION`は`[12.9, 1.45, -9.1]`とする。
- `SprayTargetResult.distance`は見える炎の照準点までの3次元直線距離を維持する。
- 対象時の水流はquadratic Bézierで、ノズルから照準点への直線上にある照準点の0.55unit手前へ正確に収束する。判定境界は水平7unitであり、3次元距離へ競合する7unit上限を追加しない。
- 対象外の自由放水は従来どおり6unit直線を維持する。
- `FIRE_POSITION`、有効放水2.5秒、成功演出、自由走行、帰庫再開を変更しない。
- 炎・水の造形、色、instance数、時間変化するanimation、車両物理、collider、HUDを変更しない。対象時の空間経路だけを初期接線と正確な終点の両立に必要な範囲で曲げる。
- キーボードとタッチは同じpureな照準結果を使う。
- 毎frameのReact state更新、Three.js object、物理bodyを追加せず、照準計算のallocation回数を現行より増やさない。
- 開発サーバ、Vitest、build、Playwright E2EはすべてDocker内で実行する。
- 新規または実質改修する関数には、意図・前提・副作用が分かる簡潔なdoc commentを付ける。
- コミットメッセージは日本語にする。

---

## File Structure

### Modify

- `src/voxel-game/domain/sprayTargeting.ts`
  - 水平距離・水平前方角度・55%方向補正を行うpure domain。
- `src/test/sprayTargeting.test.ts`
  - 距離、角度、高低差、補正、対象外、非有限入力の境界テスト。
- `src/voxel-game/scene/worldLayout.ts`
  - 建物用`FIRE_POSITION`と分離した`FIRE_SPRAY_TARGET_POSITION`を定義。
- `src/test/worldLayout.test.ts`
  - 新照準点の正確な座標とworld境界内配置を固定。
- `src/voxel-game/scene/WaterAndFire.tsx`
  - 新照準点の接続、対象時の水流停止offsetと最大表示距離を適用。
- `src/test/waterAndFire.test.ts`
  - Scene統合、対象時7unit、対象外6unit、2.5秒の既存chainを検証。
- `scripts/verify-voxel-game.mjs`
  - 旧6unit境界より寛容な実ブラウザ消火、背後の負例、3 viewportを検証。
- `README.md`
  - fresh unit test件数と消火操作の説明を実測結果へ同期。

### No New Runtime Modules

本修正は既存のpure domainとscene境界で完結する。照準専用class、React context、
新しいphysics body、VFX pool、状態machineは追加しない。

---

### Task 1: Pureな水平照準判定

**Files:**
- Modify: `src/voxel-game/domain/sprayTargeting.ts:1-39`
- Test: `src/test/sprayTargeting.test.ts:1-28`

**Interfaces:**
- Consumes:
  - `resolveSprayTarget(origin, forward, target)`
  - 3要素のreadonly world座標・方向tuple
- Produces:
  - 既存署名`resolveSprayTarget(...): SprayTargetResult`を維持
  - `targeted`: XZ水平距離7unit以内かつXZ前方内積0.5以上
  - `distance`: `origin`から`target`までの3次元直線距離
  - `direction`: 対象内では前方45%・炎方向55%の正規化vector

- [ ] **Step 1: 距離・角度・高低差の失敗テストを書く**

`src/test/sprayTargeting.test.ts`の既存3testを、次の境界を直接固定するtestへ置き換える。

```ts
import { describe, expect, it } from 'vitest';
import { resolveSprayTarget } from '../voxel-game/domain/sprayTargeting';

describe('resolveSprayTarget', () => {
  it('高低差を除いた水平7unit以内だけを照準対象にする', () => {
    const boundary = resolveSprayTarget([0, 3, 0], [0, 0, -1], [0, 1, -7]);
    const outside = resolveSprayTarget([0, 3, 0], [0, 0, -1], [0, 1, -7.001]);

    expect(boundary.targeted).toBe(true);
    expect(boundary.distance).toBeCloseTo(Math.hypot(0, -2, -7), 9);
    expect(outside.targeted).toBe(false);
  });

  it('前方60度を含み、60度を超える火・真横・背後を対象外にする', () => {
    const radius = 6;
    const at60 = Math.PI / 3;
    const beyond60 = at60 + 0.01;

    expect(resolveSprayTarget(
      [0, 1, 0],
      [0, 0, -1],
      [Math.sin(at60) * radius, 1, -Math.cos(at60) * radius],
    ).targeted).toBe(true);
    expect(resolveSprayTarget(
      [0, 1, 0],
      [0, 0, -1],
      [Math.sin(beyond60) * radius, 1, -Math.cos(beyond60) * radius],
    ).targeted).toBe(false);
    expect(resolveSprayTarget([0, 1, 0], [0, 0, -1], [6, 1, 0]).targeted).toBe(false);
    expect(resolveSprayTarget([0, 1, 0], [0, 0, -1], [0, 1, 4]).targeted).toBe(false);
  });

  it('同じXZ条件ならノズルと炎の高低差で対象結果を変えない', () => {
    const level = resolveSprayTarget([0, 1, 0], [0, 0, -1], [2, 1, -5]);
    const lower = resolveSprayTarget([0, 4, 0], [0, 0, -1], [2, 0.5, -5]);

    expect(level.targeted).toBe(true);
    expect(lower.targeted).toBe(level.targeted);
  });
});
```

- [ ] **Step 2: 失敗をDocker内で確認する**

Run:

```bash
docker compose run --rm web npm test -- src/test/sprayTargeting.test.ts
```

Expected:

- 7unit境界testが`targeted: false`でFAILする。
- 60度境界testが内積0.67の現行条件によりFAILする。
- Vitest自体やimport errorではなく、意図したbehavior assertionで失敗する。

- [ ] **Step 3: 補正率・対象外・不正入力の失敗テストを追加する**

同じ`describe`へ次を追加する。

```ts
it('対象の火へ方向を55%補正し、3次元vectorを長さ1へ正規化する', () => {
  const result = resolveSprayTarget([0, 0, 0], [0, 0, -1], [3, 0, -4]);
  const expectedMixed = [0.6 * 0.55, 0, -0.45 - 0.8 * 0.55] as const;
  const expectedLength = Math.hypot(...expectedMixed);

  expect(result.distance).toBe(5);
  expect(result.direction).toEqual([
    expectedMixed[0] / expectedLength,
    0,
    expectedMixed[2] / expectedLength,
  ]);
  expect(Math.hypot(...result.direction)).toBeCloseTo(1, 9);
});

it('対象外では有限な元の前方方向を維持する', () => {
  const forward = [0, 0, -1] as const;

  expect(resolveSprayTarget([0, 0, 0], forward, [0, 0, 8])).toEqual({
    direction: forward,
    distance: 8,
    targeted: false,
  });
});

it.each([
  [[Number.NaN, 0, 0], [0, 0, -1], [0, 0, -3]],
  [[0, 0, 0], [0, 0, 0], [0, 0, -3]],
  [[0, 0, 0], [0, 0, -1], [Number.POSITIVE_INFINITY, 0, -3]],
] as const)('非有限座標またはゼロ長前方を安全に対象外へ倒す', (origin, forward, target) => {
  const result = resolveSprayTarget(origin, forward, target);

  expect(result.targeted).toBe(false);
  expect(result.direction.every(Number.isFinite)).toBe(true);
  expect(Number.isFinite(result.distance)).toBe(true);
});
```

`expectedMixed`は、正規化した炎方向`[0.6, 0, -0.8]`を55%、前方`[0, 0, -1]`を45%
混合した値である。補正率変更がtestをすり抜けないよう、`x > 0`だけではなく正確なvectorを固定する。

- [ ] **Step 4: Pure domainを最小実装する**

`src/voxel-game/domain/sprayTargeting.ts`を次の責務へ更新する。

```ts
/** 放水照準の判定と、sceneへ渡す方向ベクトル。 */
export interface SprayTargetResult {
  readonly direction: readonly [number, number, number];
  readonly distance: number;
  readonly targeted: boolean;
}

const SPRAY_HORIZONTAL_RANGE = 7;
const TARGET_HORIZONTAL_DOT_THRESHOLD = 0.5;
const TARGET_ASSIST_RATIO = 0.55;
const SAFE_FORWARD: readonly [number, number, number] = [0, 0, -1];

/** 3要素vectorがすべて有限かを確認する。 */
function isFiniteVector(value: readonly [number, number, number]): boolean {
  return value.every(Number.isFinite);
}

/**
 * 見える炎が水平7unit・前方60度以内なら対象とし、水流方向を炎側へ55%補正する。
 * 判定の距離と角度はXZ平面、返すdistanceとdirectionは3次元で扱う。
 */
export function resolveSprayTarget(
  origin: readonly [number, number, number],
  forward: readonly [number, number, number],
  target: readonly [number, number, number],
): SprayTargetResult {
  const forwardIsValid = isFiniteVector(forward) && Math.hypot(...forward) > 0;
  const safeForward = forwardIsValid ? forward : SAFE_FORWARD;
  if (!isFiniteVector(origin) || !isFiniteVector(target) || !forwardIsValid) {
    return { direction: safeForward, distance: 0, targeted: false };
  }

  const deltaX = target[0] - origin[0];
  const deltaY = target[1] - origin[1];
  const deltaZ = target[2] - origin[2];
  const distance = Math.hypot(deltaX, deltaY, deltaZ);
  const horizontalDistance = Math.hypot(deltaX, deltaZ);
  const forwardHorizontalLength = Math.hypot(safeForward[0], safeForward[2]);

  if (horizontalDistance === 0 || forwardHorizontalLength === 0) {
    return { direction: safeForward, distance, targeted: false };
  }

  const targetHorizontalX = deltaX / horizontalDistance;
  const targetHorizontalZ = deltaZ / horizontalDistance;
  const forwardHorizontalX = safeForward[0] / forwardHorizontalLength;
  const forwardHorizontalZ = safeForward[2] / forwardHorizontalLength;
  const horizontalDot = (
    forwardHorizontalX * targetHorizontalX
    + forwardHorizontalZ * targetHorizontalZ
  );
  const targeted = (
    horizontalDistance <= SPRAY_HORIZONTAL_RANGE
    && horizontalDot >= TARGET_HORIZONTAL_DOT_THRESHOLD
  );

  if (!targeted) return { direction: safeForward, distance, targeted };

  const targetLength = distance || 1;
  const forwardLength = Math.hypot(...safeForward) || 1;
  const mixedX = safeForward[0] / forwardLength * (1 - TARGET_ASSIST_RATIO)
    + deltaX / targetLength * TARGET_ASSIST_RATIO;
  const mixedY = safeForward[1] / forwardLength * (1 - TARGET_ASSIST_RATIO)
    + deltaY / targetLength * TARGET_ASSIST_RATIO;
  const mixedZ = safeForward[2] / forwardLength * (1 - TARGET_ASSIST_RATIO)
    + deltaZ / targetLength * TARGET_ASSIST_RATIO;
  const mixedLength = Math.hypot(mixedX, mixedY, mixedZ) || 1;

  return {
    direction: [mixedX / mixedLength, mixedY / mixedLength, mixedZ / mixedLength],
    distance,
    targeted,
  };
}
```

- [ ] **Step 5: Pure domain testを通す**

Run:

```bash
docker compose run --rm web npm test -- src/test/sprayTargeting.test.ts
```

Expected: `src/test/sprayTargeting.test.ts`の全testがPASSする。

- [ ] **Step 6: Task 1差分を確認してコミットする**

Run:

```bash
git diff --check
git diff -- src/voxel-game/domain/sprayTargeting.ts src/test/sprayTargeting.test.ts
git status --short
```

Commit:

```bash
git add src/voxel-game/domain/sprayTargeting.ts src/test/sprayTargeting.test.ts
git commit -m "消火放水の照準判定を寛容にする"
```

---

### Task 2: 見える炎の照準点と水流終点

**Files:**
- Modify: `src/voxel-game/scene/worldLayout.ts:20-24`
- Modify: `src/voxel-game/scene/WaterAndFire.tsx:29,95-100,291-320,356-361`
- Test: `src/test/worldLayout.test.ts:1-25`
- Test: `src/test/waterAndFire.test.ts:180-183,261-317`

**Interfaces:**
- Consumes:
  - Task 1の`resolveSprayTarget(origin, forward, target)`
  - 既存`FIRE_POSITION = [12, 1.2, -11]`
- Produces:
  - `FIRE_SPRAY_TARGET_POSITION: readonly [12.9, 1.45, -9.1]`
  - `resolveWaterAndFireFrame(...).targeted`と`sprayOnFire`
  - `createWaterFlowPath(...)`: 対象時は45/55補正を初期接線とし、炎中心の0.55unit手前へ収束
  - `createWaterFlowPath(...)`: 対象外は従来方向へ6unit直線

- [ ] **Step 1: World layout照準点の失敗テストを書く**

`src/test/worldLayout.test.ts`のimportへ`FIRE_SPRAY_TARGET_POSITION`を追加し、
主要地点の境界loopへも含める。さらに次のtestを追加する。

```ts
it('建物の代表位置と分離した見える炎の照準点を固定する', () => {
  expect(FIRE_POSITION).toEqual([12, 1.2, -11]);
  expect(FIRE_SPRAY_TARGET_POSITION).toEqual([12.9, 1.45, -9.1]);
  expect(FIRE_SPRAY_TARGET_POSITION).not.toEqual(FIRE_POSITION);
});
```

- [ ] **Step 2: Scene接続と水流経路の失敗テストを書く**

`src/test/waterFlow.test.ts`へ、45/55補正方向を初期接線として明示終点へ収束するpure numeric testと、
対象外6unit直線のtestを追加する。

```ts
it('targeted pathは45/55補正を初期接線に保ち、炎の0.55unit手前へ収束する', () => {
  const path = createWaterFlowPath({
    initialDirection: approvedCorrectedDirection,
    nozzleOrigin,
    targetPosition,
    targeted: true,
  });
  expect(distance(path.end, targetPosition)).toBeCloseTo(0.55, 12);
  expect(normalize(subtract(path.control, path.start))).toEqual(approvedCorrectedDirection);
});
```

既存の「前方6unit内」testは、見える炎へ少し横にずれた旧条件外の位置を使う。

```ts
it('見える炎から水平7unit内でおおむね正面ならtargetedな消火signalを作る', () => {
  const command = { moveX: 0, moveY: 0, spray: true } as const;
  const forgiving = resolveWaterAndFireFrame(
    {
      forward: [0, 0, -1],
      mass: 1.4,
      position: [15.5, 0.8, -1.2],
      resetCount: 0,
      speed: 0,
    },
    command,
    0.4,
    0.1,
  );
  const outside = resolveWaterAndFireFrame(
    {
      forward: [0, 0, -1],
      mass: 1.4,
      position: [15.5, 0.8, 0],
      resetCount: 0,
      speed: 0,
    },
    command,
  );
  const behind = resolveWaterAndFireFrame(
    {
      forward: [0, 0, 1],
      mass: 1.4,
      position: [15.5, 0.8, -1.2],
      resetCount: 0,
      speed: 0,
    },
    command,
  );

  expect(forgiving).toMatchObject({
    sprayActive: true,
    sprayElapsedSeconds: 0.4,
    sprayOnFire: true,
    splashElapsedSeconds: 0.1,
    targeted: true,
  });
  expect(forgiving.distance).toBeGreaterThan(6);
  expect(outside).toMatchObject({ sprayOnFire: false, targeted: false });
  expect(behind).toMatchObject({ sprayOnFire: false, targeted: false });
});
```

- [ ] **Step 3: Scene関連testが意図した理由で失敗することを確認する**

Run:

```bash
docker compose run --rm web npm test -- src/test/worldLayout.test.ts src/test/waterAndFire.test.ts
```

Expected:

- `FIRE_SPRAY_TARGET_POSITION`のexport不足でFAILする。
- この時点ではworld layoutの不足が最初の意図した失敗になる。Scene境界の失敗は
  Step 4でexportを追加した後、Step 6・7の実装前に同じcommandを再実行して確認する。

- [ ] **Step 4: 見える炎用の照準点を追加する**

`src/voxel-game/scene/worldLayout.ts`の`FIRE_POSITION`直後へ追加する。

```ts
/** 消火判定と水流補正に使う、画面に見える炎の中心位置。 */
export const FIRE_SPRAY_TARGET_POSITION = [12.9, 1.45, -9.1] as const;
```

`FIRE_POSITION`はroute・建物・既存E2E互換のため変更しない。

- [ ] **Step 5: World layout testを通し、Scene testが旧契約で失敗することを確認する**

Run:

```bash
docker compose run --rm web npm test -- src/test/worldLayout.test.ts src/test/waterAndFire.test.ts
```

Expected:

- `worldLayout.test.ts`はPASSする。
- `waterAndFire.test.ts`は旧`FIRE_POSITION`、旧1.9unit offset、旧6unit上限のいずれかを示す
  behavior assertionでFAILする。

- [ ] **Step 6: WaterAndFireを新照準点へ接続する**

importを次へ変える。

```ts
import { FIRE_SPRAY_TARGET_POSITION } from './worldLayout';
```

`resolveWaterAndFireFrame`の呼び出しを変更する。

```ts
const target = resolveSprayTarget(nozzleOrigin, forward, FIRE_SPRAY_TARGET_POSITION);
```

このcomponent内で`FIRE_POSITION`をほかに使っていないことを`rg`で確認し、未使用importを残さない。

- [ ] **Step 7: 対象時曲線と対象外直線のpathを分離する**

pure helperは次の契約にする。

```ts
createWaterFlowPath({
  initialDirection, // 45/55補正済み。control-startをこの方向へ置く
  nozzleOrigin,
  targetPosition,
  targeted,
});
```

対象時の`end`はノズルから照準点への直線上で照準点の0.55unit手前へ置く。判定距離が水平
7unitであるため、3次元距離へ別の7unit上限を加えない。対象外は既存方向への6unit直線とする。
同じ`WaterFlowPath`を`WaterAndFire`描画と`render_game_to_text()`の両方へ渡す。

- [ ] **Step 8: Scene関連testと既存消火chainを通す**

Run:

```bash
docker compose run --rm web npm test -- src/test/worldLayout.test.ts src/test/waterAndFire.test.ts src/test/voxelGameRuntime.test.ts src/test/waterFlow.test.ts
```

Expected:

- 新照準点、対象内曲線の初期接線・正確な終点、対象外6unit直線がPASSする。
- 有効放水2.5秒で`celebrating`へ遷移する既存testがPASSする。
- 固定32 water slot、18 fire slot、hazard lifecycleが後退しない。

- [ ] **Step 9: Task 2差分を確認してコミットする**

Run:

```bash
git diff --check
git diff -- src/voxel-game/scene/worldLayout.ts src/voxel-game/scene/WaterAndFire.tsx src/test/worldLayout.test.ts src/test/waterAndFire.test.ts
git status --short
```

Commit:

```bash
git add src/voxel-game/scene/worldLayout.ts src/voxel-game/scene/WaterAndFire.tsx src/test/worldLayout.test.ts src/test/waterAndFire.test.ts
git commit -m "見える炎へ消火照準を接続する"
```

---

### Task 3: 実ブラウザの寛容判定回帰とリリース検証

**Files:**
- Modify: `scripts/verify-voxel-game.mjs:19-60,787-822,904-1049,2024-2188`
- Modify: `README.md:42-63`

**Interfaces:**
- Consumes:
  - `render_game_to_text()`の`mission.distance`、`mission.targeted`、`mission.sprayOnFire`
  - `advanceTime(milliseconds)`
  - 既存`driveAlongWorldAxis`、`alignWorldCoordinate`、`pulseAlongWorldAxis`
  - Task 2の実scene照準判定
- Produces:
  - `verifyForgivingSprayTargeting(browser, errors)`
  - `desktop-forgiving-spray.png`
  - focused nonbreak/full results内の`forgivingSprayTargeting`
  - fresh unit test件数を反映したREADME

- [ ] **Step 1: 既存E2Eの旧6unit assertionを新契約へ更新する**

`driveMissionToFire`の終端assertionを、表示用3D距離の旧6unit固定から
有限値とtarget状態の契約へ変更する。

```js
const state = await readGameState(page);
assert(Number.isFinite(state.mission.distance) && state.mission.targeted,
  `Fire route did not end targeted: ${JSON.stringify(state.mission)}`);
return state;
```

水平7unit判定そのものはunit testで固定し、E2Eでは実sceneが寛容位置でtargetedになることを
次の独立scenarioで証明する。

- [ ] **Step 2: 寛容な照準と背後の負例を検証するbrowser scenarioを書く**

`verifyCompleteMission`の前へ次の責務を持つ関数を追加する。

```js
/** 旧6unit外の見える炎を前方から消火でき、背後では火勢が減らないことを確認する。 */
async function verifyForgivingSprayTargeting(browser, errors) {
  const target = { hasTouch: false, height: 720, name: 'forgiving-spray', width: 1_280 };
  const { context, page } = await openViewportPage(browser, target, errors);
  try {
    await driveAlongWorldAxis(page, 'positiveZ', (state) => state.vehicle.position[2] >= 16.3,
      'forgiving spray garage opening');
    await driveAlongWorldAxis(page, 'positiveX', (state) => state.vehicle.position[0] >= 11.5,
      'forgiving spray east road');
    await alignWorldCoordinate(page, 0, 15.5, 'forgiving spray X', 0.35);
    await driveAlongWorldAxis(page, 'negativeZ', (state) => state.vehicle.position[2] <= -1.2,
      'forgiving spray old-range exterior');
    await alignWorldCoordinate(page, 2, -1.2, 'forgiving spray Z', 0.25);
    await pulseAlongWorldAxis(page, 'negativeZ', 2);

    const staged = await readGameState(page);
    assert(staged.mission.targeted,
      `Forgiving spray did not acquire visible fire: ${JSON.stringify(staged.mission)}`);
    assert(staged.mission.distance > 6,
      `Forgiving spray did not exercise the old 6-unit exterior: ${staged.mission.distance}`);

    await page.keyboard.down('Space');
    const spraying = await waitForTargetedSpray(page, 'forgiving spray targeted');
    await page.evaluate(() => window.advanceTime?.(500));
    await waitForFrames(page, 2);
    const partiallyExtinguished = await readGameState(page);
    assert(partiallyExtinguished.runtime.fireIntensity < 1,
      'Forgiving spray did not reduce fire intensity.');
    await captureVerifiedScreenshot(page, `${outputDirectory}/desktop-forgiving-spray.png`);
    await page.keyboard.up('Space');

    await pulseAlongWorldAxis(page, 'positiveZ', 3);
    const behind = await readGameState(page);
    assert.equal(behind.mission.targeted, false,
      `Backward spray retained the fire target: ${JSON.stringify(behind.mission)}`);
    const beforeBackwardSpray = behind.runtime.fireIntensity;
    await page.keyboard.down('Space');
    await waitForFrames(page, 2);
    await page.evaluate(() => window.advanceTime?.(500));
    await waitForFrames(page, 2);
    await page.keyboard.up('Space');
    const afterBackwardSpray = await readGameState(page);
    assert.equal(afterBackwardSpray.runtime.fireIntensity, beforeBackwardSpray,
      'Backward spray reduced fire intensity.');

    return {
      backwardTargeted: behind.mission.targeted,
      fireIntensityAfterForwardSpray: partiallyExtinguished.runtime.fireIntensity,
      stagedDistance: staged.mission.distance,
      targeted: spraying.mission.targeted,
    };
  } finally {
    await page.keyboard.up('Space').catch(() => undefined);
    await context.close();
  }
}
```

実装時は、実走時の停止誤差で`distance > 6`へ入らない場合に閾値を削除して通さない。
`vehicle.position`、`mission.distance`、`mission.direction`を失敗ログへ残し、
旧6unit外かつ新水平7unit内になるwaypointを実測して最小調整する。

- [ ] **Step 3: E2E成果物とreportへscenarioを接続する**

`timelineScreenshots`へ追加する。

```js
'desktop-forgiving-spray.png',
```

focused nonbreak pathでは、missionより前に実行し、artifactへ含める。

```js
const forgivingSprayTargeting = await verifyForgivingSprayTargeting(browser, errors);
```

`focused-nonbreak.json`とconsole結果へ`forgivingSprayTargeting`を追加する。

full pathでも同じ関数を1回実行し、最終`report`へ追加する。

```js
let forgivingSprayTargeting;
// ...
forgivingSprayTargeting = await verifyForgivingSprayTargeting(browser, errors);
// ...
const report = {
  // existing fields
  forgivingSprayTargeting,
};
```

- [ ] **Step 4: focused nonbreak E2Eを実行する**

Run:

```bash
docker compose --profile e2e run --rm --build -e VOXEL_GAME_FOCUS=nonbreak voxel-game-e2e
```

Expected:

- `forgivingSprayTargeting.targeted === true`
- `forgivingSprayTargeting.stagedDistance > 6`
- `forgivingSprayTargeting.backwardTargeted === false`
- 前方500msで`fireIntensity < 1`
- 背後500msで`fireIntensity`不変
- console、page、request errorが0件
- `output/voxel-game/focus/nonbreak/desktop-forgiving-spray.png`が生成される

- [ ] **Step 5: focused画像と数値を目視・機械確認する**

Run:

```bash
node -e "const fs=require('fs');const p='output/voxel-game/focus/nonbreak/focused-nonbreak.json';const r=JSON.parse(fs.readFileSync(p,'utf8'));console.log(JSON.stringify({errors:r.errors,forgiving:r.forgivingSprayTargeting},null,2))"
```

上の`node`は成果物の読み取りだけである。プロジェクトのNode実行をホストへ持ち出さないため、
実際には次のDocker commandを使う。

```bash
docker compose run --rm web node -e "const fs=require('fs');const p='output/voxel-game/focus/nonbreak/focused-nonbreak.json';const r=JSON.parse(fs.readFileSync(p,'utf8'));console.log(JSON.stringify({errors:r.errors,forgiving:r.forgivingSprayTargeting},null,2))"
```

目視:

- `output/voxel-game/focus/nonbreak/desktop-forgiving-spray.png`を原寸で開く。
- 水流が見える炎側へ曲がり、炎の大幅な手前または建物内部で止まっていない。
- 消防車、炎、水、mission HUDが重ならず、画面外へはみ出していない。

- [ ] **Step 6: 全unit testとproduction buildをDocker内で実行する**

Run:

```bash
docker compose run --rm web npm test
docker compose run --rm web npm run build
```

Expected:

- 全Vitest testがPASSする。
- `index.html`、`voxel-game.html`、`vehicle-lab.html`を含むbuildが成功する。
- 既知の500kB超chunk warning以外に新しいwarning/errorがない。

- [ ] **Step 7: READMEの操作説明とfresh件数を更新する**

全unit test出力の実測値を使い、`README.md`の検証件数を更新する。推測した件数を書かない。
操作説明へ次の1文を追加する。

```md
炎から約7unit以内でおおむね正面を向いて放水すると、見えている炎へ照準が補助されます。
真横・背後・範囲外からの放水では消火できません。
```

- [ ] **Step 8: canonical full E2Eを実行する**

Run:

```bash
docker compose --profile e2e run --rm --build voxel-game-e2e
```

Expected:

- manifestが`status: completed`、`mode: full`、`full: true`、`error: null`
- `contractFailures: []`
- console/page/request errorが`0/0/0`
- keyboard/touchの消火→成功→自由走行→帰庫再開がPASS
- `desktop-forgiving-spray.png`を含む全必須画像が存在
- Desktop 1280×720、tablet 1024×768、mobile landscape 844×390のlayout assertionがPASS
- Docker rendererがSwiftShaderの場合、fpsは物理GPU性能認証として報告しない

- [ ] **Step 9: canonical代表画像を原寸で目視確認する**

少なくとも次を原寸で開く。

```text
output/voxel-game/desktop-forgiving-spray.png
output/voxel-game/desktop-water-fire.png
output/voxel-game/tablet-landscape-water-fire.png
output/voxel-game/mobile-landscape-water-fire.png
```

各画像で確認する。

- 水流が見える炎へ向かい、着弾飛沫が炎付近にある。
- 炎・水・消防車が同じ純ボクセルの玩具語彙に見える。
- mission、fullscreen、joystick、spray buttonが主要3Dオブジェクトを妨げない。
- 下端・右端・safe areaからはみ出していない。

- [ ] **Step 10: Task 3差分を確認してコミットする**

Run:

```bash
git diff --check
git diff -- scripts/verify-voxel-game.mjs README.md
git status --short
```

Commit:

```bash
git add scripts/verify-voxel-game.mjs README.md
git commit -m "消火照準の実ブラウザ回帰を追加する"
```

---

## Final Verification

- [ ] **Step 1: 最終HEADを記録する**

```bash
git rev-parse HEAD
git status --short --branch
```

Expected: 実装対象のtracked差分がなく、計画外ファイルを変更していない。

- [ ] **Step 2: 最終HEADでfresh unit・buildを再確認する**

```bash
docker compose run --rm web npm test
docker compose run --rm web npm run build
```

- [ ] **Step 3: 最終HEADでfocusedまたはfullの最新manifestを確認する**

```bash
docker compose run --rm web node -e "const fs=require('fs');for(const p of ['output/voxel-game/run-manifest.json','output/voxel-game/results.json']){const r=JSON.parse(fs.readFileSync(p,'utf8'));console.log(p,JSON.stringify(r.run??{status:r.status,mode:r.mode,full:r.full,error:r.error}));if(r.errorCounts)console.log('errorCounts',r.errorCounts);if(r.contractFailures)console.log('contractFailures',r.contractFailures)}"
```

Expected:

- completed/full
- errors 0/0/0
- contractFailures []
- `forgivingSprayTargeting.stagedDistance > 6`
- backwardTargeted false

- [ ] **Step 4: 仕様対応表を確認する**

| 仕様 | 実装・検証 |
| --- | --- |
| 水平7unit以内 | `sprayTargeting.ts` + range boundary unit + browser old-range exterior |
| 前方60度以内 | dot boundary unit + browser backward negative |
| 55%補正 | exact direction unit + quadratic Bézier初期接線unit + water screenshot |
| 見える炎の照準点 | `worldLayout.ts` exact coordinate unit + scene integration |
| 対象時水平7unit・0.55unit手前 | `createWaterFlowPath` endpoint unit + browser水平距離 + screenshot |
| 対象外6unit | `createWaterFlowPath` straight-path unit |
| 消火2.5秒維持 | runtime integration + keyboard/touch full mission |
| HUD・VFX・物理非回帰 | full E2E + 3 viewport screenshot目視 |
| 性能契約 | O(1) pure logic、既存pool維持、物理GPUだけを性能認証 |

- [ ] **Step 5: 完了報告の根拠を限定する**

完了報告には、実際に実行したtest件数、build結果、E2E mode、manifest、error count、
目視した画像だけを書く。Docker SwiftShaderのfpsを性能合格とは書かない。

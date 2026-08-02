# 消防・ブルドーザー おしごと導線修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建物の裏側にある2件目以降の火災へ画面内の案内だけで到達でき、ブルドーザーの同時操作と次のがれきを一目で理解できるようにする。

**Architecture:** 消防はjob定義の12 routeを安全な東→北経路へ修正し、既存route `InstancedMesh`へ6 voxelの矢印を同居させる。ブルドーザーは既存route poolへ4固定slotを足し、snapshotの最初の未完了がれきへ四角い囲いとしてin-place転送する。HUD、scene、`render_game_to_text`、E2Eは同じcoordinator snapshotと実route座標を読む。

**Tech Stack:** React 19、TypeScript 5.9、React Three Fiber、Three.js、Rapier、Vitest、Playwright、Docker Compose

## Global Constraints

- 現行`main`へ実装し、既存の消火判定、ブレード接触判定、自由破壊、仕事抽選、帰庫再開を変更しない。
- 追加draw call 0、Rapier body／collider 0、asset fetch 0。
- 毎frame React state更新、配列生成、Three object生成を追加しない。
- route telemetryは消防12、ブルドーザー7を維持し、target marker数を別フィールドで公開する。
- 開発サーバ、Vitest、build、PlaywrightはDockerコンテナ内で実行する。
- コミットメッセージは日本語にし、意図したファイルだけをstageする。

---

### Task 1: 消防車の北面ルートと立体目印

**Files:**
- Modify: `src/voxel-game/domain/vehicleJobs.ts`
- Modify: `src/voxel-game/scene/WaterAndFire.tsx`
- Modify: `src/voxel-game/VoxelGameApp.tsx`
- Modify: `src/global.d.ts`
- Test: `src/test/vehicleJobs.test.ts`
- Test: `src/test/waterAndFire.test.ts`
- Test: `src/test/voxelGameRenderTelemetry.test.ts`

**Interfaces:**
- Consumes: `FireVehicleJobDefinition.sprayTarget`、`routeMarkers`、`createFireJobSceneLayout(job)`。
- Produces: `FireJobSceneLayout.targetBeaconBoxes`、`guideBoxes`、`VoxelGameTextState.visuals.targetBeaconCubeCount`、`visualLayout.targetBeacon`。

- [ ] **Step 1: 窓火災が東側を迂回して北面へ着く失敗テストを書く**

```ts
const fireBuilding = PRODUCTION_WORLD_MAP.visualBoxes
  .find(({ id }) => id === 'fire-building-body')!;
const eastEdge = fireBuilding.position[0] + fireBuilding.scale[0] / 2;
const northEdge = fireBuilding.position[2] - fireBuilding.scale[2] / 2;

for (const job of VEHICLE_JOBS['fire-truck'].slice(1)) {
  expect(job.routeMarkers.some(([x]) => x >= eastEdge + 3)).toBe(true);
  expect(job.routeMarkers.at(-2)?.[2]).toBeLessThan(northEdge - 3);
  expect(job.routeMarkers.at(-1)).toEqual([
    job.sprayTarget[0],
    0.26,
    job.sprayTarget[2] - 3.4,
  ]);
}
```

- [ ] **Step 2: focused testをDockerで実行し、旧南面routeによるFAILを確認する**

Run: `docker compose run --build --rm web npm test -- src/test/vehicleJobs.test.ts src/test/waterAndFire.test.ts`

Expected: `fire-window-left/right`に北側routeとtarget beaconがなくFAIL。

- [ ] **Step 3: 12点の東→北routeと6 voxel矢印を最小実装する**

```ts
const FIRE_WINDOW_ROUTE_COMMON = PRODUCTION_WORLD_MAP.landmarks.fireRouteMarkers.slice(0, 6);

function createWindowFireRoute([x, , z]: WorldPoint): readonly WorldPoint[] {
  return [
    ...FIRE_WINDOW_ROUTE_COMMON,
    [24, 0.26, 0],
    [30, 0.26, -4],
    [30, 0.26, -12],
    [30, 0.26, -23.5],
    [x, 0.26, -23.5],
    [x, 0.26, z - 3.4],
  ];
}
```

`createFireTargetBeaconBoxes()`は`sprayTarget`から黄色い下向き矢印6個を作り、`createFireJobSceneLayout()`で`guideBoxes = [...routeBoxes, ...targetBeaconBoxes]`を一度だけ作る。`WaterAndFire`は`guideBoxes`を既存1 batchで描画する。

- [ ] **Step 4: text telemetryをrouteとtarget markerへ分離する**

```ts
visualLayout: {
  routeMarkers: fireSceneLayout.routeBoxes,
  targetBeacon: fireSceneLayout.targetBeaconBoxes,
},
visuals: {
  targetBeaconCubeCount: runtime.routeVisible
    ? fireSceneLayout.targetBeaconBoxes.length
    : 0,
},
```

- [ ] **Step 5: focused testを再実行してPASSを確認する**

Run: `docker compose run --build --rm web npm test -- src/test/vehicleJobs.test.ts src/test/waterAndFire.test.ts src/test/voxelGameRenderTelemetry.test.ts`

Expected: 対象suiteが0 failure。

- [ ] **Step 6: Task 1をコミットする**

```bash
git add src/voxel-game/domain/vehicleJobs.ts src/voxel-game/scene/WaterAndFire.tsx src/voxel-game/VoxelGameApp.tsx src/global.d.ts src/test/vehicleJobs.test.ts src/test/waterAndFire.test.ts src/test/voxelGameRenderTelemetry.test.ts
git commit -m "消防車を建物裏の火災まで案内する"
```

### Task 2: ブルドーザーの同時操作文と次対象囲い

**Files:**
- Modify: `src/voxel-game/domain/missionGuidance.ts`
- Modify: `src/voxel-game/scene/bulldozerVfx.ts`
- Modify: `src/voxel-game/scene/BulldozerDebrisMission.tsx`
- Modify: `src/voxel-game/VoxelGameApp.tsx`
- Modify: `src/global.d.ts`
- Test: `src/test/missionGuidance.test.ts`
- Test: `src/test/voxelGameHud.test.tsx`
- Test: `src/test/bulldozerVfx.test.ts`

**Interfaces:**
- Consumes: `BulldozerMissionSnapshot.debris`と`BulldozerVehicleJobDefinition.debris`の同じID順。
- Produces: `BULLDOZER_TARGET_MARKER_SLOT_COUNT = 4`、`BulldozerMissionTelemetry.targetMarkerCount`、`targetMarkerCenter`、`visuals.targetBeaconCubeCount`。

- [ ] **Step 1: 文言と4辺囲いの失敗テストを書く**

```ts
expect(buildMissionGuidance(coordinator.getSnapshot()).instructionLabel)
  .toBe('ブレードをおしながら がれきにぶつかる');

updateBulldozerVfxFrame(frame, snapshot, clearTimes, 0, job);
const markers = frame.routeMarkers.filter(({ active, sourceIndex }) => (
  active && sourceIndex === -2
));
expect(markers).toHaveLength(4);
expect(markers.every(({ position }) => (
  Math.hypot(position[0] - job.debris[0].position[0], position[2] - job.debris[0].position[2]) > 1
))).toBe(true);
```

- [ ] **Step 2: focused testをDockerで実行し、旧文言とmarker不足によるFAILを確認する**

Run: `docker compose run --build --rm web npm test -- src/test/missionGuidance.test.ts src/test/voxelGameHud.test.tsx src/test/bulldozerVfx.test.ts`

Expected: 旧文言が返り、target slotが0個のためFAIL。

- [ ] **Step 3: 4固定slotの囲いを最小実装する**

```ts
export const BULLDOZER_TARGET_MARKER_SLOT_COUNT = 4;
const TARGET_MARKER_OFFSETS = [
  { offset: [0, 0, -1.45], scale: [2.5, 0.12, 0.24] },
  { offset: [0, 0, 1.45], scale: [2.5, 0.12, 0.24] },
  { offset: [-1.45, 0, 0], scale: [0.24, 0.12, 2.5] },
  { offset: [1.45, 0, 0], scale: [0.24, 0.12, 2.5] },
] as const;
```

`createBulldozerVfxFrame()`は7 route slotの後ろへ`sourceIndex=-2`の4 slotを一度だけ確保する。`updateBulldozerVfxFrame()`は最初の未完了snapshotと同じindexのjob debrisを選び、囲い4辺をin-place更新する。全完了、route非表示、別車種では既存hide処理を使う。

- [ ] **Step 4: telemetryとHUD文言を接続する**

`BulldozerDebrisMission`は`sourceIndex === -2`を`targetMarkerCount`、それ以外を`routeMarkerCount`へ数え、4辺のXZ平均を`targetMarkerCenter`へin-placeで保存する。`missionGuidance.ts`のブルドーザー文言を更新し、`VoxelGameApp`は選択車種に応じた実target marker数を`targetBeaconCubeCount`へ出す。

- [ ] **Step 5: focused testを再実行してPASSを確認する**

Run: `docker compose run --build --rm web npm test -- src/test/missionGuidance.test.ts src/test/voxelGameHud.test.tsx src/test/bulldozerVfx.test.ts src/test/voxelGameRenderTelemetry.test.ts`

Expected: 文言、4 marker、最初の片付け後の次対象移動、全完了時非表示が0 failure。

- [ ] **Step 6: Task 2をコミットする**

```bash
git add src/voxel-game/domain/missionGuidance.ts src/voxel-game/scene/bulldozerVfx.ts src/voxel-game/scene/BulldozerDebrisMission.tsx src/voxel-game/VoxelGameApp.tsx src/global.d.ts src/test/missionGuidance.test.ts src/test/voxelGameHud.test.tsx src/test/bulldozerVfx.test.ts src/test/voxelGameRenderTelemetry.test.ts
git commit -m "ブルドーザーの操作と次のがれきを明示する"
```

### Task 3: 実画面の案内を使うE2Eと回帰検証

**Files:**
- Modify: `scripts/voxel-game-e2e/fire-route-plan.mjs`
- Modify: `scripts/voxel-game-e2e/fire-route-plan.node-test.mjs`
- Modify: `scripts/verify-voxel-game.mjs`
- Modify: `scripts/verify-voxel-game-vehicles.mjs`
- Modify: `progress.md`（gitignore対象の作業ログ）

**Interfaces:**
- Consumes: `VoxelGameTextState.visualLayout.routeMarkers`、`targetBeacon`、`visuals.targetBeaconCubeCount`。
- Produces: `createFireRoutePlan(jobId, target, routeMarkers)`。窓火災では実routeの最後2点から`approachStartZ`、`latitudeZ`、`stagingX`を解決する。

- [ ] **Step 1: 旧南面routeを拒否し北面routeを採用するnode testを書く**

```js
const northRoute = [
  [30, 0.26, -23.5],
  [24.8, 0.26, -23.5],
  [24.8, 0.26, -23],
];
const plan = createFireRoutePlan('fire-window-right', [24.8, 1.45, -19.6], northRoute);
assert.equal(plan.latitudeZ, -23);
assert.equal(plan.approachStartZ, -23.5);
assert.equal(plan.stagingX, 24.8);
assert.throws(
  () => createFireRoutePlan('fire-window-right', [24.8, 1.45, -19.6], [[26, 0.26, -15]]),
  /north of target/,
);
```

- [ ] **Step 2: node testをDockerで実行し、旧helperが3引数目を検証しないFAILを確認する**

Run: `docker compose run --build --rm web node --test scripts/voxel-game-e2e/fire-route-plan.node-test.mjs`

Expected: 南面routeを拒否せずFAIL。

- [ ] **Step 3: E2Eを実route telemetry由来へ変更する**

`driveMissionToFire()`、`driveMissionBackToGarage()`、火災hazard再開検証の全`createFireRoutePlan()`呼び出しへ`state.visualLayout.routeMarkers.map(({ position }) => position)`を渡す。窓火災では東道路を`approachStartZ`まで北上し、target Xへ移動してから`latitudeZ`へ南進させ、画面の最後2 markerと同じ順序で火を向かせる。消防2周のcycle 2到着時に`desktop-second-fire-wayfinding.png`を保存し、target beacon 6個と案内座標一致をassertする。

ブルドーザーE2Eは選択直後と1個片付け後に`targetBeaconCubeCount === 4`、`targetMarkerCenter`のXZと`mission.guidance.targetPosition`のXZ一致、3個完了後に0をassertし、Desktop／Tablet／Mobileの対象囲い画像を保存する。

- [ ] **Step 4: focused E2EをDockerで実行する**

Run: `VOXEL_GAME_FOCUS=nonbreak docker compose --profile e2e run --build --rm voxel-game-focus-e2e`

Run: `docker compose --profile e2e run --build --rm voxel-game-vehicles-e2e`

Expected: 消防2周とブルドーザー3対象が全viewportで0 error。

- [ ] **Step 5: Playwright skill clientでも短い入力burstとtext stateを確認する**

Run: `docker compose up -d web`

Run: `docker compose --profile e2e run --rm -v /Users/santa/.codex/skills/develop-web-game:/codex-skill:ro voxel-game-e2e node /codex-skill/scripts/web_game_playwright_client.js --url http://web:5173/?job-seed=1 --actions-json '{"steps":[{"buttons":["right"],"frames":8},{"buttons":[],"frames":8}]}' --iterations 1 --pause-ms 250`

Expected: screenshotと`render_game_to_text`が生成され、console error 0。

- [ ] **Step 6: 代表画像を原寸目視し、DOM境界も数値確認する**

消防2件目の矢印が屋根より上、ブルドーザー囲いががれき四周、HUD・ミニマップ・操作UIが8px以上離れていることをDesktop 1280×720、Tablet 1024×768、Mobile landscape 844×390で確認する。

- [ ] **Step 7: full unitとproduction buildをDockerで実行する**

Run: `docker compose run --build --rm web npm test`

Run: `docker compose run --build --rm web npm run build`

Expected: Vitest 0 failure、TypeScript 0 error、全bundle budget内。

- [ ] **Step 8: Task 3をコミットする**

```bash
git add scripts/voxel-game-e2e/fire-route-plan.mjs scripts/voxel-game-e2e/fire-route-plan.node-test.mjs scripts/verify-voxel-game.mjs scripts/verify-voxel-game-vehicles.mjs
git commit -m "実際の仕事案内でミッションを完走検証する"
```

### Task 4: セキュリティ確認とmain push

**Files:**
- Review only: `origin/main..HEAD`の全送信差分

**Interfaces:**
- Consumes: Task 1〜3のコミット、Docker検証証跡。
- Produces: `origin/main`と一致するlocal HEAD、ahead／behind `0/0`。

- [ ] **Step 1: worktreeと全送信差分を確認する**

Run: `git status -sb`

Run: `git diff --check origin/main..HEAD`

Run: `git diff --stat origin/main..HEAD`

- [ ] **Step 2: staged差分と送信rangeを秘密情報パターンでscanする**

Run: `git diff --cached -U0 | rg -n -i '(api[_-]?key|secret|token|password|passwd|client_secret|private_key)'`

Run: `git diff origin/main..HEAD -U0 | rg -n -i '(api[_-]?key|secret|token|password|passwd|client_secret|private_key|-----BEGIN [A-Z ]*PRIVATE KEY-----|A(KIA|SIA)[0-9A-Z]{16}|https?://[^/\\s:]+:[^/\\s@]+@)'`

Run: `git diff --name-only origin/main..HEAD | rg -n '(?i)(\\.env|\\.pem|\\.key|\\.p12|\\.pfx|\\.jks|id_rsa|id_dsa|id_ecdsa)'`

Expected: 疑わしい一致0。誤検知は内容を確認し、秘密でない根拠を残す。

- [ ] **Step 3: mainをpushしremote SHAを照合する**

Run: `git push origin main`

Run: `git ls-remote origin refs/heads/main`

Run: `git rev-list --left-right --count origin/main...HEAD`

Expected: remote SHAと`git rev-parse HEAD`が一致し、ahead／behindが`0 0`。

- [ ] **Step 4: Goalをcompleteにする**

検証、push、remote同期、worktree cleanの全証跡が揃った後だけ`update_goal({ status: "complete" })`を実行する。

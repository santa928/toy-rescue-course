# District Streetscape Decoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 7地区を床色と街角セットだけで識別できるようにし、既存の道路・15仕事・車両物理・HUDを変えず、性能予算内でGitHub Pagesへ公開する。

**Architecture:** `ProductionWorldMapDefinition`へtypedな`surfaceTiles`と`decorationClusters`を追加し、描画・衝突・telemetry・検証を同じcanonical dataから生成する。床は`instanceColor`付き単一`InstancedMesh`、装飾は既存の色別box batch、solidだけは既存と合わせた単一fixed Rapier bodyへ接続する。被覆率・安全余白・数上限はpure helperで起動時とunit testの両方から検証する。

**Tech Stack:** React 19、TypeScript、React Three Fiber、Three.js、Rapier、Vitest、Playwright、Docker Compose、Vite、GitHub Actions／Pages

## Global Constraints

- REQ-001〜REQ-079を維持し、道路幅、15仕事、車両物理、仕事座標、自由走行、色遊び、積み木破壊、カメラ、HUDを変更しない。
- REQ-080〜REQ-087を受け入れ条件にする。7地区の道路外被覆率70%以上、入口サイン、各地区2〜4群、硬い大物だけsolid、safe clearance、canonical data、21画像、性能上限を満たす。
- `surfaceTiles`は全て非solidかつ道路上面より下に置き、1 draw callで描く。`decorationClusters`は既存paletteへ統合し、新規draw call増加を2以下に抑える。
- static colliderは既存27を含め40以下、fixed bodyは1、完成sceneは34 calls以下。追加asset fetchと毎frame React state更新を増やさない。
- 実行・検証は全てDockerコンテナ内で行う。ホストでは読み取り、`apply_patch`、Git操作だけを行う。
- 各実装タスクはRED→GREEN→関連回帰のTDDで完了し、日本語コミットを作る。`main` push前にstaged差分と`origin/main..HEAD`全体をsecret scanする。

---

## Task 1: typed surface／decoration契約とpure validationを追加する

**Files:**

- Create: `src/voxel-game/scene/worldStreetscape.ts`
- Modify: `src/voxel-game/scene/productionWorldMap.ts`
- Create: `src/test/worldStreetscape.test.ts`
- Modify: `src/test/productionWorldMap.test.ts`

- [ ] **Step 1: surface／clusterのtyped contractを要求する失敗testを書く**

`src/test/worldStreetscape.test.ts`で次を先に要求する。

```ts
expect(PRODUCTION_WORLD_MAP.surfaceTiles.map(({ districtId }) => districtId))
  .toEqual(expect.arrayContaining(PRODUCTION_WORLD_MAP.districts.map(({ id }) => id)));
expect(PRODUCTION_WORLD_MAP.decorationClusters).toHaveLength(21);
expect(countDecorationClustersByDistrict(PRODUCTION_WORLD_MAP.decorationClusters))
  .toEqual({ hub: 2, park: 3, fire: 3, blocks: 3, south: 3, construction: 3, town: 4 });
```

`src/test/productionWorldMap.test.ts`では旧地面5件が`visualBoxes`から消え、同じIDで`surfaceTiles`へ移ることを要求する。

- [ ] **Step 2: REDをDocker内で確認する**

Run:

```sh
docker compose run --rm web npm test -- --run src/test/worldStreetscape.test.ts src/test/productionWorldMap.test.ts
```

Expected: `surfaceTiles`、`decorationClusters`、helper未定義でFAIL。

- [ ] **Step 3: contractとpure helperの最小実装を追加する**

`productionWorldMap.ts`へ以下の公開型を追加する。

```ts
export interface WorldSurfaceTileDefinition {
  readonly color: string;
  readonly districtId: WorldDistrictId;
  readonly id: string;
  readonly position: WorldPoint;
  readonly scale: WorldPoint;
}

export interface WorldDecorationClusterDefinition {
  readonly boxes: readonly WorldBoxDefinition[];
  readonly districtId: WorldDistrictId;
  readonly id: string;
  readonly purpose: string;
}
```

`ProductionWorldMapDefinition`へ`surfaceTiles`と`decorationClusters`を追加する。`worldStreetscape.ts`へ次のpure APIをdocstring付きで追加する。

```ts
export const WORLD_SURFACE_MAX_TOP_Y = 0.08;
export const WORLD_MIN_NON_ROAD_COVERAGE = 0.7;
export const WORLD_MAX_STATIC_COLLIDERS = 40;

export function flattenDecorationBoxes(
  clusters: readonly WorldDecorationClusterDefinition[],
): readonly WorldBoxDefinition[];

export function countDecorationClustersByDistrict(
  clusters: readonly WorldDecorationClusterDefinition[],
): Readonly<Record<WorldDistrictId, number>>;

export function calculateDistrictNonRoadSurfaceCoverage(
  district: WorldDistrictDefinition,
  roads: readonly WorldRoadDefinition[],
  surfaces: readonly WorldSurfaceTileDefinition[],
): number;

export function validateWorldStreetscape(
  map: ProductionWorldMapDefinition,
): readonly string[];
```

被覆率はdistrict内の0.5unit格子点を決定的にsamplingし、road内点を母数から除外して、surface内点の比率を返す。box境界はfull scaleのhalf extentsで計算し、回転したboxは未対応としてvalidatorで拒否しない代わりに今回のsurfaceにはrotationを持たせない。

- [ ] **Step 4: validationの失敗契約をtestで固定する**

重複ID、NaN、非正scale、world外、地区外、surface上面超過、70%未満、地区ごと1群／5群、新solidの道路1.6unit拡張領域侵入、車庫入口・color trigger 1.5unit侵入、palette外、合計collider 41以上を個別fixtureで検証し、error文字列へ対象IDを含める。

`validateProductionWorldMap()`から`validateWorldStreetscape()`を呼び、起動guardも同じ失敗を返す。

- [ ] **Step 5: canonical dataを追加しGREENにする**

7地区へ基底タイル＋4unit以上間隔の模様を追加し、承認paletteを使う。

```ts
const WORLD_SURFACE_PALETTE = {
  hub: ['#dfcda8', '#f6e8c9'], park: ['#91bd70', '#b9d798'],
  fire: ['#d99275', '#efb7a3'], blocks: ['#d8ba76', '#f2d995'],
  south: ['#82b8d7', '#aed5e9'], construction: ['#d5b468', '#a9adb3'],
  town: ['#d7d0b9', '#eee7d2'],
} as const;
```

基底タイルは各district boundsを覆い、`position[1]=0.025`、`scale[1]=0.05`とする。模様上面は`0.08`以下にする。旧`park-ground`、`block-plaza-ground`、`construction-ground`、`town-green-west`、`town-green-east`は同IDでsurfaceへ移す。

21群を設計書どおり2/3/3/3/3/3/4で定義する。花、コーン、看板板、旗布、生垣葉は`solid:false`、街灯柱、ベンチ本体、柵支柱、消火栓、大きなバリケード支柱だけを`solid:true`にし、追加solidは13以下とする。装飾色は既存`visualBoxes`のpaletteだけを使う。

- [ ] **Step 6: GREENと関連回帰を確認する**

Run:

```sh
docker compose run --rm web npm test -- --run src/test/worldStreetscape.test.ts src/test/productionWorldMap.test.ts src/test/vehicleJobs.test.ts
```

Expected: 全PASS、7地区coverage≥0.7、cluster 21、new solid≤13。

- [ ] **Step 7: Task 1をコミットする**

```sh
git add src/voxel-game/scene/worldStreetscape.ts src/voxel-game/scene/productionWorldMap.ts src/test/worldStreetscape.test.ts src/test/productionWorldMap.test.ts
git commit -m "地区床と街角装飾の共有定義を追加する"
```

---

## Task 2: 15仕事targetを新solidの安全余白へ接続する

**Files:**

- Modify: `src/voxel-game/vehicleJobs.ts`
- Modify: `src/test/vehicleJobs.test.ts`

- [ ] **Step 1: 15仕事targetと新solidの1.5unit clearanceを要求する失敗testを書く**

全`VEHICLE_JOB_DEFINITIONS`のtarget/targetRadiusに対し、`flattenDecorationBoxes(...).filter(solid)`とのXZ分離を検証する。違反fixtureではcluster box IDとjob IDがerrorへ出ることを要求する。

- [ ] **Step 2: REDをDocker内で確認する**

Run:

```sh
docker compose run --rm web npm test -- --run src/test/vehicleJobs.test.ts
```

Expected: job safety validator未接続でFAIL。

- [ ] **Step 3: pure job safety validationを実装する**

`vehicleJobs.ts`へdocstring付きで次を追加し、既存`validateVehicleJobs()`へ統合する。

```ts
export function validateDecorationClearanceFromVehicleJobs(
  jobs: readonly VehicleJobDefinition[],
  decorationBoxes: readonly WorldBoxDefinition[],
  clearance = 1.5,
): readonly string[];
```

target円へboxのhalf extentsとclearanceを足し、XZの最近接点距離で判定する。循環依存を避けるため、`productionWorldMap.ts`側から仕事定義をimportしない。

- [ ] **Step 4: GREENと全仕事回帰を確認する**

Run:

```sh
docker compose run --rm web npm test -- --run src/test/vehicleJobs.test.ts src/test/jobDeck.test.ts src/test/vehicleMissionCoordinator.test.ts
```

Expected: 15仕事とrandom progressionを含め全PASS。

- [ ] **Step 5: Task 2をコミットする**

```sh
git add src/voxel-game/vehicleJobs.ts src/test/vehicleJobs.test.ts
git commit -m "街角装飾を仕事経路の安全検証へ接続する"
```

---

## Task 3: surface 1 batch描画・装飾batch・単一fixed colliderを実装する

**Files:**

- Modify: `src/voxel-game/scene/VoxelWorld.tsx`
- Modify: `src/voxel-game/scene/worldCollisionLayout.ts`
- Modify: `src/test/productionWorldRender.test.ts`
- Modify: `src/test/worldCollisionLayout.test.ts`

- [ ] **Step 1: 描画と物理の失敗testを書く**

`productionWorldRender.test.ts`で次を要求する。

- surface専用componentが1回だけ接続され、`PRODUCTION_WORLD_MAP.surfaceTiles`を全件受け取る。
- visual batchには`visualBoxes`とflatten済み装飾boxが参照欠落なく1回ずつ含まれる。
- surface palette色数にdraw callが比例しない。

`worldCollisionLayout.test.ts`で`WORLD_SOLID_BOXES`がlegacy solid＋new decoration solidに一致し、40以下、`WorldSolidColliders`が単一fixed bodyと同数colliderを構成することを要求する。

- [ ] **Step 2: REDをDocker内で確認する**

Run:

```sh
docker compose run --rm web npm test -- --run src/test/productionWorldRender.test.ts src/test/worldCollisionLayout.test.ts
```

Expected: surface batch未接続、装飾box未描画、collider数不一致でFAIL。

- [ ] **Step 3: 単一surface batchと統合box batchesを実装する**

`VoxelWorld.tsx`へ`InstancedSurfaceTiles`を追加し、mount/layout更新時だけmatrixとinstance colorを設定する。

```ts
function InstancedSurfaceTiles({ tiles }: {
  readonly tiles: readonly WorldSurfaceTileDefinition[];
}): ReactElement {
  // setMatrixAt と setColorAt をuseLayoutEffect内で1回実行する。
}
```

`WORLD_RENDER_BOXES = [...visualBoxes, ...flattenDecorationBoxes(decorationClusters)]`をmodule初期化時に1回だけ作り、`groupWorldBoxesByColor()`へ渡す。新しい毎frame allocationやstate更新は作らない。描画順はground→surface→road→marking→visual/decoration→colliderとし、roadを床より上へ維持する。

- [ ] **Step 4: 単一fixed colliderへ統合する**

`worldCollisionLayout.ts`の`WORLD_SOLID_BOXES`をlegacy visual solid＋decoration solidから生成する。`TREE_TRUNKS`等の既存ID lookup契約は維持し、index依存testだけをID比較へ直す。`WorldSolidColliders`自体は1個の`RigidBody type="fixed"`を維持する。

- [ ] **Step 5: GREENと描画／物理回帰を確認する**

Run:

```sh
docker compose run --rm web npm test -- --run src/test/productionWorldRender.test.ts src/test/worldCollisionLayout.test.ts src/test/productionWorldMap.test.ts
```

Expected: 全PASS、surface batch 1、static collider≤40、fixed body 1。

- [ ] **Step 6: Task 3をコミットする**

```sh
git add src/voxel-game/scene/VoxelWorld.tsx src/voxel-game/scene/worldCollisionLayout.ts src/test/productionWorldRender.test.ts src/test/worldCollisionLayout.test.ts
git commit -m "地区床と街角装飾を描画と物理へ接続する"
```

---

## Task 4: world telemetryと型契約を同期する

**Files:**

- Modify: `src/global.d.ts`
- Modify: `src/voxel-game/VoxelGameApp.tsx`
- Modify: `src/test/voxelGameRenderTelemetry.test.ts`

- [ ] **Step 1: telemetry countを要求する失敗testを書く**

`buildWorldTelemetry()`が`render_game_to_text()`へ渡す`world`へ以下4件を要求する。

```ts
expect(payload.world).toMatchObject({
  surfaceTileCount: PRODUCTION_WORLD_MAP.surfaceTiles.length,
  decorationClusterCount: PRODUCTION_WORLD_MAP.decorationClusters.length,
  decorationBoxCount: flattenDecorationBoxes(PRODUCTION_WORLD_MAP.decorationClusters).length,
  staticColliderCount: WORLD_SOLID_BOXES.length,
});
```

- [ ] **Step 2: REDをDocker内で確認する**

Run:

```sh
docker compose run --rm web npm test -- --run src/test/voxelGameRenderTelemetry.test.ts
```

Expected: 4 count未定義でFAIL。

- [ ] **Step 3: telemetryの型とbuilderをcanonical countへ接続する**

`src/global.d.ts`の`VoxelGameTextState['world']`へ4つの`number`を追加する。`buildWorldTelemetry()`はcanonical arraysと`WORLD_SOLID_BOXES`だけからcountを生成し、手書き定数を持たない。HUD表示と文言は変更しない。

- [ ] **Step 4: GREENとapp回帰を確認する**

Run:

```sh
docker compose run --rm web npm test -- --run src/test/voxelGameRenderTelemetry.test.ts src/test/voxelGameRuntime.test.ts
```

Expected: 全PASS。

- [ ] **Step 5: Task 4をコミットする**

```sh
git add src/global.d.ts src/voxel-game/VoxelGameApp.tsx src/test/voxelGameRenderTelemetry.test.ts
git commit -m "地区装飾の状態をゲームtelemetryへ公開する"
```

---

## Task 5: 7地区×3 viewportの専用E2Eと21画像証跡を追加する

**Files:**

- Create: `scripts/verify-voxel-game-streetscape.mjs`
- Modify: `docker-compose.yml`
- Modify: `.gitignore` only if the existing `output/` rule is absent

- [ ] **Step 1: 既存map harnessを再利用する専用E2Eを書く**

`scripts/verify-voxel-game-streetscape.mjs`へDesktop 1280×720、Tablet 1024×768、Mobile landscape 844×390と7地区のrepresentative poseを定義する。各組み合わせでcache-busting queryを付け、`render_game_to_text()`から次を検証する。

- `currentDistrict`が期待地区。
- `surfaceTileCount`、`decorationClusterCount=21`、`staticColliderCount<=40`が描画定義と一致。
- telemetry `render.calls<=34`。
- console/page/request errorが0。
- mission、selector、fullscreen、audio、joystick／keyboard案内がviewport内に収まり、Canvas主要領域を遮らない。

各地区×viewportを`output/voxel-game-streetscape/<viewport>-<district>.png`へfull-page screenshotとして出力し、manifest JSONへviewport、district、HUD bounds、counts、errorsを保存する。

- [ ] **Step 2: solid collisionとnon-solid通過をE2Eへ追加する**

既存drive harnessを使い、代表の追加solid 1件へ車両が侵入しないこと、コーンまたは入口模様のnon-solid 1件を通過できることをdesktopで数値検証する。15仕事、既存solid、色遊びは専用既存E2Eを回帰gateとして後段で実行する。

- [ ] **Step 3: Docker Compose serviceを追加する**

`voxel-game-streetscape-e2e`を追加する。`npm run build`→`npm run preview -- --host 127.0.0.1`→専用scriptの順で実行し、outputだけをbind mountする。

- [ ] **Step 4: 3 viewportを分割実行し21画像を作る**

Run:

```sh
VOXEL_GAME_STREETSCAPE_VIEWPORT=desktop docker compose --profile e2e run --rm voxel-game-streetscape-e2e
VOXEL_GAME_STREETSCAPE_VIEWPORT=tablet docker compose --profile e2e run --rm voxel-game-streetscape-e2e
VOXEL_GAME_STREETSCAPE_VIEWPORT=mobile-landscape docker compose --profile e2e run --rm voxel-game-streetscape-e2e
```

Expected: 各7画像、合計21画像、manifest PASS、error 0。

- [ ] **Step 5: 21画像を原寸目視し数値boundsを照合する**

各画像で固有床と最低1つの入口／街角装飾が見え、広い木色面、道路の隠れ、装飾見切れ、HUD重なり、操作阻害がないことを目視する。問題があればcanonical座標だけを修正してunit＋該当viewport E2Eを再実行する。

- [ ] **Step 6: Task 5をコミットする**

```sh
git add scripts/verify-voxel-game-streetscape.mjs docker-compose.yml
git commit -m "全地区の街角装飾E2Eを追加する"
```

`output/`は既存のignore対象なので画像証跡はcommitしない。

---

## Task 6: 文書同期・全回帰・bundle／物理GPU・push／Pages公開を完了する

**Files:**

- Modify: `README.md`
- Modify: `docs/design/2026-08-02-district-streetscape-decoration-design.md`
- Modify: `docs/plans/2026-08-02-district-streetscape-decoration-plan.md`
- Modify: `progress.md` only if it remains ignored

- [ ] **Step 1: READMEと設計状態を実装済みに同期する**

READMEへ7地区の床色・入口・街角装飾、操作を塞がないsolid方針、`voxel-game-streetscape-e2e`の実行方法を追記する。設計書の状態を「実装・検証済み」へ更新し、実測値だけを記録する。plan checkboxとignored `progress.md`へ実行結果を反映する。

- [ ] **Step 2: fresh full unitとPages base付きbudget buildをDocker内で実行する**

Run:

```sh
docker compose run --rm web npm test -- --run
docker compose run --rm -e GITHUB_PAGES=true web npm run build
```

Expected: 全unit PASS。game entry≤350kB、通常chunk≤600kB、Three≤750kB、Rapier≤2.25MB。

- [ ] **Step 3: 既存E2E回帰をDocker内で実行する**

Run:

```sh
docker compose --profile e2e run --rm production-smoke-e2e
docker compose --profile e2e run --rm voxel-game-e2e
docker compose --profile e2e run --rm voxel-game-map-e2e
docker compose --profile e2e run --rm voxel-game-vehicles-e2e
docker compose --profile e2e run --rm voxel-game-colors-e2e
docker compose --profile e2e run --rm voxel-game-audio-e2e
```

Expected: 3入口、15仕事、帰庫、乗り換え、色遊び、積み木破壊、既存collision、audioが全PASS。cache-busting URLを使用する。

- [ ] **Step 4: Apple M4物理GPUで全5車種を再認証する**

Chrome実機で`?gpu-cert=<timestamp>`を付け、fire-truck、bulldozer、excavator、forklift、dump-truckを各1280×720で測定する。各median≥55fps、p10≥45fps、scene calls≤34、console/page/request error 0を記録する。Docker SwiftShaderの数値を認証値に使わない。

- [ ] **Step 5: 文書同期を日本語コミットする**

```sh
git add README.md docs/design/2026-08-02-district-streetscape-decoration-design.md docs/plans/2026-08-02-district-streetscape-decoration-plan.md
git commit -m "地区床と街角装飾の検証結果を記録する"
```

- [ ] **Step 6: push前security gateを実行する**

`pre-push-security-check`に従い、少なくとも次を確認する。

```sh
git status --short --branch
git diff --cached --check
git diff --check origin/main..HEAD
git diff --name-only origin/main..HEAD
rg -n --hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!output/**' '(BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})' .
git log --oneline origin/main..HEAD
```

Expected: secret 0、意図外ファイル0、whitespace error 0、日本語の論理commitのみ。

- [ ] **Step 7: mainをpushする**

```sh
git push origin main
```

Expected: remote更新成功。PRは作成しない。

- [ ] **Step 8: remote SHA・Actions／Pages・公開URLを確認する**

```sh
git ls-remote --heads origin main
git rev-list --left-right --count origin/main...HEAD
gh run list --branch main --limit 5
```

Pages workflowの成功を待ち、公開URLをcache-busting付きで検証する。

- `https://santa928.github.io/toy-rescue-course/?verify=<sha>`
- `https://santa928.github.io/toy-rescue-course/voxel-game.html?verify=<sha>`
- `https://santa928.github.io/toy-rescue-course/vehicle-lab.html?verify=<sha>`

公開gameで3入口、7地区count、代表地区装飾、console/page/request error 0を確認する。remote SHAがlocal HEADと一致し、ahead/behindが`0 0`になるまで完了扱いにしない。

- [ ] **Step 9: goalをcompleteにする**

全受け入れ条件と公開確認が完了した後だけ`update_goal(status="complete")`を呼び、最終報告へcommit、remote SHA、Pages run、公開URL、unit／E2E／GPU実測値を記載する。

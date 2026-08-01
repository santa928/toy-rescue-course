# bundle・Vitest・E2E最適化 Implementation Plan

> 実行方式: `superpowers:executing-plans`と`refactoring`でmain上を1 TaskずつTDD実装する。
> 各Taskは日本語commit、全範囲secret scan、origin/main push、remote SHA 0/0、Actions／Pages確認で閉じる。

**Goal:** 公開挙動を変えず、bundle境界、Vitest探索、長時間E2Eの責務と診断性を改善する。

**Architecture:** pure vendor resolver＋build budget verifier、Vitest明示除外、依存注入型drive harness、
feature固有scenarioの4層に分ける。

**Tech Stack:** TypeScript, Vite, Vitest, Node.js, Playwright, Docker Compose。

## Global Constraints

- npm／test／build／dev serverはDocker内だけで実行する。
- runtime、scene、CSS、物理、telemetryの公開契約を変更しない。
- REDはchunk未分割、worktree test誤収集、shared helper不存在、scenario時間未記録を具体assertで確認する。
- E2E assertion削除、timeout拡大だけの修正、renderer warningを隠すだけの修正は禁止する。
- `progress.md`と`output/`はgit管理しない。

## Task 1: 設計・基準値

**Files:**
- Create: `docs/design/2026-08-01-tooling-and-e2e-optimization-design.md`
- Create: `docs/plans/2026-08-01-tooling-and-e2e-optimization-plan.md`
- Modify: `progress.md`（git管理外）

- [x] 32 files／303 tests、build 637 modules／10.88秒、chunk 2.35MB／1.08MBを記録する。
- [x] REQ-038〜REQ-045、差分、受け入れ条件、非対象、リスク、性能目標を定義する。
- [x] `最適化の設計と基準値を定義する`でcommit・scan・push・公開確認する。

## Task 2: Vitest探索をworktree安全にする

**Files:**
- Modify: `vite.config.ts`
- Modify: `tsconfig.node.json`
- Create: `tooling/vitestDiscovery.ts`
- Create: `tooling/vitestDiscovery.test.ts`

- [x] RED: Vitest設定が`.worktrees`を除外していないassertを確認する。
- [x] `configDefaults.exclude`を維持し、`**/.worktrees/**`を追加する。
- [x] root testは一致し、worktree fixture pathは一致しないpure matcherを実装する。
- [x] focused/full unitをDocker内で通し、既存32 files／303 testsと新規2 testsを一度ずつ維持する。
- [x] toolingを`tsconfig.node`境界へ置き、production buildを通す。
- [x] `Vitestのworktree重複収集を防ぐ`でcommit・scan・push・公開確認する。

## Task 3: production bundleを責務分割する

**Files:**
- Create: `tooling/vendorChunk.ts`
- Create: `tooling/vendorChunk.test.ts`
- Create: `scripts/verify-build-budgets.mjs`
- Create: `scripts/verify-build-budgets.node-test.mjs`
- Create: `scripts/verify-production-entrypoints.mjs`
- Modify: `vite.config.ts`
- Modify: `package.json`
- Modify: `docker-compose.yml`
- Modify: `README.md`

- [x] RED: package ID分類、必須chunk、entry／vendor／Rapier予算の失敗を確認する。
- [x] `manualChunks`をpure resolverへ接続し、manifestを生成する。
- [x] build後budget検査を`npm run build`の`postbuild`へ接続する。
- [x] game entry 350kB以下、通常chunk 600kB以下、Three 750kB以下、Rapier 2.25MB以下を達成する。
- [x] 3 entryのasset URLとroot／互換URL／Vehicle Lab smokeを確認する。
- [x] `production bundleを責務別に分割する`でcommit・scan・push・公開確認する。

## Task 4: 共有drive harnessをTDD実装する

**Files:**
- Create: `scripts/voxel-game-e2e/drive-harness.mjs`
- Create: `scripts/voxel-game-e2e/drive-harness.node-test.mjs`
- Modify: `scripts/verify-voxel-game.mjs`
- Modify: `scripts/verify-voxel-game-vehicles.mjs`
- Modify: `scripts/verify-voxel-game-colors.mjs`

- [x] RED: world軸、pulse frame、有限座標、reset伝播、入力cleanupをpure／fake page testで固定する。
- [x] frame、state、keyboard、DOM touch、brake、drive、pulse、alignを共有moduleへ実装する。
- [x] canonicalはCDP同時touch driverを維持し、共有drive APIだけを使う。
- [x] 二車種と色替えから重複helperを削除し、feature固有assertを残す。
- [x] node test、focus、二車種、色替えE2Eを通す。
- [x] `E2Eの走行harnessを共有する`でcommit・scan・push・公開確認する。

## Task 5: focus責務と進捗記録を分離する

**Files:**
- Create: `scripts/voxel-game-e2e/scenario-progress.mjs`
- Create: `scripts/voxel-game-e2e/scenario-progress.node-test.mjs`
- Modify: `scripts/verify-voxel-game.mjs`
- Modify: `docker-compose.yml`
- Modify: `README.md`

- [ ] RED: scenario開始／成功／失敗／経過秒が記録されないことを確認する。
- [ ] production-map、nonbreak、collision、break-*へscenario progressを付ける。
- [ ] `VOXEL_GAME_FOCUS`を渡す専用Compose serviceを追加し、不正focusを即時拒否する。
- [ ] failure manifestへ最後のscenarioと経過秒を保存する。
- [ ] focus全種とcanonical fullをDocker内で通す。
- [ ] `巨大E2Eをfocus別に診断可能にする`でcommit・scan・push・公開確認する。

## Task 6: 総合回帰・公開検証

**Files:**
- Modify: `README.md`
- Modify: `docs/design/2026-08-01-tooling-and-e2e-optimization-design.md`
- Modify: `docs/plans/2026-08-01-tooling-and-e2e-optimization-plan.md`
- Modify: `progress.md`（git管理外）

- [ ] fresh full unit、budget付きbuild、Vehicle Lab、canonical、二車種、色替えE2Eを通す。
- [ ] 代表3 viewportを目視し、見た目・HUD・操作に差分がないことを確認する。
- [ ] renderer calls 28／27、vehicle calls 7、station calls 5を確認する。
- [ ] scene code／calls不変なら物理GPU再認証不要を根拠付きで記録する。
- [ ] README、要件台帳、受け入れ条件、非対象、リスク、性能目標、作業ログを同期する。
- [ ] `最適化を本番検証する`でcommit・全範囲scan・pushする。
- [ ] Actions／Pages、公開URL smoke、remote SHA 0/0を確認し、完了記録を追加pushする。

## Final checklist

- 受け入れ条件: bundle、Vitest、shared harness、focus、回帰、公開の8項目を証拠へ対応させる。
- 非対象: runtime／visual／physics／dependency versionを変更しない。
- リスクと対策: 循環依存、Rapier例外、既定除外、診断、touch、長距離flakyを検証する。
- 性能目標: entry 350kB、通常chunk 600kB、Three 750kB、Rapier 2.25MB、303 tests、calls 28／27を維持する。

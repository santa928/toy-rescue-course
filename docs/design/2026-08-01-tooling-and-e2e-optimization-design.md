# bundle・Vitest・E2E最適化 設計

## 目的

本番プレイ縦切りを変えず、配信bundle、unit test探索、長時間E2Eの保守性を改善する。
現在のゲームは機能・物理GPU性能を満たしている一方、production buildは`main` 2.35MB、
共有chunk 1.08MBを生成し、canonical E2Eは3,740行の単一scriptへ複数責務が集中している。

本設計は、警告値を上げるだけの見かけ上の改善を行わない。vendor境界と例外予算を明示し、
worktree重複testを予防し、走行harnessを共有して、失敗したscenarioと原因を短時間で特定できる
構造へ移す。

## 現状基準（2026-08-01）

- Docker内Vitest: 32 files／303 tests、Vitest duration 7.01秒。
- production build: 637 modules、10.88秒。
- 出力: `main` 2,348.32kB／gzip 865.77kB、`OrthographicCamera` 1,078.34kB／gzip 303.01kB。
- `@dimforge/rapier3d-compat/rapier.mjs`は単一module 2.1MBで、1.5MB WASMをcompat entryへ内包する。
- canonical E2E: `scripts/verify-voxel-game.mjs` 3,740行。production-map、nonbreak、collision、4色breakのfocusはあるが、走行／停止／座標補正が二車種・色替えscriptにも重複する。
- `.worktrees/`は現在空だが、Vitestの既定除外は`node_modules`と`.git`だけで、将来worktreeを作るとtestを重複収集し得る。

## 要件台帳

| ID | 状態 | 要件 | 本設計での扱い |
| --- | --- | --- | --- |
| REQ-001〜REQ-037 | 維持 | 玩具箱庭、二車種、仕事、色遊び、PC/touch、物理、HUD、telemetry | runtime、見た目、操作、ゲームルールを変更しない。 |
| REQ-038 | 追加 | production bundleの責務と予算を明示する | React、Three、R3F、Drei、Rapier、game entryを決定的なchunkへ分ける。 |
| REQ-039 | 追加 | Rapierの大きさを一般warningへ埋めない | compat WASMを含むphysics chunkだけ例外予算を持ち、検証scriptで上限を固定する。 |
| REQ-040 | 追加 | worktree内testを収集しない | Vitest既定除外を維持したうえで`**/.worktrees/**`を追加する。 |
| REQ-041 | 追加 | 走行harnessの重複をなくす | frame待機、状態読取、keyboard、touch stick、制動、world軸走行、座標補正を共有moduleへ分離する。 |
| REQ-042 | 追加 | 長距離経路の失敗を局所診断できる | focus別run、scenario開始／完了時刻、経過時間、失敗manifestを公開する。 |
| REQ-043 | 追加 | 既存3 E2Eを同じ走行契約へ揃える | canonical、二車種、色替えが共有harnessを使い、各feature固有assertだけを所有する。 |
| REQ-044 | 追加 | 最適化を自動回帰できる | pure helper test、bundle budget検査、3種E2E、buildをDocker内で通す。 |
| REQ-045 | 追加 | 最適化後も物理GPU性能を維持する | visual／physics runtime差分を作らず、必要ならApple M4 probeで再確認する。 |

## 要件差分

| 区分 | 対象 | 理由 | 影響・代替・復帰条件 |
| --- | --- | --- | --- |
| 維持 | REQ-001〜REQ-037 | 公開済みのプレイ契約を守る | unit、canonical、二車種、色替えE2Eを回帰gateにする。 |
| 追加 | REQ-038〜REQ-045 | 配信・test・E2Eの技術負債を機械検証可能にする | toolingとscriptだけを段階的に置換する。 |
| 保留 | 追加ミッション、ランダム仕事、追加車両、音、map拡張 | 最適化の効果を独立評価する | 本縦切り完了後の次specで実装する。 |
| 削除 | なし | 既存要件を暗黙に削除しない | なし。 |

## アプローチ比較

### A. 測定可能なvendor境界＋共有走行harness（採用）

Viteの`manualChunks`をpure resolverで定義し、chunkごとの上限を別scriptで検証する。
Vitestは明示除外を追加する。E2Eはfeature固有scenarioを残し、入力・制動・座標補正だけを
依存注入可能な共有harnessへ抜く。

- 長所: runtime差分を作らず、各変更をTDDとfocused runで閉じられる。
- 長所: Rapierの単一巨大moduleを例外として可視化し、他の肥大化を見逃さない。
- 長所: 二車種・色替え・将来車両で同じ長距離補正を再利用できる。
- 短所: Rapier compatの総転送量自体は減らず、別chunkへ隔離する改善に留まる。

### B. entryからR3F／Rapierを全面dynamic import（不採用）

初期entryは小さくできるが、scene ready、loading UI、E2E待機契約を変える。現在の小さな静的ゲームで
初回playまでの総転送量は減らず、公開挙動を変える割に効果が限定的である。

### C. warning limitだけを2.5MBへ上げる（不採用）

build logは静かになるが、bundle責務も予算も改善しない。Rapier例外とその他chunkの肥大化を
区別できないため採用しない。

## 設計

### bundle境界

`tooling/vendorChunk.ts`へmodule IDからchunk名を返すpure helperを置く。順序は
Rapier compat → React Three Rapier → Drei → R3F → Three → Reactの具体側から判定する。

- `rapier-wasm`: `@dimforge/rapier3d-compat`。単一moduleの実測2,237,128 bytesに対し2.25MBを例外上限とする。
- `rapier-react`: `@react-three/rapier`。
- `drei`: `@react-three/drei`と専用依存。
- `r3f`: `@react-three/fiber`と専用依存。
- `three`: `three`。単一core moduleの実測718,551 bytesに対し750kBをengine例外上限とする。
- `react`: `react`、`react-dom`、`scheduler`。
- game／Vehicle Lab固有moduleはentry側に残す。

`scripts/verify-build-budgets.mjs`は`dist/.vite/manifest.json`と実file sizeを読み、entry 350kB以下、
通常JS chunk 600kB以下、Three 750kB以下、Rapier 2.25MB以下、必須vendor chunkの存在を検証する。
さらにroot、互換URL、Vehicle Labの3 HTML entryが実在module assetを参照することも検証する。
Viteの一般warning上限はRapier例外に合わせるが、より厳しい独自budget検査を`npm run build`へ接続する。

### Vitest探索

`configDefaults.exclude`へ`**/.worktrees/**`を加える。pure config testで既定除外を落としていないこと、
root testが一致し、`.worktrees/example/src/test/example.test.ts`が一致しないことを固定する。

### E2E共有境界

`scripts/voxel-game-e2e/drive-harness.mjs`を追加し、次を公開する。

- `waitForFrames`、`readGameState(requiredFields)`。
- keyboard集合の同期と全解除。
- DOM pointer式touch stick driver。
- `brakeVehicle`、`driveAlongWorldAxis`、`pulseWorldAxis`、`alignWorldCoordinate`、`alignWorldPoint`。
- world軸入力定義と、距離からpulse frame数を返すpure helper。

feature scriptは`requiredFields`、最大burst、reset診断callbackだけを渡す。canonicalのCDP同時touchは
放水との同時押し契約があるため専用driverを維持し、共有走行関数へ同じinterfaceで渡す。

### E2E責務と進捗

canonicalは既存focusを維持し、scenario開始／完了／経過秒をstdoutとmanifestへ記録する。
Docker Composeは`VOXEL_GAME_FOCUS`を明示的に渡せるfocus serviceを追加する。通常full、
`production-map`、`nonbreak`、`collision`、`break-*`を同じentryで再現できるようREADMEへ記す。

## 世界観辞書とUI

本タスクは非視覚refactorである。背景、道路、車両、station、HUD、ボタン、文言、VFXの世界観辞書、
アンカー、安全余白は変更しない。build待機画面や新しいloading UIも追加しない。

## 受け入れ条件

- [x] game entryは350kB以下、通常JS chunkは600kB以下、Threeは750kB以下、Rapierは2.25MB以下で自動検証される。
- [x] React、Three、R3F、Drei、Rapierが決定的なvendor chunkへ分かれる。
- [ ] Vitestがrootの32 test filesを一度だけ収集し、`.worktrees/**`を除外する。
- [ ] canonical、二車種、色替えE2Eが共有走行harnessを使う。
- [ ] production-map、nonbreak、collision、break focusが単独実行でき、scenario時間を記録する。
- [ ] canonical full、二車種、色替え、Vehicle Labの回帰がPASSする。
- [ ] 公開画面、操作、物理、telemetry、renderer callsが変更前と一致する。
- [ ] Actions／Pages、公開URL smoke、remote SHA 0/0がPASSする。

## 非対象

- React／Three／R3F／Rapierのversion更新、物理engine変更、WASM loader置換。
- sceneのlazy mount、loading UI、service worker、asset CDN。
- E2E assertionの削除、timeoutだけの拡大、物理／照準条件の緩和。
- ゲームの見た目、操作、仕事、色遊び、map、車両、音の変更。

## リスクと対策

- manual chunkの循環依存: 具体packageから判定し、3 entry buildとbrowser E2Eで初期化順を検証する。
- engine chunkの警告を隠す: 一般warningとは別にThree 750kB、Rapier 2.25MBの明示budgetを持つ。
- Vitest既定除外を上書きする: `configDefaults.exclude`を展開し、unitで固定する。
- shared harnessでfeature診断が薄くなる: reset診断callbackとdescriptionを呼出側に残す。
- touch挙動を壊す: canonical CDP driverは維持し、二車種／色替えDOM pointerだけを共通化する。
- 長距離flakyをtimeoutで隠す: world bounds、reset count、停止速度、target座標を従来どおり毎run assertする。

## 性能目標

- buildのgame entry 350kB以下、通常JS chunk 600kB以下、Three 750kB以下、Rapier 2.25MB以下。
- Vitest 303件を維持し、`.worktrees`が存在しても重複収集0件。
- focus runは失敗scenario名と経過時間を60秒以内にstdoutへ更新する。
- scene／vehicle／station draw callsは消防車28／7、ブルドーザー27／7、station 5を維持する。
- runtime差分がないため物理GPU再認証は必須としない。renderer callsまたはscene codeが変わった場合だけApple M4でmedian 55／p10 45を再測定する。

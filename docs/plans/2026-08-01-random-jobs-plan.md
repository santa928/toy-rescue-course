# ランダム仕事・複数現場 実装計画

**Goal:** 消防車とブルドーザーに各3件の実在する仕事を追加し、完了帰庫ごとに非連続・再現可能な仕事を割り当てる。

**Architecture:** seed付きpure shuffle bag、型付きvehicle job registry、現在jobを所有する既存coordinator、job definitionを受ける固定pool sceneの4境界へ分ける。既存runtimeのtimerとphaseは維持する。

**Tech Stack:** React 19、TypeScript、React Three Fiber、Three.js、Rapier、Vitest、Playwright、Docker Compose。

## Task 1: 設計と要件台帳

- [x] REQ-046〜REQ-052、差分、世界観辞書、受け入れ条件、非対象、性能、リスクを定義する。
- [x] 各車種3仕事、shuffle bag、完了帰庫だけで再抽選する契約を決める。
- [x] 文書を日本語commitし、secret scan後にmainへpushする。

## Task 2: pure job deckと仕事registry

- [x] `JobDeck.test.ts`で同seed同順、bag内非重複、補充境界の非連続、不正seed正規化をREDにする。
- [x] `vehicleJobs.test.ts`で全車種3件、ID・文言・座標・地区・対象数・routeをREDにする。
- [x] 最小domain実装を追加しfocused／full unitをGREENにする。
- [x] 日本語commit、secret scan、push、Actions／Pages／公開smokeを確認する。

## Task 3: coordinatorの仕事割当

- [x] 完了帰庫だけでcurrent jobを進めるcoordinator testをREDにする。
- [x] 車種別bag、current job、cycle、seedをsnapshotへ追加する。
- [x] ブルドーザーruntimeへ同じinstanceで対象IDを再割当するAPIを追加する。
- [x] 乗り換え、未完了帰庫、timer、既存通知回数の回帰をGREENにする。
- [x] 日本語commit、secret scan、push、公開確認を行う。

本番の仕事ローテーションはTask 4・5で両sceneが仕事座標を反映するまで安全ゲートをOFFにし、coordinatorのoptionを有効化したtestだけで先に契約を固定する。片側だけを先行公開して表示対象と判定対象をずらさない。

## Task 4: 複数火災scene

- [x] job targetからfire layout、route、star、targetingを導出するpure testをREDにする。
- [x] `WaterAndFire`へcurrent fire jobを渡し、固定poolと1 colliderの座標を切り替える。
- [x] 3火災の炎・水・hazard・telemetry一致をunit／component testでGREENにする。
- [x] 日本語commit、secret scan、push、公開確認を行う。

## Task 5: 複数がれきscene

- [x] jobごとの3対象、route、clear判定、VFX transformをpure testでREDにする。
- [x] 既存12本体／18chip／7route／12star slotへcurrent job座標をin-place転送する。
- [x] 3仕事、冪等進捗、reset、通常積み木非干渉をGREENにする。
- [x] 日本語commit、secret scan、push、公開確認を行う。

## Task 6: App・HUD・telemetry

- [x] query seed解析とsession seed生成をpure testでREDにする。
- [x] current job ID、label、cycle、seed、対象座標を`render_game_to_text()`へ同期する。
- [x] job札と色札のアンカー、aria、操作可能性を3 viewportで数値検証する。
- [x] 日本語commit、secret scan、push、公開確認を行う。

## Task 7: 専用E2Eと総合公開

- [ ] PC keyboard、Tablet／Mobile touchで各車種2周し、異なるjobを完了する。
- [ ] canonical full、二車種、色替え、Vehicle Lab、production smokeをfresh実行する。
- [ ] 3 viewportの代表画像を原寸目視し、対象、道しるべ、HUD、操作系を確認する。
- [ ] 物理／描画差分が性能再認証条件に該当する場合はApple M4で測定する。
- [ ] README、設計、計画、progressへ実測値を同期する。
- [ ] 日本語commit、全commit secret scan、push、remote／Actions／Pages／公開物を確認する。

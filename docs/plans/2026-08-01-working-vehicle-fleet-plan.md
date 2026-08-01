# 働く車5台化 実装計画

**Goal:** 既存の消防車・ブルドーザーを維持し、ショベルカー・救急車・パトカーを各3仕事、
一時塗装、PC／touch操作、公開telemetryまで本番箱庭へ統合する。

**Architecture:** 追加3台は共通`ActionTargetMissionRuntime`と固定pool sceneへ載せ、車種差を
型付きjob interactionとvoxel modelへ閉じる。既存消防／ブルドーザーruntimeは温存する。

**Tech Stack:** React 19、TypeScript、React Three Fiber、Three.js、Rapier、Vitest、Playwright、Docker Compose。

## Task 1: 設計と安全な拡張境界

- [x] REQ-053〜REQ-062、世界観辞書、遊び、UIアンカー、受け入れ条件、非対象、性能、リスクを定義する。
- [x] 共通ActionTarget方式と既存runtime温存を比較して採用する。
- [x] 日本語commit、secret scan、main push、Actions／Pagesを確認する。

## Task 2: 共通ActionTarget domain／scene基盤

- [x] pure runtimeの対象完了、冪等性、1800ms成功、帰庫、再割当をRED→GREENにする。
- [x] 距離、速度、継続時間の接触gateと50ms clampをRED→GREENにする。
- [x] target／particle／route／starの固定slot frameをRED→GREENにする。
- [x] disabled時count 0、job切替in-place、telemetry一致を固定する。
- [x] 日本語commit、secret scan、main push、Actions／Pagesを確認する。

## Task 3: ショベルカー

- [x] model data、外接寸法、7 batch上限、paint palette、bucket animationをTDD実装する。
- [x] 3つの土掘り仕事、job deck、coordinator、HUD、telemetryへ接続する。
- [x] PC／touchで選択、土3山、成功、帰庫、次仕事を実走する。
- [x] 3 viewport画像を原寸目視し、selector境界を数値確認する。
- [x] 日本語commit、secret scan、main push、Actions／Pages／公開E2Eを確認する。

## Task 4: 救急車

- [x] model data、赤十字、7 batch上限、paint palette、手当て脈動をTDD実装する。
- [x] 公園の3救助仕事、1.2秒停止手当て、coordinator、HUD、telemetryへ接続する。
- [x] PC／touchで選択、手当て、成功、帰庫、次仕事を実走する。
- [x] 3 viewport画像を原寸目視し、4台selector境界を数値確認する。
- [x] 日本語commit、secret scan、main push、Actions／Pages／公開E2Eを確認する。

## Task 5: パトカー

- [x] model data、赤青灯、7 batch上限、paint palette、交互点滅をTDD実装する。
- [x] 南地区の3巡回仕事、走行中サイレンgate、coordinator、HUD、telemetryへ接続する。
- [x] PC／touchで選択、3地点巡回、成功、帰庫、次仕事を実走する。
- [x] 3 viewport画像を原寸目視し、全車両と全HUDを確認する。
- [x] 日本語commit、secret scan、main push、Actions／Pages／公開E2Eを確認する。

## Task 6: 5台総合回帰と性能再認証

- [ ] fresh full unit、budget付きbuild、canonical、既存二車種、色遊び、5台専用E2E、Vehicle Lab、production smokeを通す。
- [ ] 代表viewportの全画像を原寸目視し、内部HUD境界も数値確認する。
- [ ] Apple M4 physical GPUで各車両のdraw call、median、p10を再測定する。
- [ ] README、設計、計画、progressへ実測と公開結果を同期する。
- [ ] 全commit範囲をsecret scanし、日本語commit、main push、remote／Actions／Pages／公開物を確認する。

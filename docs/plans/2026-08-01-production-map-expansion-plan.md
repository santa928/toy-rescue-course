# 96×96 玩具のまち拡張 実装計画

**Design source:** `docs/design/2026-08-01-production-map-expansion-design.md`

**対象要件:** REQ-072〜REQ-079

## Task 1: canonical mapをTDDで96×96へ拡張する

- [x] `productionWorldMap.test.ts`へ96×96、7地区、24道路、新中心、共有visual／solid予算の失敗testを先に追加する。
- [x] `worldLayout.test.ts`へ新地区解決と既存座標維持の失敗testを先に追加する。
- [x] `productionWorldMap.ts`へ2地区、中心、道路、visual boxを最小実装する。
- [x] map validationへ新中心の地区契約を接続する。

## Task 2: 描画・物理・telemetryを接続する

- [x] ground 96×96、道路線、色別batch、最大28 solidの期待を先に失敗させる。
- [x] `VoxelWorld`と`worldCollisionLayout`がcanonical mapから自動導出することを確認する。
- [x] world telemetryとglobal型へ7地区・新中心を追加する。
- [x] 既存72×72固定値をruntime／E2Eから除き、96×96へ同期する。

## Task 3: 新地区専用E2Eとvisual証跡を作る

- [x] hub→こうじヤード→別出口、hub→おもちゃのまち→別出口を実入力で走る。
- [x] 新地区の代表solidへ衝突し、回復後もworld bounds内であることを確認する。
- [x] Desktop 1280×720、Tablet 1024×768、Mobile landscape 844×390で両地区を撮影する。
- [x] HUD境界、安全余白、ランドマーク投影位置、親内包を数値確認する。
- [x] 6枚を目視し、道路接続、密度、重なり、はみ出し、見た目と物理の対応を確認する。

## Task 4: 回帰・性能構造・公開を確認する

- [x] 関連unit、全unit、production build、bundle budgetをDocker内で実行する。
- [x] 専用E2E、fleet E2E、production smokeをDocker内で実行する。
- [x] renderer call、visual batch、solid count、移動時間をmanifestへ記録する。
- [x] 96×96以下かつ構造予算内ならchunk streaming／LOD不要を記録し、最終物理GPUを再開条件にする。
- [x] README、設計、計画へ実測を反映する。
- [ ] staged差分と`origin/main..HEAD`をsecret scanする。
- [ ] 日本語コミットを作成してmainへpushする。
- [ ] remote SHA、ahead/behind 0/0、GitHub Actions／Pages successを確認する。
- [ ] 公開URLで専用E2E、3 entrypoint、console cleanを確認する。
- [ ] 公開結果を別の日本語コミットで記録し、再push・再公開確認する。

## 検証コマンド方針

Node.js、Vite、Vitest、PlaywrightはすべてDocker内で実行する。ホストでは`rg`、`git diff`、`git status`、成果画像の目視だけを行う。Docker software rendererのfpsは物理GPU性能認証に使わない。

## 完了条件

- [x] REQ-072〜REQ-079がunit、telemetry、E2E、実画面で対応する（公開・物理GPU確認を除くローカル範囲）。
- [x] 既存REQ-001〜REQ-071の回帰がない。
- [x] 非対象を暗黙に実装・削除していない。
- [ ] 公開URLとremote mainが同じSHAを示す。

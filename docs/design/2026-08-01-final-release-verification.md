# 純ボクセル働く車 最終リリース検証

**日付:** 2026-08-01

**状態:** ローカル総合回帰・物理GPU認証済み、最終公開同期待ち

## 1. 目的と範囲

REQ-001〜REQ-079を維持した96×96完成版について、5車種15仕事、自由走行、積み木破壊、色遊び、音・振動、物理、3 viewport、公開telemetry、bundle予算、GitHub Pagesを最終認証する。

要件の追加・保留・削除はない。ゲームオーバー、時間切れ、ランキング、通貨・解除・課金、セーブ、写実的な煙・流体・損傷、マルチプレイ、精密サスペンションは引き続き非対象とする。

## 2. ローカル総合回帰

| 対象 | 結果 |
| --- | --- |
| fresh Vitest | 46 files／448 tests PASS |
| production build | 656 modules、全bundle budget PASS |
| canonical full | 全scenario、33 screenshot proof、error 0/0/0 |
| Vehicle Lab | 3 viewport PASS |
| 既存車両 | 3 viewport、5 selector子境界、HUD余白 PASS |
| 色遊び | 3 viewport、再接触・上書き・時間切れ・乗り換え競合 PASS |
| 5台fleet | 3 viewport、追加3台の成功・帰庫・次仕事、24画像 PASS |
| 音・振動 | 実AudioContext、5 action、engine、cue、on/off、6画像 PASS |
| 96×96map | 7地区、27 solid、2地区の入口・中心・別出口、6画像 PASS |
| production smoke | root、互換URL、Vehicle Lab PASS |

build成果物はgame entry 144,786 bytes、通常vendor最大192,532 bytes、Three 718,551 bytes、Rapier 2,237,128 bytesで、350kB／600kB／750kB／2.25MBの上限内だった。

## 3. 物理GPU認証

公開版を1280×720の`ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)`で、各車2秒warm-up＋12秒測定した。

| 車両 | median fps | p10 fps | 平均 fps | scene calls | 車体 calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| 消防車 | 59.88 | 56.82 | 60.00 | 29 | 7 |
| ブルドーザー | 59.88 | 56.82 | 60.00 | 28 | 7 |
| ショベルカー | 59.88 | 57.80 | 60.00 | 31 | 7 |
| 救急車 | 59.88 | 58.14 | 59.84 | 31 | 7 |
| パトカー | 59.88 | 58.48 | 60.00 | 31 | 7 |

全車がmedian 55fps以上、p10 45fps以上を満たした。96×96ちょうど、27 static collider、既存InstancedMesh構造で性能目標を達成したため、chunk streaming／LODは実装しない。一辺96unit超または将来の物理GPU性能未達時だけ再評価する。

## 4. UI・視覚確認

現行成果物からDesktop／Tablet／Mobile landscapeの代表10画像を原寸目視した。連続した水流、積み木破壊、5台の役割部品、色シャワー、患者、こうじヤード、おもちゃのまち、mission、selector、fullscreen、audio、joystick、主操作に欠け・意図しない重なり・はみ出し・操作阻害はない。

selectorは5ボタンすべてが親境界内に収まり、viewport四辺、mission、touch操作との安全余白を実寸で満たす。旧3台固定期待値とmobile幅42%の比率契約は、現行5台UIの実寸契約へRED→GREENで更新した。

## 5. 既知事項

Chrome console errorは0。`@dimforge/rapier3d-compat` 0.19系の初期化時に、upstream既知のdeprecated parameter warningが1件出る。アプリは`@react-three/rapier`の公開契約どおり初期化しており、機能・性能への影響は確認されないため、依存パッケージをmonkey patchしない。

## 6. 最終チェック

- [x] 受け入れ条件: REQ-001〜REQ-079、Docker総合回帰、3 viewport、物理GPU目標を満たす。
- [x] 非対象: 解除・失敗・課金・保存・写実表現等を追加していない。
- [x] リスクと対策: 固定pool、typed registry、実寸HUD、決定的telemetry、公開E2Eを維持する。
- [x] 性能目標: bundle予算、draw call、Apple M4 median／p10を満たす。

## 7. 最終公開結果

最終検証commitのGitHub Pages deployと公開E2E完了後に、commit SHA、Actions run、公開manifestを追記する。

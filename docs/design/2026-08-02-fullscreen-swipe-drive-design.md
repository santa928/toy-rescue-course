# 画面全体スワイプ運転 設計

**日付:** 2026-08-02

**状態:** 実装・ローカル検証完了（GitHub Issue #2）

## 1. 目的

固定レバーの小さな操作範囲を狙いにくい幼児でも、ゲーム画面の空いている場所へ指を置き、そのまま進みたい画面方向へスワイプすれば車を運転できるようにする。車種別の主操作、車両選択、全画面、音ボタンは従来どおり独立して押せる状態を保つ。

## 2. 世界観辞書

共通語彙は「木の机、玩具の街、働く車、赤い玩具レバー」とする。入力開始位置には既存の赤いレバー盤が指の下へ現れ、スワイプ量に合わせてつまみが動く。スマートフォン風の透明ジェスチャー線、写実的な指画像、複雑な設定UIは追加しない。待機中は左下の玩具レバーを発見用の見本として残し、ラベルを「どこでも」に変える。

## 3. 要件台帳

| ID | 状態 | 要件 | 受け入れ条件 |
| --- | --- | --- | --- |
| REQ-001〜REQ-091 | 維持 | 既存5車種、仕事、画面方向移動、物理、HUD、音、色遊び、性能契約 | 既存unit／build／E2Eを回帰gateにする。 |
| REQ-092 | 追加 | 画面の空いている任意位置から運転を始められる | 固定レバー外の3地点以上でpointer downし、同位置へ浮動レバーが現れる。 |
| REQ-093 | 追加 | スワイプした画面方向へ車が進む | 上下左右のdragを正規化し、commandと実車両のscreen deltaが同じ向きになる。 |
| REQ-094 | 追加 | タップだけでは誤発進せず、指を離せば止まる | 14% dead zoneを維持し、pointerup／cancel／lost capture／blur／hiddenで移動commandを0へ戻す。 |
| REQ-095 | 追加 | 既存HUD操作と同時操作を壊さない | 車両選択、全画面、音、主操作は運転を開始せず、運転pointerと主操作pointerを同時保持できる。 |
| REQ-096 | 追加 | 高頻度入力でReact再描画や3D負荷を増やさない | pointer moveはref、command ref、DOM transformだけを更新し、毎frame React state、Three draw call、物理bodyを増やさない。 |

### 要件差分

| 区分 | 対象 | 理由・影響・代替案・復帰条件 |
| --- | --- | --- |
| 維持 | REQ-001〜REQ-091 | 既存ゲームルールと公開済みの操作契約を変えない。 |
| 追加 | REQ-092〜REQ-096 | Issue #2の「画面全体を操作エリアにし、タップしてスワイプした方向へ進む」を直接満たす。 |
| 保留 | タップ地点への自動走行 | 障害物回避と経路探索が必要になり、自由に玩具を動かす既存コンセプトを変える。直接運転で幼児試遊が成立しない場合に再検討する。 |
| 削除 | なし | キーボード、固定レバー位置からの操作、主操作を残す。 |

## 4. 採用案と不採用案

採用するのは、HUDの最背面へ全画面の`touch-drive-surface`を置き、最初のpointer位置を原点にする浮動スティック方式である。既存のレバー見た目と入力commandを再利用でき、車両物理へ変更を入れずにIssue要件を満たせる。

- 左側だけを入力面にする案は主操作との分離が単純だが、「画面全体」を満たさない。
- タップ地点へ自動走行する案は入力が最少になる一方、経路探索、衝突時の復帰、目的地キャンセルが必要で、Issueのスワイプ直接操作と異なる。

## 5. コンポーネントとデータフロー

`TouchJoystick`を`FullscreenDrivePad`へ改名する。外側の`touch-drive-surface`はviewport全体を覆い、内側の`.touch-joystick`は待機中だけ左下へ置く。pointer down時に次を行う。

1. 最初のpointer IDと画面座標をrefへ保存する。
2. `.touch-joystick`の中心を開始座標へ移す。
3. 開始座標から現在座標までの差を、見えているレバー半径で-1〜1へ正規化する。
4. `controls.setTouchStick(x, y)`とthumbのDOM transformへ同じ値を渡す。

`toDriveCommand()`は従来どおりDOM下方向を反転し、画面上dragを`moveY > 0`へ変換する。車両側のscreen-relative movement、Rapier body、cameraは変更しない。

HUD内ではdrive surfaceを最初の子として描画する。後続の車両選択、全画面、音、主操作ボタンは同じstacking contextで前面にあり、pointerをdrive surfaceへ渡さない。文言札とミニマップは非操作要素なので、その上からでも運転を開始できる。

## 6. pointer lifecycleと安全停止

- 1本目の左mouse／touch／penだけを運転pointerとしてcaptureする。
- 同じ入力面へ来た2本目は無視し、主操作ボタン側の別pointerは従来どおり受け付ける。
- pointer down直後は差分0なので発進しない。既存14% dead zoneを越えたときだけ動く。
- pointerup、pointercancel、lostpointercapture、window blur、document hidden、unmountの全経路でstick、thumb、浮動位置を初期化する。
- 非有限座標または寸法0は停止入力へ正規化する。

## 7. UIアンカーと安全余白

待機中のレバー見本は既存どおり左下safe areaへアンカーし、主操作は右下、仕事札は上、ミニマップは右上へ置く。active時だけレバー盤がpointer原点へ移動するため、HUDを隠しても入力継続を優先し、指を離すと左下へ戻す。操作ボタンそのものは常に浮動レバーより後に描画し、押下可能領域を守る。

Desktop 1280×720、Tablet 1024×768、Mobile landscape 844×390で、待機時の既存8px安全余白、active時の原点一致、thumbのレバー盤内収まりをruntime数値で確認する。

## 8. エラー処理

pointer captureはブラウザ都合で失敗・消失することがある。capture APIの例外は入力開始を妨げず、lost captureとglobal cleanupで停止だけを保証する。active pointer以外のmove/up/cancelは状態を変更しない。

## 9. 性能目標

- pointer moveごとのReact state更新0。
- 追加Three draw call 0、Rapier body／collider 0、asset fetch 0。
- game entry 350kB、通常chunk 600kB、Three 750kB、Rapier 2.25MB以内。
- CSS更新はactive padの`left/top`とthumbの`transform`だけ。

## 10. 検証

- 原点、半径内、半径外、非有限値を扱うswipe正規化pure unit test。
- control dead zone、keyboard fallback、releaseを既存unit testで回帰確認。
- HUD SSRで全画面入力面、発見用レバー、現在の主操作文言を確認。
- 実touch E2Eで固定レバー外の複数地点から上下左右へdragし、command、車両screen delta、浮動原点、release停止を確認。
- 実touch E2Eで音／車両選択／主操作が運転を誤開始しないことと、運転＋主操作の同時保持を確認。
- 代表3 viewportを原寸目視し、待機時とactive時の重なり、はみ出し、操作阻害、文言位置を確認。
- fresh full unit test、production build、canonical nonbreak E2Eを実行する。

## 11. 非対象

- タップ地点への自動走行、経路探索、障害物回避AI。
- 操作感度設定、左右反転、固定／浮動モード切替。
- 新しい車両物理、camera、最高速度、仕事判定の変更。
- multi-pointerで2台を同時に運転する操作。

## 12. リスクと対策

| リスク | 対策 |
| --- | --- |
| 全画面入力面がHUDボタンを奪う | surfaceをHUD最初の子にし、interactive buttonを後続の`pointer-events:auto`で前面化してE2Eする。 |
| 指を離しても車が走り続ける | up/cancel/lost/blur/hidden/unmountを同じrelease関数へ集約する。 |
| pointer開始直後に車が跳ねる | 原点差分0と14% dead zoneを維持する。 |
| 浮動レバーが画面端で切れる | 指との対応を優先してactive中だけoverflowを許容し、release時にsafe area内へ戻す。主操作ボタンは前面で押せる。 |
| E2Eの固定レバー操作が壊れる | `.touch-joystick` visualと既存DOM driver契約を維持し、画面任意点の新規CDPシナリオを追加する。 |

## 13. 最終版チェック

- [x] 受け入れ条件がある。
- [x] 非対象がある。
- [x] リスクと対策がある。
- [x] 性能目標がある。
- [x] 要件差分に維持・追加・保留・削除がある。
- [x] pointer競合と全停止経路が具体化されている。

## 14. 実測結果

- fresh unit: 48 files / 469 tests成功。
- production build: game 162,182 bytes、通常vendor最大192,532 bytes、Three 718,551 bytes、Rapier 2,237,128 bytesで全budget内。
- focused実touch E2E: Desktop touch 1280×720、Tablet 1024×768、Mobile landscape 844×390の12方向drag、HUD単独tap、運転＋主操作同時保持、release／cancel停止、browser error 0件。
- canonical nonbreak E2E: 直接移動、寛容な消火照準、keyboard／touch各2仕事、water timeline、3 viewport layoutの全scenario成功。
- 12枚を原寸目視し、待機レバーの左下safe area、active原点、thumb収まり、主要HUDのhit target、文言位置に崩れ・はみ出し・操作阻害がないことを確認した。
- 方向検証は、追従カメラによる画面差分相殺を除くため、開始時カメラを固定して移動前後の車両座標を投影する。

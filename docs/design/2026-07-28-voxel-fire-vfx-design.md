# 立体ボクセル炎VFX設計

## 目的

現在の火は黄・橙・赤の大きな箱を縦へ3個積んだ静止物で、炎より積み木の塔として
読まれやすい。純ボクセルの玩具世界、既存の消火ミッション、物理契約を維持しながら、
遠距離・消火中・横向きモバイルでも一目で炎と分かる立体VFXへ置き換える。

## 世界観辞書

- シルエット: 幅広い根元、中央から左右へ分かれる非対称な炎の舌、細く尖る上端。
- 色: 暗い赤の外炎、鮮やかな橙の中炎、黄白の熱い芯。
- 動き: 炎の舌ごとに位相をずらした上下伸縮と小さな横揺れ。火の粉は上昇しながら縮む。
- 材質: 既存世界と同じ不透明なLambert材質と立方体だけを使う。
- 禁止語彙: 写実的な煙、半透明板、texture、流体mesh、bloom依存、激しい画面点滅。

背景の木製建物、濃灰の道路、赤い消防車、青白い水流に対し、炎は赤橙黄の暖色階層と
上向きの動きで分離する。

## 要件台帳

| ID | 状態 | 要件 | 実現方法 |
|---|---|---|---|
| FIRE-VFX-001 | 追加 | 静止画でも炎と読める立体シルエットにする | 広い根元、黄白い芯、左右へ分かれた複数の炎の舌を小ボクセルで構成する |
| FIRE-VFX-002 | 追加 | 色だけでなく熱の階層が分かる | 赤い外炎、橙の中炎、黄白の芯を奥行きのある3 batchへ分ける |
| FIRE-VFX-003 | 追加 | 炎らしい非同期の動きを付ける | slotごとに異なる位相で上下伸縮・横揺れし、固定slotの火の粉を上昇させる |
| FIRE-VFX-004 | 維持・強化 | 火勢低下が視覚的に分かる | 既存3段階を維持し、高い炎の舌、外炎、芯の順でactive slotを減らす |
| FIRE-VFX-005 | 維持 | 消火・照準・物理のゲーム契約を変えない | 消火2500ms、放水距離6、照準、hazard collider、再出動復帰を変更しない |
| FIRE-VFX-006 | 追加 | 毎frame allocationとdraw call増加を抑える | 18 slot以内の固定poolと赤・橙・黄白の最大3 InstancedMeshを再利用する |
| FIRE-VFX-007 | 追加 | 見た目と状態を自動検証できる | pure frame helper、active count telemetry、Desktop/Mobile screenshot proofを追加する |
| FIRE-VFX-008 | 維持 | 小画面でもHUDや消防車を邪魔しない | 現在の炎hazard周辺に収め、Mobile landscapeでmission・放水UIとの非重複を確認する |

## 要件差分

| 現在 | 改善後 | 判定 | 理由・影響・代替案・復帰条件 |
|---|---|---|---|
| 3個の大きな静止box | 18 slot以内の小ボクセル固定pool | 変更 | 塔ではなく炎として読ませる。性能未達時は火の粉slotから減らす |
| 黄→橙→赤を縦に積む | 赤い外炎・橙の中炎・黄白い芯を入れ子にする | 変更 | 炎の熱構造と奥行きを色・配置の両方で伝える |
| 動きなし | 位相差のある炎の舌と上昇火の粉 | 追加 | 炎の識別に必要。激しい明滅やrandom seedは使わない |
| 3段階でbox数を減らす | 3段階でactive slotと最大高さを減らす | 維持・強化 | runtimeの意味を変えず、火勢低下をより明確にする |
| 炎の物理・消火契約 | 同一契約 | 維持 | 今回は視覚改善であり、難易度やプレイループを変えない |
| 煙なし | 煙なし | 維持 | ユーザーが玩具の炎を選択し、画面の濁りと追加batchを避けるため |

## 採用方式

### 採用: 色別InstancedMeshによる固定pool

炎と火の粉を18 slot以内へ固定し、各frameは既存matrixを書き換える。slotは役割、
基準位置、基準scale、位相、表示に必要な最小火勢段階を持つ。

- `outer`: 赤い外炎。幅広い根元と左右の輪郭を担当する。
- `middle`: 橙の中炎。中央の主シルエットと中段の炎の舌を担当する。
- `core`: 黄白い芯。低い中央部と最も熱い焦点を担当する。
- `spark`: 橙batchを共有し、上昇・縮小して循環する。

色別に最大3 draw callとし、火の粉専用materialやmeshを追加しない。

### 不採用A: 十字板ポリゴン

少ないgeometryで炎らしい輪郭を作れるが、立方体だけで構成した車両・水・建物から
表現が外れるため採用しない。

### 不採用B: 大型の静的ボクセル像

遠距離の識別は改善するが、現在の「積み木の塔」問題を動きで解決できず、消火中の
変化も段階的な消滅だけに留まるため採用しない。

## コンポーネント境界

### `src/voxel-game/scene/fireVfx.ts`

炎slot定義とpureなframe計算だけを担当する。

- 入力: 経過秒、既存の火勢段階。
- 出力: 全固定slotの`active / role / position / scale / slot`。
- 副作用: なし。
- 防御: 非finite時間は0、段階は0〜3へclampする。

slot配列はmodule初期化時に1回だけ作り、frame計算は既存配列を増減させる設計に
しない。テストはslot identityではなくslot番号と全件数の不変を固定する。

### `src/voxel-game/scene/WaterAndFire.tsx`

pure frameを色別InstancedMeshへ反映する。既存`useFrame`内で炎時計も進め、
水VFXと同様にmatrix更新だけを行う。React stateは既存の低頻度な火勢段階だけを使う。

既存の`FireHazardCollider`、mission signal、水流計算、route、celebrationは変更しない。

### `src/voxel-game/VoxelGameApp.tsx`

既存text hookへ`fireVoxelCount`を追加し、現在画面に出ている炎slot数を観測可能にする。
既存の`fireLayerCount`と`visualLayout.fireLayers`は物理・回帰互換のため維持する。

## シルエットとモーション契約

- 最大火勢では、根元がX/Zの両方向へ広がり、2本以上の炎の舌が異なる高さへ伸びる。
- 最上部を中央へ一直線に積まず、左右どちらかへずらして塔の輪郭を避ける。
- 黄白い芯は外炎より低く、赤い外炎に完全に隠れない位置へ置く。
- 通常炎の移動量は基準位置から0.18 world unit以内、scale変化は基準の±18%以内とする。
- 火の粉は炎本体から分離して上昇し、寿命後は同じslotを根元近くへ循環させる。
- 乱数は使わず、slot固有位相と正規化時間で同じ時刻に同じframeを再現する。
- 激しい点滅を避け、material色・emissive強度はframe中に変更しない。

## 火勢段階

| 段階 | 表示 |
|---|---|
| 3 | 外炎・中炎・芯・高い炎の舌・最大3個の火の粉 |
| 2 | 中程度の外炎・中炎・芯・低い炎の舌・最大2個の火の粉 |
| 1 | 低い赤橙の輪郭と黄白い芯・最大1個の火の粉 |
| 0 | 全slot非表示。hazard colliderも既存契約どおり無効 |

段階遷移でslot総数やmeshを作り直さず、`active`とmatrixだけを更新する。

## テスト方針

### Unit

- 固定poolが18 slot以内で、slot番号が重複しない。
- 最大火勢に赤・橙・黄白の3役割、幅広い根元、2本以上の異なる高さの炎の舌がある。
- 異なる時刻で複数slotが異なる方向へ動き、全体が同位相にならない。
- 移動量・scale変化が契約範囲内に収まる。
- 火の粉が上昇・縮小・循環する。
- 火勢3→2→1→0でactive countと最大高さが単調に減り、0で全件inactiveになる。
- 不正な時間・段階でもNaN matrixを作らない。

### Browser / E2E

- DesktopとMobile landscapeで、消火前の炎が建物と道路から分離して見える。
- 放水中に青白い水と赤橙黄の炎を同時に識別できる。
- 弱火では炎の高さと個数が減り、完全消火後は炎が残らない。
- 帰庫後の再出動で最大火勢へ復帰する。
- `contractFailures: []`、browser error 0/0/0、既存27 proof契約を維持する。
- 消火前、放水中、弱火、消火後の代表画像を原寸目視する。

## 受け入れ条件

- 静止画で「積み木の塔」ではなく炎として読める。
- 動画では複数の炎の舌が非同期に揺れ、火の粉が上昇して見える。
- 最大火勢、弱火、完全消火、帰庫後復帰が視覚とtelemetryで一致する。
- Desktop 1280×720とMobile landscape 844×390で、炎がHUDや消防車を不自然に覆わない。
- 炎の最大draw callは3、固定poolは18 slot以内で、毎frameのReact state更新を追加しない。
- 既存unit、production build、Voxel Game canonical full E2Eが成功する。

## 非対象

- 煙、延焼、風向き、火のダメージ、ゲームオーバー。
- 消火時間、放水距離、照準補助、hazard collider形状の変更。
- 火災建物、道路、camera、HUD layoutの変更。
- shader、texture、post-processing、外部画像assetの追加。
- 音声・振動・新しいmissionの追加。

## リスクと対策

| リスク | 対策 |
|---|---|
| 小ボクセルが遠距離で散らばって見える | 根元の大きめslotを残し、炎の舌だけを細分化する |
| 動きが同期して点滅に見える | slot固有位相と異なる周期をpure helperで固定する |
| 火の粉が水粒と紛らわしい | 暖色・上向き・低個数に限定し、橙batchを共有する |
| instance更新でdraw callやallocationが増える | 3色固定batch、18 slot以内、matrix再利用をunitとtelemetryで確認する |
| visualだけ消えてhazardが残る | 既存`fireLayerCount`・hazard E2Eを維持し、段階0の両方を確認する |
| 既存proof数とconsumerがずれる | producer・text hook・unit・E2Eの全consumerを同じ変更波で更新する |

## 性能目標

- 炎は最大3 draw call、18固定slot以内。
- React stateの毎frame更新なし。
- material・geometry・InstancedMeshの毎frame生成なし。
- 既存の物理GPU目標を維持する: Desktop 60fps、Tablet/Mobile landscape 30fps以上。
- DockerのSwiftShader fpsは記録だけに使い、物理GPU認証には使わない。

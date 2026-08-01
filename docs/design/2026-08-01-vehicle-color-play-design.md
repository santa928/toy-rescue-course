# 色付きプール・色付きシャワー遊び 設計

## 目的

72×72の純ボクセル箱庭へ、当初コンセプトだった「色付きプールや色付きシャワーへ入ると、
しばらく車体色が変わる」自由遊びを本番品質で追加する。南の自由走行地区をカラーあそび
コースへ育て、消防車とブルドーザーの仕事、自由走行、積み木破壊を止めずに寄り道できる
常設ギミックにする。

失敗、時間制限、評価、解除、報酬は追加しない。色効果の時間切れは失敗ではなく、元の玩具色へ
自然に戻る演出として扱う。

## 要件台帳

| ID | 状態 | 要件 | 本設計での扱い |
| --- | --- | --- | --- |
| REQ-001 | 維持 | おもちゃのような働く車を箱庭で操作できる | 既存の画面方向ダイレクト移動を変えない。 |
| REQ-002 | 維持 | 指定積み木を押したり壊したりできる | 色効果と積み木runtimeを独立させる。 |
| REQ-003 | 実装 | 色付きプールで車体色が一時的に変わる | 赤・青・黄の浅い色水プールを南地区へ置く。 |
| REQ-004 | 実装 | 色付きシャワーで車体色が一時的に変わる | 赤・青・黄のアーチ型シャワーを南地区へ置く。 |
| REQ-005 | 維持 | 机上のおもちゃコース風の純ボクセル世界にする | 色水、アーチ、滴、車体色も角の立った玩具voxelへ統一する。 |
| REQ-006〜REQ-008 | 維持 | 複数車種、車種別仕事、中央車庫の乗り換え | 二車種と仕事coordinatorを変更せず色遊びを横断機能にする。 |
| REQ-009〜REQ-014 | 維持 | 子ども向け難易度、全車種解放、PC/touch、主操作、限定破壊、純voxel | 色遊びは自動接触とし、追加ボタンや破壊対象を増やさない。 |
| REQ-017、REQ-019 | 維持 | 寛容な放水、仕事循環 | 色効果は消火・工事の進捗へ影響しない。 |
| REQ-020〜REQ-025 | 維持 | 72×72 map、固定camera、telemetry、型付きmap、移動密度 | mapは拡張せず南地区の既存余白を使う。 |
| REQ-026〜REQ-031 | 維持 | 車種registry、ブルドーザー縦切り、primary action、HUD安全余白 | paint対象paletteを車種別に定義し、既存draw call上限を守る。 |
| REQ-032 | 追加 | 赤・青・黄をプールとシャワーの両方で選べる | 左レーン3プール、右レーン3シャワーを一対ずつ並べる。 |
| REQ-033 | 追加 | 接触中と離脱後の一時色を決定的に扱う | 接触中は12秒へ保持し、離脱後だけ残時間を減らすpure runtimeを追加する。 |
| REQ-034 | 追加 | 再接触、別色、時間切れを分かりやすく扱う | 再接触は12秒へ回復、別色は即上書き、0秒で元paletteへ戻す。 |
| REQ-035 | 追加 | 車種乗り換えと一時色を競合させない | effectをvehicle IDへ紐付け、成功した別車種切替だけ解除する。拒否切替では維持する。 |
| REQ-036 | 追加 | 車種の識別要素を残して車体色を変える | 消防車の赤bodyとブルドーザーの黄bodyだけを着色し、窓、タイヤ、梯子、blade、灯火は維持する。 |
| REQ-037 | 追加 | 色遊びをHUD・telemetry・3 viewport E2Eで検証できる | 色、source、接触、残秒、発動回数、station配置、描画数を公開する。 |

## 要件差分

| 区分 | 対象 | 理由 | 影響・代替・復帰条件 |
| --- | --- | --- | --- |
| 維持 | REQ-001、REQ-002、REQ-005〜REQ-031 | 既存の二車種縦切りを回帰させない | 既存unit、canonical E2E、二車種E2Eを回帰条件に残す。 |
| 実装 | REQ-003、REQ-004 | 当初コンセプトの未実装ギミックを完成させる | 南地区、車体material、HUD、telemetryへ接続する。 |
| 追加 | REQ-032〜REQ-037 | 二車種になった現在の競合と検証条件を明文化する | pure runtime、型付きsource、限定palette tint、専用E2Eを追加する。 |
| 保留 | 追加車両、追加仕事、音、追加地区 | 色遊び単独で受け入れ可能にする | 本縦切り公開後に別タスクで進める。 |
| 削除 | なし | 既存要件を暗黙に削除しない | なし。 |

## アプローチ比較

### A. 型付きsource＋独立ColorEffectRuntime（採用）

mapへ6つのtrigger sourceを置き、車両位置との包含判定をpure helperで行う。色状態は仕事runtimeから
独立した小さなruntimeが所有し、接触・再接触・上書き・期限・乗り換えを一意に決める。
material色だけを変更し、車体voxelやdraw callを複製しない。

- 長所: 消防・工事runtimeと物理契約を変えない。
- 長所: `advanceTime()`で時間切れを決定的に検証できる。
- 長所: 追加車種もpaintable palette IDを足すだけで対応できる。
- 短所: map、runtime、material、HUDを明示的に接続する必要がある。

### B. Rapier sensor eventだけで色を管理（不採用）

enter/exit eventは便利だが、body remount、手動clock、複数sensor境界で順序依存が増える。
現在のtelemetry位置同期と同じ時点で包含判定する方がE2Eを決定的に保てる。

### C. vehicle modelを色ごとに複製（不採用）

見た目は作りやすいが、赤青黄×車種分のvoxel modelとdraw callが増え、今後の車種追加で保守不能になる。

## 世界観辞書

- カラーあそび地区: 南の自由走行道路を、左右2レーンの玩具洗車コースとして使う。
- 色水プール: 地面とほぼ同じ高さの浅い角形トレー。透明な流体ではなく、赤・青・黄の小さな色水cubeが波打つ。
- 色シャワー: 白い角形支柱と上梁を持つアーチ。上から色付きcubeの滴が繰り返し落ちる。
- 車体色: 元の造形を隠す全面単色化ではなく、塗装bodyだけが鮮やかに変わる。窓、タイヤ、金属、灯火は残す。
- HUD: 仕事pillの10px下へ、小さな色札をアンカーする。「あか 12びょう」の短いひらがなにする。
- 文言: 成否を付けず、「いろが かわった」「もとの いろ」の状態だけを伝える。
- VFX: 固定上限の`InstancedMesh`で色水cubeを循環させる。写実的な液体、透明ガラス、丸粒、paint splash decalは使わない。

背景、道路、station、車体、HUD、文言、VFXはすべて「机の上の色水あそび」という同じ語彙へ揃える。

## 配置

南地区 `X[-12, 12], Z[14, 34]` の既存道路を利用する。

```text
西レーン x=-9.4:  pool-red z=18.5 / pool-blue z=24 / pool-yellow z=29.5
東レーン x=+9.4: shower-red z=18.5 / shower-blue z=24 / shower-yellow z=29.5
```

- 各triggerは約`4.2 × 3.2unit`。車体中心判定を0.6unit拡張し、厳しい位置合わせを要求しない。
- 6 triggerは正の面積で重ならず、すべて南地区とworld bounds内へ収める。
- 既存の南地区sign postは中央寄りへ移し、trigger・車両経路・solidが重ならないようにする。
- poolとshowerは非solid。白いアーチも通り抜け可能な玩具演出にし、見た目だけの不可視衝突を作らない。

## 状態契約

`VehicleColorEffectSnapshot`は次を公開する。

```ts
interface VehicleColorEffectSnapshot {
  active: boolean;
  activationCount: number;
  colorId: 'red' | 'blue' | 'yellow' | null;
  colorHex: string | null;
  contactSourceId: string | null;
  remainingMilliseconds: number;
  remainingSeconds: number;
  sourceId: string | null;
  sourceKind: 'pool' | 'shower' | null;
  vehicleId: VehicleId | null;
}
```

遷移規則:

1. sourceへ初めて入ると、その色をvehicle IDへ適用し、残時間を12,000msへする。
2. 同じsourceへ接触中は12,000msを維持する。
3. sourceから出ると時間が減り始める。
4. 同じsourceへ再接触すると12,000msへ戻し、発動回数を1増やす。
5. 別sourceへ入ると、残時間に関係なく新しい色、kind、sourceへ即時上書きする。効果は積まない。
6. 0msでactiveをfalseにし、車体materialを元paletteへ戻す。
7. 同じ車種の選択、拒否された切替、車両resetでは効果を維持する。
8. 車庫で別車種への切替が成功したときだけ効果を解除し、新しい車は元paletteで始める。
9. 非有限または負の時間、world外座標、不正sourceは安全に無視する。

React stateはactivation、色変更、秒境界、期限、切替時だけ更新し、毎frame更新しない。

## 描画とVFX

- 各色のpool surface cubeとshower drop cubeを同じ色の`InstancedMesh`へまとめ、3 draw callにする。
- 白いpool rim／shower frameを1 batch、濃灰baseを1 batchとし、station全体を最大5 draw callにする。
- 色ごとの固定slotはpool 8、shower 18、合計26。3色で78 cubeを上限とする。
- pool cubeは上下0.08unit、shower cubeは上梁から床までphase差で循環する。
- 車体のpaintable palette material色を変更し、追加vehicle draw callは0とする。
- 車体色変更はReactの離散snapshotで行い、R3F frame内でReact stateを更新しない。

## HUDとtelemetry

- active中だけ`.color-effect-pill`を表示し、`aria-live="polite"`で色と残秒を通知する。
- pillはmissionの下へ10px以上、viewport内へ8px以上の安全余白を持つ。
- `render_game_to_text()`へ`colorEffect`と6つの`landmarks.colorPlaySources`を追加する。
- `visuals`へactive pool cube、shower cube、station draw callを追加する。
- rejected車種切替の前後でsnapshotが同一、成功切替後はinactiveであることをE2Eで固定する。

## 受け入れ条件

- [x] 赤・青・黄のプールとシャワーを南地区で一目で区別できる。
- [x] 消防車とブルドーザーのどちらでも6 sourceから色を受け取れる。
- [x] 接触中の保持、離脱後の減算、再接触、別色上書き、12秒後の復元が決定的に動く。
- [x] rejected切替は色を維持し、成功した別車種切替だけ色を解除する。
- [x] 車体の役割識別部品と既存アクションを維持したままpaint bodyだけが変わる。
- [x] 色遊びが消防・工事・積み木・車庫循環へ回帰を起こさない。
- [x] keyboardとtouchで実sourceへ走行し、色替えを完遂できる。
- [x] 1280×720、1024×768、844×390でHUDと主要対象の欠け・重なり・はみ出しがない。
- [x] unit、build、専用E2E、canonical回帰、画像目視、physical GPU再確認がPASSする。

## 非対象

- 色混合、グラデーション、任意カラーピッカー、塗装保存。
- 車体全パーツの単色化、paint decal、車体損傷、汚れ蓄積。
- 写実的流体、透明屈折、濡れshader、液面物理、丸い粒子。
- sourceを使うミッション、評価、制限時間、報酬、通貨、解除。
- 追加車両、音、追加地区、96×96超のmap、chunk streaming、LOD。

## リスクと対策

- source境界で色が連続発動する: `contactSourceId`のentry edgeだけでactivationする。
- countdownでReactが毎frame更新される: listener署名を秒単位へ量子化する。
- 元paletteが失われる: base色は静的paletteへ残し、tintは派生値だけにする。
- 車種切替で古い色が漏れる: effect ownerのvehicle IDを持ち、成功切替を単一clear pointにする。
- stationでdraw callが増える: 色3 batch＋共通2 batchの最大5へ固定する。
- 南地区が狭くなる: 既存左右道路上へ通過ギミックとして置き、中央帰路を塞がない。
- mobile HUDが重なる: missionとのアンカー間隔と4要素矩形をruntime数値で検証する。

## 性能目標

- station VFXは78 cube以下、5 draw call以下、frame中allocationなし。
- vehicle draw callは消防車7以下、ブルドーザー7以下の現契約を維持する。
- React state更新は色イベントと秒境界のみで、毎frame更新しない。
- 物理GPU 1280×720でmedian 55fps以上、p10 45fps以上を維持する。
- 72×72で目標を満たす限りchunk streaming／LODは実装しない。96×96超または性能未達時だけ再評価する。

## 検証記録（2026-08-01）

- 専用E2EはDesktop 1280×720 keyboard、Tablet 1024×768 touch、Mobile landscape 844×390 touchで、赤pool、離脱countdown、再接触、青上書き、12秒後の復元、黄showerを実走した。
- 車庫外の拒否切替では色効果を維持し、帰庫後の実UIによるブルドーザー切替で解除した。Desktopでは続けてブルドーザーを赤poolへ走らせ、二車種での適用を確認した。
- 6枚の原寸画像で、青い車体とpool、黄色い車体とshower滴、役割識別部品、HUDを確認した。mission pillと色pillの間隔は全viewportで10px、viewport内余白は8px以上だった。
- station実測はpool 24 cube、shower 54 cube、合計78 cube、5 calls。車体は両車7 callsを維持した。
- Apple M4／ANGLE Metal、1280×720、2秒warm-up＋12秒probeで、消防車はmean 59.92fps／median 59.88fps／p10 56.82fps／scene 28 calls、ブルドーザーはmean 58.92fps／median 59.88fps／p10 56.82fps／scene 27 callsだった。
- 72×72の現mapで性能目標を満たしたため、chunk streaming／LODは実装しない。96×96超への拡張または物理GPU性能未達を再検討条件とする。
- Docker内fresh unitは32 files／303 tests、production build、canonical full、二車種専用E2EがすべてPASSした。canonicalは`completed/full`、browser errorはconsole／page／requestとも0件だった。
- canonicalで再現した中央交差点の過剰な中心合わせと、背面放水経路の東端driftは、道路幅に沿う許容差と「Xを内側へ退避→Z→X再補正」の経路順へ限定修正した。production-map、collision、nonbreakの各focusと最終fullで実走回帰した。
- main commit `10be9bf`のGitHub Pages run `30690142015`はunit、build、deployがsuccess。remote SHAは一致し、ahead／behindは`0/0`だった。
- 公開URLへの専用E2Eも3 viewportでPASSし、manifestは`2026-08-01T07:42:08.393Z`。公開配信物から撮り直した6画像を原寸確認し、station、青／黄の車体、shower滴、HUD、操作系に欠け・意図しない重なり・はみ出しがないことを確認した。

# 箱庭物理整合と車庫再設計 設計書

## 状態

- 会話設計: 2026-07-23 承認済み
- Written spec: 2026-07-23 承認済み
- Implementation: Tasks 1〜4完了後に検証結果を記録
- 対象entry: `voxel-game.html`
- 基準設計: `docs/design/2026-07-20-direct-drive-and-voxel-vfx-design.md`

## 目的

消防車が、質量のある玩具オブジェクトをすり抜けない箱庭へ仕上げる。すべての表示物を無差別にsolid化するのではなく、構造物・遊具・燃焼中の危険物と、道しるべ・水・星などの演出物を意味で分ける。

本設計は、本編開発の最初の独立単位である「箱庭物理の完成」だけを扱う。新Voxel Gameの`/`昇格と旧ゲーム削除、2台目以降の車両・ミッション追加は後続の独立設計とする。

## 世界観辞書

- 構造物: 木製・白壁・赤い遊具など、厚みと質量が見える玩具は消防車を止める。
- 危険物: 炎は固い物体ではないが、燃焼中は消防車が踏み越えない小さな危険領域として扱う。消火後は領域も消える。
- 道しるべ: 道路上の薄い発光タイル。案内表示であり障害物ではない。
- 装飾: 樹冠、窓、屋根の化粧部材は簡略化した非solid表現とする。構造本体のcolliderで見た目の整合を保つ。
- 地表: 道路線、芝、池、積み木広場の土台は床面表現であり、個別の側面colliderを持たない。
- VFX: 水、飛沫、成功星は物理bodyを持たず、車両を止めない。

判断原則は「重そうに見える物は止まり、演出物は通過しても不自然に見えない形へ変える」とする。

## 要件差分台帳

| ID | 状態 | 要件 | 理由・影響・代替・復帰条件 |
|---|---|---|---|
| COLL-001 | 強化 | 木の幹3本と火災建物本体の既存colliderを維持する | 既存の共有visual/collision定義と実走回帰をそのまま基盤にする。 |
| COLL-002 | 強化 | 樹冠・窓・屋根装飾を非solidとして維持する | 大判colliderによる見えない引っ掛かりを避ける。構造本体で進入を止める。 |
| PHYS-001 | 追加 | 質量のある静的オブジェクトは、描画と同じ共有定義からfixed colliderを生成する | 見た目と物理の位置ずれを防ぎ、個別meshとcolliderの二重定義を禁止する。 |
| PHYS-002 | 追加 | 消防車庫の背面壁・左右壁をsolid化し、正面開口から出入りできる寸法へ再設計する | 現行寸法のままsolid化すると初期車両と既存走行経路を閉じ込めるため。 |
| PHYS-003 | 追加 | 中央公園の赤い遊具の板と黄色い支柱をsolid化する | 低いが質量のある遊具をすり抜ける不自然さをなくす。傾いた板のrotationもcolliderへ共有する。 |
| PHYS-004 | 追加 | 炎が1層以上ある間だけ、炎の根元へ小さなfixed hazard colliderを有効化する | 火災現場を消防車で踏み越えず、消火後は自由走行できるようにする。 |
| VIS-001 | 追加 | 黄色い道しるべを道路へ埋め込んだ薄い発光タイルへ変更し、非solidを維持する | 現行cubeが柵や障害物に見える誤解をなくす。案内UIとして通過可能であることを形で伝える。 |
| REG-003 | 追加 | PC/touchの車庫出発・消火・自由走行・帰庫再開を、新しい車庫開口とcolliderで完走する | 物理追加による経路詰まりをrelease blockerとして扱う。 |
| REG-004 | 追加 | 炎は消火前に車両を止め、消火後に同じ領域を通過可能にする | dynamic colliderの有効/無効がruntime状態と一致することを保証する。 |
| MIG-001 | 維持 | 旧ゲームと`/`は本変更で削除・切替しない | 移行は参照一覧と明示許可を伴う別タスクで行う。 |

### 要件差分

| 区分 | 対象 | 理由 | 影響・代替・復帰条件 |
|---|---|---|---|
| 維持 | 画面方向操作、水流、4色破壊、木・建物の既存衝突 | 承認済みの中核体験を変えない | 全統合E2Eを回帰gateにする。 |
| 追加 | PHYS-001〜004、VIS-001、REG-003〜004 | 残るすり抜けと見た目上の誤認を一括解消する | static構造物とruntime連動の炎を分けて実装する。 |
| 保留 | `/`昇格、旧ゲーム削除、追加車両・追加区画 | 物理基盤を先に安定させる | 本設計完了後に独立specを作る。 |
| 削除 | なし | 既存機能を暗黙に落とさない | 破壊的削除は別途明示承認を得る。 |

## 採用アプローチ

意味に応じた物理整合方式を採用する。

- 不採用A: 見える全cubeをsolid化する。道しるべ、炎、水、星まで壁になり、プレイループと性能を損なう。
- 不採用B: 指摘箇所だけへ個別colliderを足す。別のすり抜けが順番に残り、visual/collision二重定義が増える。
- 採用: 静的構造物、runtime連動の危険領域、非solid演出物を明示的に分類し、それぞれの契約をテストする。

## 静的オブジェクト設計

### 共有定義

`worldCollisionLayout.ts`の`BoxDefinition`を、必要に応じてEuler rotationを持てる静的形状定義へ拡張する。描画側とRapier側は同じ`position`、`scale`、`rotation`を参照する。

静的solidは1個のfixed `RigidBody`配下へまとめる。

- 木の幹: 3 collider
- 火災建物本体: 1 collider
- 車庫: 背面壁1、左右壁2
- 公園遊具: 傾いた板1、支柱1

合計9個を上限とし、動的bodyは増やさない。

### 車庫寸法

車両初期位置`[0, 0.8, 14]`と車体colliderの回転外形を基準に、初期重なりがなく、前方へ直進後に外周道路上で横移動へ切り替えられる開口を作る。

初期候補は次とする。実装時はpure clearance helperで車体外形との余白を数値確認し、必要なら同じ設計意図の範囲で微調整する。

- 背面壁: `position [0, 1.8, 11.6]`、`scale [8.8, 3.4, 0.8]`
- 左右壁: `position [±4.0, 1.8, 13.0]`、`scale [0.8, 3.4, 3.0]`
- 正面開口: `+Z`方向。車両中心が`Z=16.2`前後まで直進してから外周道路を横移動する。

赤い屋根・帯は新しい壁寸法へ追従させる。車両上部の装飾梁は、通常姿勢の車体との鉛直余白を確保し、走行を塞がない。

### 公園遊具

赤い板は現在の`rotation [0, 0, -0.2]`を描画とcolliderで共有する。黄色い支柱も同じ位置・寸法からcolliderを生成する。車両が接触した際は止まるが、転倒・reset・操作不能にならないことを確認する。

## 動的な炎の危険領域

炎の描画3層とは別に、根元の見た目へ収まる単純なcuboid colliderを1個だけ使う。

- 有効条件: `fireIntensity > 0`
- 無効条件: 消火完了で`fireIntensity === 0`
- 再有効化: 車庫帰還による次ミッション開始
- collider候補: 炎の下2層を大きく越えない`約1.2 × 1.8 × 1.2`
- body種別: fixed。毎frame生成せず、低頻度なmission stateでenabledを切り替える。

このcolliderは「炎が固い」という表現ではなく、幼児向けゲームで危険物を踏ませないための進入防止契約である。放水可能距離6unitと前方照準は変更しない。

## 道しるべの再表現

黄色い道しるべは高さ0.62のcubeから、道路面より少し上にある薄い発光タイルへ変える。

- 水平寸法: 現行約0.62を維持
- 高さ: 約0.10〜0.14
- 位置: 路面へ埋め込み、車輪止めや柵に見えない高さ
- 物理: colliderなし
- 表示条件: 現行どおり`assigned`/`active`で表示し、目的地到着後に消す

車両は道しるべを通過でき、速度・yaw・resetへ影響しない。

## アーキテクチャ境界

- `scene/worldCollisionLayout.ts`: 静的visual/collision共有定義、rotation、half extents変換、車庫clearance用pure helper。
- `scene/VoxelWorld.tsx`: 共有定義から静的meshと9 colliderを構成する。
- `scene/WaterAndFire.tsx`: fire stateとhazard colliderのenabled同期、薄い道しるべの描画を担当する。
- `scene/worldLayout.ts`: 車両開始位置、車庫再開半径、mission上の代表位置だけを維持する。
- `domain/VoxelGameRuntime.ts`: mission/fire遷移は変更しない。

高頻度状態をReact stateへ追加しない。炎colliderの切替は既存の低頻度visual stateを使う。

## エラー処理と安全策

- scaleが0以下、座標が非有限、rotationが非有限の静的定義はunit testで拒否する。
- 車庫初期位置がwall AABBと重なる変更はpure clearance testで失敗させる。
- 炎collider refが未準備のframeは操作せず、次の低頻度同期で正しいenabled状態へ合わせる。
- collider追加で車両が閉じ込められた場合、world resetを成功扱いにしない。実走経路を修正する。
- static colliderとvisualの位置・scale・rotationを別リテラルで重複記述しない。

## テスト設計

### Unit RED → GREEN

1. 9個の静的solidが一意ID、有限座標、正scaleを持つ。
2. 木・建物・車庫・遊具のvisualとcolliderが同一共有定義を使う。
3. 傾いた遊具板のrotationがRapier colliderへ渡る。
4. 初期車両外形と車庫3壁に正のclearanceがある。
5. 正面出口経路上で、車両外形が左右壁の終端を越えてから横移動できる。
6. `fireIntensity > 0`でhazard enabled、0でdisabled、帰庫再開でenabledへ戻る。
7. 道しるべの高さが上限0.14以下で、collider一覧へ含まれない。

### Browser E2E

1. PCとtouchで、車庫内の初期重なりなし、正面出庫、消火、自由走行、正面帰庫、再開を完走する。
2. 車庫背面壁・側壁へ押し続けてもAABBを横断せず、逆入力で離脱できる。
3. 公園遊具へ実車で接触し、貫通・reset・操作不能がない。
4. 消火前の炎根元へ進入できず、放水で消火した後は同じ領域を横断できる。
5. 道しるべ上を走行でき、速度低下・衝突・破壊eventが発生しない。
6. 既存の木・建物衝突、画面方向操作、水流、4色破壊、復元を回帰確認する。
7. Desktop 1280×720、tablet landscape 1024×768、mobile landscape 844×390を原寸目視する。
8. 旧Vehicle Labと旧`/`entryを含む3-entry buildを維持する。

## 実装・検証状態

- Tasks 1〜4: 2026-07-26 実装・レビュー完了。
- Unit: Docker内で19 files / 123 testsがPASS、失敗0件。
- Build: Docker内のproduction buildがPASSし、`index.html`、`vehicle-lab.html`、`voxel-game.html`を生成。既知の500kB超chunk警告のみ。
- Voxel Game E2E: fresh full runが`full: true`、`mode: "full"`、`status: "completed"`、`contractFailures: []`、console/page/request errorが0/0/0で完了。
- Mission: PC/touchとも消火・自由走行・帰庫を完走し、`assigned`かつ`atGarage: true`で再開。
- Physics: 木、建物、車庫背面・右壁、遊具板の実接触、燃焼中の炎停止・消火後の同領域通過、12個の道しるべ通過を確認。
- Regression: 水pool 24 stream + 8 splash、draw-call delta 2、4色それぞれ6主破片、約1.2秒終了、5秒復元を維持。
- Vehicle Lab E2E: `status: "completed"`、`verificationFailures: []`、3 viewportともbrowser error 0件。
- Visual: Desktop 1280×720、tablet landscape 1024×768、mobile landscape 844×390の代表画像を原寸目視し、HUDの安全余白、車庫開口、車両、道しるべ、放水、blank/clippingなしを確認。
- Performance: DockerはSwiftShaderのため機能・レイアウト証跡のみ。物理GPUでの性能認証は未実施。

## 受け入れ条件

- 車両が木、火災建物本体、車庫3壁、公園遊具2部品を貫通しない。
- 車両は初期位置でどのcolliderとも重ならず、正面開口から自然に出入りできる。
- PC/touchの完全ミッションがresetや見えない引っ掛かりなしで完走する。
- 炎は燃焼中だけ進入を止め、消火後は同じ場所を通過できる。
- 道しるべは薄い道路灯として読め、非solidでも不自然に見えない。
- 衝突後に車両が転倒、境界外reset、入力不能にならない。
- 描画とcolliderのposition、scale、rotationが共有定義から生成される。
- 画面方向操作、水流、飛沫、4色破壊、5秒復元を壊さない。
- Docker内unit、build、fresh full E2Eが成功し、console/page/request errorが0件である。

## 非対象

- 樹冠、窓、屋根装飾、道路線、道しるべ、水、飛沫、星へのcollider追加。
- 芝、池、積み木広場土台の段差物理やサスペンション。
- 炎によるダメージ、ゲームオーバー、押し戻しアニメーション。
- 車庫のドア開閉、シャッター、車両選択UI。
- 追加車両、追加ミッション、72×72箱庭拡張。
- 新Voxel Gameの`/`昇格と旧ゲーム削除。

## 性能目標

- static colliderは1 fixed body配下の9 cuboid以内。
- runtime連動の炎は1 fixed colliderだけとし、毎frame再生成しない。
- 動的body数、消防車7 draw calls、水2 draw calls、主破片24slot、chip32slotを増やさない。
- 道しるべのdraw call数を増やさず、現行InstancedMeshを維持する。
- 物理GPUでDesktop 60fps、Mobile/Tablet 30fpsの既存目標を維持する。
- SwiftShaderでは機能回帰を確認するが、物理GPU性能を認証したと主張しない。

## リスクと対策

| リスク | 対策 |
|---|---|
| 車庫壁をsolid化すると初期車両が重なる | 車体回転外形と3壁のclearanceをpure testし、正の余白を必須にする。 |
| 出口で横へ曲がる時に側壁へ引っ掛かる | 正面へ十分進んでから横移動するrouteとE2E helperへ更新する。 |
| 遊具の傾きとcolliderがずれる | rotationを共有定義へ含め、React tree上のRapier propsまでtestする。 |
| 炎colliderで放水距離へ入れない | 根元だけの小型colliderに限定し、既存6unit照準と完全消火を実走確認する。 |
| 消火後も見えない壁が残る | fire intensityとcollider enabledを同じ低頻度stateから同期し、消火前後の横断E2Eを作る。 |
| 道しるべが薄くなって見失う | emissive色と水平寸法を維持し、3 viewportで道路とのコントラストを目視する。 |
| collider増加で長時間runが不安定になる | staticは単一fixed bodyへ集約し、full E2Eのreset数・console error・FPS情報を保存する。 |

## 後続フェーズ

本設計の受け入れ後、次の順で別specを作る。

1. 新Voxel Gameの正式採用と`/`移行。旧コード削除候補を参照確認し、削除直前に明示許可を得る。
2. 2台目の働く車と車種別ミッション。
3. 高密度な追加区画を接続し、箱庭を段階的に拡張する。

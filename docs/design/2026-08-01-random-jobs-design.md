# ランダム仕事・複数現場 設計

## 目的

消防車とブルドーザーの公開済み仕事を、同じ現場の反復から「車庫へ戻るたびに次の依頼が届く」
遊びへ育てる。見た目だけの抽選表示にはせず、炎・がれき・道しるべ・当たり判定が実際に別の
現場へ移る。既存の運転、放水、ブレード、積み木破壊、色遊びは維持する。

## 要件台帳

| ID | 状態 | 要件 | 今回の扱い |
| --- | --- | --- | --- |
| REQ-001〜REQ-045 | 維持 | 純ボクセル、二車種、72×72箱庭、物理、色遊び、公開・性能契約 | 既存テストを回帰として維持する。 |
| REQ-046 | 追加 | 各車種に3件の実在する仕事現場がある | 消防車3火災、ブルドーザー3がれき配置を定義する。 |
| REQ-047 | 追加 | 1巡で同じ仕事を重複せず、帰庫後に前回と異なる仕事を割り当てる | 車種別のshuffle bagを使う。 |
| REQ-048 | 追加 | 抽選はテストで完全再現できる | seed付きpure job deckとし、公開telemetryへseed・巡回番号を出す。 |
| REQ-049 | 追加 | 仕事札、道しるべ、対象、照準、衝突、進捗が同じ仕事を指す | 選択中job definitionを全consumerの唯一の入力にする。 |
| REQ-050 | 追加 | 乗り換えでは未完了の依頼を捨てず、完了後の帰庫だけで次へ進む | 車種ごとに独立した現在仕事を保持する。 |
| REQ-051 | 追加 | 既存固定poolと低頻度React更新を維持する | 最大slot数は増やさず、matrixの座標だけを仕事に合わせて更新する。 |
| REQ-052 | 追加 | PCとtouchで仕事を2周し、異なる現場を完了できる | 専用E2Eでseed固定・非連続・帰庫再抽選を確認する。 |

## 要件差分

| 区分 | 対象 | 理由 | 影響 |
| --- | --- | --- | --- |
| 維持 | REQ-001〜REQ-045 | 公開済みの完成品質を基盤にする | 操作、色、物理、performance budgetを変えない。 |
| 追加 | REQ-046〜REQ-052 | 反復時の目的と経路変化を作る | job deck、複数現場、telemetry、E2Eを追加する。 |
| 保留 | 救急車、パトカー、ショベルカー、音、追加地区 | 本縦切りを仕事循環へ絞る | 次の独立タスクで追加する。 |
| 削除 | なし | 既存遊びを失わない | なし。 |

## 世界観辞書

- 背景: 明るい木の床と、色分けされた72×72の箱庭。
- 働く車: 赤い消防車、黄色いブルドーザー。塗り替えても梯子・放水口・ブレード・履帯で役割が分かる。
- 仕事: 車庫の木製おしごとボードから届く、短いひらがなの依頼。
- 道しるべ: 地面へ並ぶ小さな色付き積み木。矢印テクスチャや写実的標識は使わない。
- 対象: 赤橙黄の玩具の炎、木・石・箱のがれき。仕事外の対象は当たり判定も進捗も持たない。
- 成功: 既存の明るい星ボクセルと「できた！」。評価、報酬、失敗演出は足さない。
- HUD: 上中央の仕事札をアンカーにし、車両セレクター、色札、全画面、左右操作を既存安全余白へ保つ。

## 採用方式

### A. seed付きshuffle bag（採用）

各車種の3仕事をseed付きのFisher-Yatesで並べ、末尾から1件ずつ取り出す。bagを使い切るまで
重複せず、補充時に新しい先頭が直前仕事と一致した場合は交換する。初期seedはブラウザ境界で
1回だけ生成し、`?job-seed=<uint32>`があればそれを優先する。

- 長所: 実際に変化し、同じ仕事が連続せず、E2Eでは完全再現できる。
- 長所: `Math.random()`をdomain／frame loopへ持ち込まず、保存機能なしでも1 session内は安定する。
- 短所: リロードすると通常は別seedになる。保存は今回の非対象なので許容する。

### B. 固定ローテーション（不採用）

常に同じ順序で3仕事を回す。再現性は高いが、ランダム仕事としての期待に届かない。

### C. 毎回独立抽選（不採用）

帰庫ごとに全候補から選ぶ。直前と同じ依頼が続きやすく、短いプレイでは変化が伝わりにくい。

## 仕事定義

### 消防車

| job ID | 仕事札 | 炎の照準点 | 現場 |
| --- | --- | --- | --- |
| `fire-side` | よこの火をけそう | 既存の東側面 | 火災地区の家の右側 |
| `fire-window-left` | ひだりのまどをけそう | 左窓の外側 | 火災地区の家の正面左 |
| `fire-window-right` | みぎのまどをけそう | 右窓の外側 | 火災地区の家の正面右 |

3件とも既存の火災地区に収め、最終道しるべだけを現場へ分岐させる。既存の2500ms消火、
3層18slot炎、最大32水cube、hazard 1個、1800ms成功演出を維持する。

### ブルドーザー

| job ID | 仕事札 | がれき配置 | 現場 |
| --- | --- | --- | --- |
| `debris-north` | きたのがれきをかたづけよう | 既存の北側3個 | 積み木地区北端 |
| `debris-south` | みなみのがれきをかたづけよう | 南側の横一列3個 | 積み木地区南端 |
| `debris-west` | にしのみちをかたづけよう | 西側の縦一列3個 | 積み木地区西端 |

各仕事は木・石・箱を1個ずつ持ち、既存の12本体cube、18chip、7道しるべ、12成功星の
固定slotを使い回す。通常の4色積み木と3unit以上離す。

## 状態遷移

```text
session seed
  -> 車種別job bagを作る
  -> 初期仕事を1件ずつ割り当てる
  -> selected vehicleのassigned / active / celebrating / freeRoam
  -> 完了後に車庫へ入る
  -> 同じ車種のbagから次仕事を取得してruntimeをreset
  -> assignedへ戻る
```

- 車庫内の乗り換えは現在仕事をresetするが、job IDは変えない。
- 未完了で車庫へ戻っても仕事は変わらない。
- `freeRoam`から車庫へ戻ったときだけ巡回番号を1増やす。
- 消防車とブルドーザーのbag、現在job、巡回番号は互いに独立する。

## 境界と責務

- `domain/JobDeck.ts`: seed正規化、PRNG、shuffle bag、直前重複回避。
- `domain/vehicleJobs.ts`: 車種別job定義とvalidation。Three／Reactへ依存しない。
- `VehicleMissionCoordinator`: 現在job、帰庫完了検出、runtime再割当、共通snapshot。
- `productionWorldMap.ts`: 全候補現場の座標とmap境界validation。
- `WaterAndFire.tsx`: 選択火災jobの照準点・炎・hazard・道しるべを固定poolへ転送。
- `BulldozerDebrisMission.tsx`: 選択工事jobの3対象・道しるべを固定poolへ転送。
- `VoxelGameApp.tsx`: session seed生成、HUDと`render_game_to_text()`への公開。

React stateは車種、phase、進捗、job IDの離散変更だけを購読する。車両位置、水、炎、chipの
連続更新は既存どおりref、Rapier、`InstancedMesh`へ閉じる。

## UIアンカー

- 仕事札はCanvas上端中央に維持し、現在jobの短い名称と進捗を表示する。
- 色札は仕事札の下端から10px以上離す既存アンカーを維持する。
- 車両セレクターは左上、全画面は右上、stickは左下、primary actionは右下。
- 844×390でも仕事札・色札・セレクター・全画面の矩形がviewportへ8px以上収まり、相互に重ならない。

## 受け入れ条件

- [x] 各車種に3仕事あり、仕事札・対象・道しるべ・照準／接触判定が同じjobを指す。
- [x] 同一車種で3件を使い切るまで重複せず、前回と同じjobが連続しない。
- [x] seedが同じなら仕事順、seedが異なれば少なくとも検証seed間の順が異なる。
- [x] 未完了の帰庫と車種切替ではjobが変わらず、完了後の帰庫だけで次jobになる。
- [x] 消火時間、がれき3個、成功1800ms、自由走行、通常積み木、色効果が維持される。
- [x] PC 1280×720、Tablet 1024×768、Mobile landscape 844×390で2周の仕事を完了できる。
- [x] 全viewportでHUDの重なり・はみ出し・操作阻害がなく、代表画像を原寸目視する。
- [x] console、page、request errorが0件で、telemetryが実描画と一致する。
- [x] unit、typecheck、budget付きbuild、canonical、専用E2E、ローカル本番smokeがPASSする。

## 非対象

- ゲームオーバー、制限時間、評価、ランキング、通貨、報酬、機能解放、保存、進行管理。
- 一度に複数の仕事を受注するqueue、仕事の拒否、手動再抽選。
- 追加車両、効果音、BGM、サイレン、振動、追加地区。これらは次の独立タスクとする。
- 写実的な炎・煙・土煙、流体、車体損傷、精密サスペンション、マルチプレイ。
- 72×72で性能目標を満たす限り、chunk streamingとLOD。

## 性能目標

- fireは既存3 draw call、hazard 1 collider、water 2 draw callを維持する。
- bulldozer仕事は本体3、chip 3、route 1、star 1の既存8 draw callを維持する。
- job切替時だけmatrix／低頻度stateを更新し、毎frameのgeometry・material・大配列生成を増やさない。
- physical GPUで中央値55fps以上、p10 45fps以上を維持する。
- entry 350kB、通常chunk 600kB、Three 750kB、Rapier 2.25MBのbuild budgetを維持する。

## リスクと対策

| リスク | 対策 |
| --- | --- |
| random順でE2Eが不安定になる | query seedと公開telemetryを用意し、テストはjob座標から経路を導出する。 |
| job表示と実対象がずれる | coordinatorのcurrent job definitionだけをHUD・scene・telemetryへ渡す。 |
| fire colliderが建物へ埋まる | target外側へhazard offsetを置き、各jobの建物外接面との関係をunit＋実走で確認する。 |
| がれきが通常積み木やsolidへ重なる | map validationで地区、相互間隔、breakable／solid clearanceを拒否する。 |
| 帰庫と乗り換えで意図せず再抽選される | `freeRoam -> assigned`の完了帰庫だけをjob advance eventにする。 |
| pool数やdraw callが増える | 同時に描くのは選択jobの3対象だけとし、既存固定slotを座標差し替えで再利用する。 |

## 実装・検証結果

- Docker内のfresh unitは37 files／358 tests、E2E pure helperは24 testsがPASSした。production buildは641 modulesで、game 93,654 bytes、通常vendor最大192,532 bytes、Three 718,551 bytes、Rapier 2,237,128 bytesとなり、全budgetを満たした。
- canonical fullは全scenarioが成功し、33 artifacts＝33 screenshot proofs、contract failure 0、console／page／request error 0/0/0だった。消防車missionは3 viewportすべてで異なる2仕事を完了し、帰庫後に3件目を割り当てた。
- 二車種専用E2Eは3 viewportすべてでブルドーザーの異なる2仕事を完了し、帰庫後に3件目を割り当て、消防車への復帰と放水まで完走した。色遊び専用E2Eも3 viewportでpool／shower、再接触、上書き、時間切れ、乗り換え競合を維持した。
- canonical 33枚、二車種9枚、色遊び6枚、Vehicle Lab 15枚を原寸目視した。3現場の対象・道しるべ、消防車／ブルドーザー、炎、水、破片、色シャワー、HUD、PC／touch操作系に欠け・意図しない重なり・はみ出しはない。
- 色シャワー直後は3 frameの描画安定待ちと実寸HUD検査を撮影前へ追加した。全viewportでmission上端12px、viewport余白8px以上、mission／color間10px以上を実測している。
- 火災経路はjob telemetryから接近面を導出し、側面火災は東側、窓火災は北側道路から照準する。復元後のhazardも現在job座標と接近面で再取得し、古いjob座標への依存を除いた。
- random job切替は既存の固定VFX pool、collider数、draw callを増やさず座標だけを低頻度更新する。Task 7の差分はE2E／文書だけでproduction renderer・physics・geometryを変えていないため、物理GPU再認証条件は成立しない。公開済みApple M4の消防車28 calls／ブルドーザー27 callsとmedian 59.88fps／p10 56.82fpsを性能基準として維持する。
- ローカル本番smokeでは生成bundleのroot、互換URL、Vehicle Labを1280×720で起動し、3入口のCanvasとerror 0件を確認した。GitHub Actions／Pages／公開URLの結果はTask 7公開後に追記する。

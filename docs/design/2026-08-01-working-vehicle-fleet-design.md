# 働く車5台化 設計

## 目的

消防車とブルドーザーが走る72×72の玩具箱庭へ、ショベルカー、救急車、パトカーを追加する。
見た目だけを切り替える車両にはせず、各車両の象徴的な部品が動き、3件ずつの実在する仕事を
PCとtouchの同じ主操作で完了できるようにする。既存の自由走行、積み木破壊、色遊び、
ランダム仕事、帰庫再抽選は維持する。

## 要件台帳

| ID | 状態 | 要件 | 今回の扱い |
| --- | --- | --- | --- |
| REQ-001〜REQ-052 | 維持 | 純ボクセル、二車種、72×72、物理、色遊び、各3仕事、公開・性能契約 | 既存unit／E2Eを回帰gateにする。 |
| REQ-053 | 追加 | 最初から5台すべてを選べる | 車庫selectorと型付きregistryへ3台を追加する。 |
| REQ-054 | 追加 | 車種は色だけでなく外形と役割部品で識別できる | アーム、赤十字、赤青灯を純voxelで作る。 |
| REQ-055 | 追加 | ショベルカーで土山を掘れる | 停止接近し、バケットを0.7秒動かして3山を掘る。 |
| REQ-056 | 追加 | 救急車で玩具を手当てできる | 公園の対象へ停止接近し、1.2秒手当てする。 |
| REQ-057 | 追加 | パトカーで巡回できる | 南地区の3地点をサイレン作動中に走り抜ける。 |
| REQ-058 | 追加 | 追加3台も各3仕事を重複なしで巡回する | 既存seed付きshuffle bagと完了帰庫契約へ統合する。 |
| REQ-059 | 追加 | 追加仕事の表示、対象、判定、進捗、telemetryが一致する | 選択job definitionを唯一の入力にする。 |
| REQ-060 | 追加 | 車種追加で毎frame React更新と可変poolを増やさない | pure runtime、ref、固定slot `InstancedMesh`を使う。 |
| REQ-061 | 追加 | 5台で一時塗装と役割部品の色を競合させない | body paletteだけを塗り、窓・履帯・赤十字・灯火・bucketを保護する。 |
| REQ-062 | 追加 | PC／Tablet／Mobileで追加3台を実操作完遂できる | 専用E2Eと実画面証跡を車両ごとに追加する。 |

## 要件差分

| 区分 | 対象 | 理由 | 影響 |
| --- | --- | --- | --- |
| 維持 | REQ-001〜REQ-052 | 公開済みの完成品質を基盤にする | 消火、がれき、色、積み木、物理、HUDを変えない。 |
| 追加 | REQ-053〜REQ-062 | 当初コンセプトの複数の働く車を完成させる | 3モデル、共通仕事runtime／scene、15仕事へ拡張する。 |
| 保留 | 効果音、BGM、実音サイレン、振動 | 車両と仕事の正しさを先に独立評価する | 次タスクで5台へ横断実装する。 |
| 保留 | 追加地区、map拡張、chunk streaming | 現在地で3台の縦切りを検証できる | 車両公開後に独立実装する。 |
| 削除 | なし | 既存遊びを失わない | なし。 |

## 世界観辞書

- 背景: 明るい木の床、色面で分かれた積み木の箱庭、黒い道路と黄色い中央線。
- 車体: 角を少し落とした密度の高い純ボクセル玩具。写実的な金属、texture、ロゴ画像は使わない。
- ショベルカー: 橙の車体、黒い履帯、青い窓、黄橙の長いアーム、灰色bucket。主操作でbucketが土へ沈む。
- 救急車: 白い箱形車体、赤い帯と赤十字、青緑の窓、赤色灯。主操作中は赤十字と灯火がやさしく脈動する。
- パトカー: 白黒の低い車体、青緑の窓、屋根の赤青灯。主操作中は赤青灯が交互に明滅する。
- 仕事対象: 土山は茶色の積み木、要救助玩具は丸頭と体の小さな人形、巡回地点は赤青の門型積み木。
- 道しるべ: 車種色の小さな浮遊cube。写実的な矢印や道路標識は使わない。
- 成功: 既存の黄白い星ボクセルと「できた！」。失敗、評価、報酬、罰は追加しない。
- HUD: 上中央の仕事札、左上selector、右上fullscreen、左下stick、右下主操作を既存アンカーへ固定する。

## 遊びの定義

### ショベルカー

- 車庫から西の積み木地区へ向かい、3つの土山を順不同で掘る。
- bucket中心が土山半径内、速度0.45以下、主操作継続0.7秒で1山を完了する。
- 土山は固定voxelから小さな土粒へ崩れ、bucketは押下中だけ下がる。
- 仕事札は「つち あとNこ」、主操作は「バケット」。

### 救急車

- 公園にいる1体の玩具へ向かい、近くで停止して手当てする。
- 患者を車体で隠さず横へ止められるよう、車体中心が半径2.4以内、速度0.35以下、主操作継続1.2秒で完了する。
- 対象は手当て中に白赤の小cubeで脈動し、完了時に起き上がる表現にする。
- 仕事札は「てあてをしよう」、主操作は「てあて」。

### パトカー

- 南地区の3つの巡回門を、サイレンを作動させながら順不同で通る。
- 車体中心が半径1.5以内、速度0.35以上、主操作継続0.25秒で1地点を完了する。
- 通過済み門は明るい白へ変わり、車体の赤青灯は主操作中に交互点滅する。
- 仕事札は「みまわり あとNかしょ」、主操作は「サイレン」。音は次タスクで同じ入力へ接続する。

## 採用アーキテクチャ

### A. 共通ActionTarget仕事基盤（採用）

追加3台を、型付きjob definition、`ActionTargetMissionRuntime`、固定pool sceneで扱う。
車種差は対象形状、接触中心、速度範囲、必要継続時間、文言としてデータ化する。

- 長所: 仕事の状態遷移、帰庫、shuffle bag、telemetry、E2E契約を3台で共有できる。
- 長所: 次の働く車もregistryとmodelを足す境界が明確になる。
- 短所: 車両ごとの特殊演出はmodel／VFX strategyとして別実装が必要になる。

### B. 既存ブルドーザーruntimeを3台へ流用（不採用）

短期差分は小さいが、`debris`という語と速度条件が救急・巡回へ漏れ、型とtelemetryが嘘になる。

### C. 車両ごとの独立runtime／scene（不採用）

表現自由度は高いが、同じphase、帰庫、固定pool、接触継続が3系統へ複製される。

## 境界と責務

- `vehicleDefinitions.ts`: 5車種のID、物理、collider、表示、主操作。
- `vehicleJobs.ts`: 15仕事と追加3台のtarget／interaction definition。
- `ActionTargetMissionRuntime.ts`: 対象の冪等完了、成功1800ms、自由走行、帰庫再開。
- `VehicleMissionCoordinator.ts`: 5つのjob deck／runtime、選択、離散snapshot、完了帰庫再抽選。
- `ActionTargetMission.tsx`: actual接触継続、固定target／particle／route／star pool、telemetry。
- `excavatorVoxels.ts`等: 役割部品が読める純voxel model data。
- `VoxelExcavator.tsx`等: palette batchと主操作中の部品アニメーション。
- `VehicleController.tsx`: registry解決済みIDから対応modelだけを描画する。
- `VoxelGameApp.tsx`: 5台選択、仕事ref、HUD、公開telemetry。

React stateは選択車種、仕事phase、完了数、job ID、色効果だけを購読する。接触時間、車両位置、
bucket／灯火、target粒子は毎frame refと既存clockへ閉じる。

## UIアンカー

- selectorは左上へ3列2段で置く。844×390でも高さ104pxに収め、左下stickとの縦方向の安全余白を確保する。
- selector外接矩形はmission札から8px、joystickから12px、viewport四辺から8px以上離す。
- 844×390では短い車名を使い、selectorボタン高さを子要素実寸から逆算する。
- 色札表示中もmission札、selector、fullscreen、stick、主操作と重ねない。

## 受け入れ条件

- [x] 5台が車庫で選択でき、車庫外・走行中の拒否契約を維持する。
- [x] 追加3台の外形、役割部品、主操作アニメーションが車種ごとに識別できる。
- [x] 追加3台が各3仕事を持ち、1巡内非重複・補充境界非連続・seed再現を満たす。
- [x] ショベル3山、救急1体、警察3地点の速度・距離・継続時間gateがpure testと実走で一致する。
- [x] 未完了帰庫と乗り換えでは仕事を変えず、完了帰庫だけで次仕事へ進む。
- [x] bodyだけが一時塗装され、役割部品の色とdraw call数を維持する。
- [x] 既存消防、ブルドーザー、自由積み木、色遊び、物理衝突を回帰させない。
- [x] 1280×720、1024×768、844×390でselector、仕事、主操作に欠け・重なり・操作阻害がない。
- [x] console／page／request error 0、telemetryと実描画一致、代表画像原寸目視を満たす。
- [x] fresh unit、budget付きbuild、専用E2E、canonical、production smoke、公開E2EがPASSする。

## 非対象

- 音、BGM、実音サイレン、振動。次の横断タスクで追加する。
- 新地区、world境界拡張、chunk streaming、LOD。後続mapタスクで判断する。
- 人体表現、けがの写実表現、犯罪、追跡、逮捕、衝突ダメージ。
- 精密な多関節IK、土の地形変形、流体、車内、乗降、報酬、スコア、制限時間。

## 性能目標

- 各車両modelは800 voxel以下、7 palette batch以下とする。
- 追加仕事sceneはtarget、particle、route、starを固定slotで最大6 draw callにまとめる。
- 非選択車両の対象・route・particle・starはcount 0とし、物理colliderを増やさない。
- entry 350kB、通常chunk 600kB、Three 750kB、Rapier 2.25MBのbudgetを維持する。
- Apple M4／physical GPUで中央値55fps、p10 45fps以上。draw callまたはscene描画を増やすため再測定する。

## リスクと対策

| リスク | 対策 |
| --- | --- |
| 5台分の条件分岐がAppとsceneへ散る | 追加3台をActionTarget registry／runtime／sceneへ集約する。 |
| selectorがmobile HUDを塞ぐ | 3列2段の実寸境界と全操作矩形をPlaywrightで数値検証する。 |
| 非選択仕事が同時描画される | `enabled=false`で全固定slotを非activeにしtelemetry count 0をassertする。 |
| 仕事表示と接触対象がずれる | current job refだけをscene、HUD、telemetryへ渡す。 |
| 色替えで赤十字や灯火が消える | paintable body paletteを車種別に限定する。 |
| 接触継続がframe rate依存になる | deltaを50ms以下へclampし、累積時間のpure helperをTDDする。 |
| 既存長距離E2Eが遅くなる | 追加車両専用focusを作り、全回帰は公開単位の最後に1回だけfresh実行する。 |

## 自己レビュー

### 2026-08-01 Task 3 ショベルカー実測

- 密度の高い橙車体、黒い履帯、青窓、黄橙アーム、灰色bucketを純voxel 7 batchで実装した。
- 3仕事、各3土山、速度0.45以下、700ms保持、1800ms成功、帰庫再抽選を共通runtimeへ接続した。
- Docker内fresh unitは41 files／394 tests、production buildは647 modulesで全bundle予算内だった。
- desktop keyboard、tablet touch、mobile-landscape touchで土3山、成功、帰庫、次仕事を完走した。
- 3 viewportとも主要HUDは画面内、3ボタンはselector境界内、主要UI間は8px以上だった。
- Docker software rendererではscene 30 calls、ショベルカー車体7 calls。物理GPU再認証は5台総合回帰で行う。

### 2026-08-01 Task 4 救急車実測

- 白い箱形車体、赤帯と赤十字、青緑窓、赤色灯、黒タイヤを純voxel 7 batchで実装した。
- 公園の3仕事へ各1体の患者を置き、車体中心2.4unit以内、速度0.35以下、主操作1.2秒保持で手当てする。完了した患者は0.65秒で横向きから起き上がる。
- 動的に移動する固定poolが原点周辺の境界でfrustum cullingされ、telemetry上はactiveでも土山と患者が見えない不具合を実ブラウザで発見した。動的poolだけ`frustumCulled=false`として、描画対象と判定対象を一致させた。
- Docker内fresh unitは42 files／409 tests、production buildは649 modulesで全bundle予算内だった。game entryは121,542 bytes、Threeは718,551 bytes、Rapierは2,237,128 bytesだった。
- desktop keyboard、tablet touch、mobile-landscape touchで患者の手当前表示、手当て、成功、帰庫、次仕事を実走した。4ボタンはselector境界内、主要UI間は8px以上だった。
- 3 viewportともscene 30 calls、救急車車体7 calls。患者の横たわり、起き上がり、赤十字、HUD、操作系を15枚の画像で原寸目視した。物理GPU再認証は5台総合回帰で行う。
- commit `e64eca6`をmainへpushし、remote SHA一致、ahead／behind `0/0`、Pages run `30707424042`のunit／build／deploy successを確認した。公開manifestは`2026-08-01T16:12:50.807Z`で全3 viewport成功し、公開root・互換URL・Vehicle Labもsmokeを通過した。

### 2026-08-01 Task 5 パトカー実測

- 白い低い車体、黒帯、青緑窓、赤青灯、黒タイヤを純voxel 7 batchで実装し、bodyだけを一時塗装対象にした。サイレン操作中は赤青灯が0.5秒周期で交互に強調される。
- 南地区へ3件×3門の巡回仕事を追加した。車体中心1.5unit以内、速度0.35以上5.5以下、サイレン250ms継続で門を完了し、通過時は水色粒、全完了時は既存の成功星を出す。
- 初回目視で門の内幅1.52unitがパトカー物理車幅2.96unitより狭いことを検出した。内幅を3.36unitへ広げ、車幅より広いことをpure testで固定した。
- 長距離E2Eは各門の3unit手前で中央線へ再整列し、帰庫時は南地区看板postを避けてz=26を通る明示ウェイポイントへ変更した。判定半径やworld物理は緩めていない。
- fresh Docker unitは43 files／425 tests、production buildは651 modulesで全budget内だった。game entryは129,376 bytes、Threeは718,551 bytes、Rapierは2,237,128 bytesだった。
- desktop keyboard、tablet touch、mobile-landscape touchで3門、成功、帰庫、次仕事を連続実走した。sceneは30 calls、パトカー車体は7 calls、5ボタンselectorは3列2段・幅350px・高さ104pxで全親境界内に収まった。
- fleet manifestは`2026-08-01T16:51:10.246Z`で全3 viewport成功し、ショベルカー6枚、救急車9枚、パトカー9枚の計24枚を原寸目視した。production smokeもroot、互換URL、Vehicle Labの3入口でPASSした。
- commit `7d06baa`をmainへpushし、remote SHA一致、ahead／behind `0/0`、Pages run `30709255937`のunit／build／deploy successを確認した。公開manifestは`2026-08-01T17:04:52.716Z`で全3 viewport成功し、公開配信物の24枚を原寸目視した。公開root、互換URL、Vehicle Labもsmokeを通過した。

- 受け入れ条件、非対象、リスクと対策、性能目標を明示した。
- 保留項目は理由、影響、代替タスク、復帰条件を記載した。
- 既存機能の暗黙削除はなく、追加3台を段階公開できる境界に分けた。
- ユーザー指定により個別デザイン承認待ちは設けず、この台帳を実装判断の基準にする。

## 実装・検証結果

### Task 1: 設計公開

- commit `2a03219`をmainへpushし、remote SHA一致・ahead／behind `0/0`を確認した。
- GitHub Pages run `30703175735`はunit、budget付きbuild、deployがすべてsuccessだった。

### Task 2: 共通ActionTarget基盤

- REDではruntime、contact、VFX、sceneの未作成importが3 suiteと1 suiteでそれぞれ失敗した。
- `ActionTargetMissionRuntime`へ対象の冪等完了、1800ms成功、自由走行、帰庫、同一instance再割当を実装した。
- 接触中心、距離、速度範囲、主操作、最大50msの継続累積をpure helperへ分離した。
- 最大3対象のbody 18、accent 9、particle 18、route 7、star 12 slotを一度だけ確保し、固定5 batchで描く共通sceneを追加した。非選択時は全slotを非activeにする。
- focusedは3 files／20 tests、fresh full unitは40 files／378 testsがPASSした。
- production buildは641 modulesでPASSし、game 93,654 bytes、通常vendor最大192,532 bytes、Three 718,551 bytes、Rapier 2,237,128 bytesで全budget内だった。共通sceneは未接続のため配信bundleと既存draw callはまだ変えていない。

### 2026-08-01 Task 6 最終総合回帰

- Docker内fresh unitは46 files／448 tests、production buildは656 modulesでPASSした。game entry 144,786 bytes、通常vendor最大192,532 bytes、Three 718,551 bytes、Rapier 2,237,128 bytesで全budget内だった。
- canonical full、Vehicle Lab、既存車両、色遊び、5台fleet、実AudioContext、96×96map、production smokeをすべて実ブラウザで完走した。browser／page／request errorは0だった。
- 旧車両E2Eに残っていた3台固定の期待値を5台へ更新し、mobile selectorの旧42%比率を、viewport内包・全5子ボタンの親境界内包・missionとの実寸余白へ置き換えた。修正後は全3 viewportでPASSした。
- 現行成果物の代表10画像を原寸目視し、水流、破壊、5台、色シャワー、患者、追加2地区、HUD、操作系に見切れ・意図しない重なり・はみ出し・操作阻害がないことを確認した。
- 公開96×96版をApple M4物理GPUで5台測定し、全車median 59.88fps、p10 56.82〜58.48fps、scene 28〜31 calls、車体7 callsを確認した。目標を満たすためchunk streaming／LODは不要と確定した。
- 本設計で非対象だった音・振動と追加地区は、後続の独立設計・実装タスクで完成済みであり、当時の境界を遡って変更しない。
- 最終検証commit`e56dd04`をmainへpushし、remote SHA一致、ahead／behind `0/0`、Pages run `30717940398`のunit／build／deploy successを確認した。公開車両E2Eはmanifest `2026-08-01T20:59:22.887Z`で全3 viewport成功し、公開root・互換URL・Vehicle Labもsmokeを通過した。

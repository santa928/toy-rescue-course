# Task 5: 放水、自動追尾、火、ミッション進行 report

## Status

完了。純ボクセルの3段階炎、最大18cubeの放水、35%自動追尾、右回り道しるべ12cube、成功星6組と「できた！」、通常/手動runtime clockを接続した。

## RED / GREEN

- 初期RED: `runtime.subscribe()`、`advanceInFixedSteps()`、`WaterAndFire`を先にtestから要求。Docker Vitestで`runtime.subscribe is not a function`、`advanceInFixedSteps is not a function`、`Cannot find module '../voxel-game/scene/WaterAndFire'`を確認した。
- GREEN 1: idle frameを通知せず、mission phase・fire intensity・block phaseだけを通知する購読とunsubscribeを実装。60Hz固定stepと最後の余りを合計時間の過不足なく進めた。
- Clock RED: self-reviewでmanual flag直後の通常frame skip契約がE2Eにしかないことを検出。`advanceRuntimeFrame is not a function`を確認後、1frameだけskipし次frameを50ms上限で進めるpure helperへ抽出した。
- GREEN 2: nozzle origin・vehicle forward・`FIRE_POSITION`を`resolveSprayTarget()`へ渡し、`targeted && command.spray`だけを有効消火signalにした。水は青12/白6の2 InstancedMesh、炎は閾値どおり3/2/1/0層とした。
- Visual RED 1: 初回PNGで旧static fireが残る問題を避けるため`VoxelWorld`の常時炎を削除し、`WaterAndFire`へ一本化した。
- Visual RED 2: 初回原寸目視で新しい炎が建物内部へ埋没し、星が画角外だった。camera側外壁面と安全矩形を要求する配置testをRED→GREENにした。
- Visual RED 3: 次のPNGで最上炎/上側星の上端欠け、さらに星2組とDOMの部分重なりを目視検出。高さ・奥行き境界testを2回RED→GREENにし、4回目PNGで全要素が収まった。
- Harness修正: 実車停止を逆入力で行うと0速度を通過して逆走したため自然減速へ変更。旋回許容`dot=.985`では長距離走行の横ずれで火を通過したため、製品仕様を変えずE2Eの方位合わせだけを1frame pulse / `dot>=.9995`へ厳密化した。

## Implementation

- `VoxelGameRuntime.subscribe(listener)`は購読開始時の重要snapshotを基準にし、elapsed/celebration remaining/block respawn remainingだけの変化では通知しない。
- `advanceInFixedSteps()`は正の有限時間を`1000/60ms`と最後の余りへ分割する。0、負数、非有限値は進めず、1step未満の小数はその値を1回だけ進める。
- `RuntimeClock`は通常frameで`runtime.advance(Math.min(delta,.05)*1000)`を呼ぶ。`window.advanceTime()`はmanual flagを立てて固定stepを同期実行し、直後の通常frameを1回skipする。
- `WaterAndFire`は火・水・route・星をbox geometryだけで描画する。particle texture、丸形、post effectは使わない。
- routeは`routeVisible`中だけ車庫から南側道路を東へ、東側道路を北へ進む12cube。celebratingだけ黄色/白の5-cube星を6組表示し、freeRoamではroute・星・DOM文言をすべて消す。
- `render_game_to_text()`へ後方互換で`mission`と`visuals`を追加し、照準、火層、水18、route12、星30を公開状態から検証可能にした。

## Commands and results

- `docker compose run --rm web npm test -- src/test/voxelGameRuntime.test.ts src/test/sprayTargeting.test.ts src/test/waterAndFire.test.ts`: 3 files / 27 tests PASS。
- `docker compose run --rm web npm test`: 10 files / 49 tests PASS、exit 0。
- `docker compose run --rm web npm run build`: 2,266 modules、`index.html` / `vehicle-lab.html` / `voxel-game.html`生成、exit 0。既存chunk size警告のみ。
- Docker内Vite + Playwrightで`node scripts/verify-voxel-game-task5.mjs`: exit 0、3 pageのconsole error/page error 0。
- Docker内Vite + Playwrightで`node scripts/verify-voxel-game.mjs`: exit 0。既存運転、reset、camera、desktop/mobile smoke PASS。
- Docker内Vite + Playwrightで`node scripts/verify-vehicle-lab.mjs`: run manifest `completed` / error `null`。3 viewportの機能・画像検証PASS。
- `git diff --check`: PASS。

## Task 5 E2E telemetry

- 実車をW/Dで車庫から右回り道路へ走行。targeted開始distance `5.6585`。
- Space + 1000ms: fire intensity `0.52648`、mission `active`、火2層、水18cube、route12cube。
- 合計2500ms: fire intensity `0`、mission `celebrating`、route0、星30cube、DOM「できた！」表示。
- Space解除 + 1800ms: mission `freeRoam`、route0、星0、DOM文言なし。
- 範囲外別page: distance `6.4807`、targeted false、2500ms後もfire intensity `1`。
- 背後別page: distance `4.1380`、targeted false、2500ms後もfire intensity `1`。
- Artifact: `output/voxel-game/task5-results.json`。

## Visual inspection

- `output/voxel-game/fire-full.png`（1280×720、原寸）: 黄色/橙/赤の3層炎、消防車、黄色routeが完全表示。
- `output/voxel-game/fire-medium-water.png`（1280×720、原寸）: 2層炎と青/白の18cube放水列がnozzleから火へ連続し、主要物を遮蔽しない。
- `output/voxel-game/mission-complete.png`（1280×720、原寸）: 黄色/白の5-cube星6組とDOM「できた！」が非重複。route・炎・水は消えている。
- 3枚とも火・水・星が消防車/道路と同じ純ボクセル語彙で、主要要素の欠け、画面外はみ出し、建物やDOMによる遮蔽はない。

## Static fire deletion checks

- `rg -n "4\\.45|4\\.65|5\\.65|FIRE_POSITION\\[0\\] - 1" src/voxel-game`: 参照残り0件。
- 既存Voxel Game E2Eでscene-ready、主要画面、運転、cameraの最小起動smokeを確認した。

## Self-review

- 変更はTask 5所有範囲と、親から追加許可された`VoxelWorld.tsx`のstatic fire削除だけ。旧`game/`とVehicle Lab sourceは未変更。
- `SPRAY_RANGE=6`、`TARGET_DOT_THRESHOLD=.67`、`TARGET_ASSIST_RATIO=.35`は変更していない。
- 新規helper/component/public APIへJSDocを付け、subscriptionとwindow hooksはcleanupする。
- E2Eはruntime signalの直接注入や車両teleportを使わず、W/D/Spaceと公開`advanceTime()`だけを使用する。
- Task 6以降の積み木破壊・復元sceneは変更していない。

## Concerns

- Viteの500kB超chunk警告は既存のまま。型検査と3 entry生成は成功している。
- Vehicle LabはDocker/SwiftShaderで実行したため物理GPU性能を認証していない。3 viewportのthresholdもsoftware renderer上では未達で、物理GPU再検証が必要。Task 5の機能・画像・console回帰はPASSしている。

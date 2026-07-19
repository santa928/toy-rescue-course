# Task 5: 放水、自動追尾、火、ミッション進行 report

## Status

完了。純ボクセル3段階炎、18cube放水、35%自動追尾、右回り道しるべ12cube、5-cube星6組と「できた！」、通常/手動runtime clockを接続した。再レビュー後、manual clockのno-op契約と、実camera投影後のmobile安全余白契約まで自動検証へ追加した。

## RED / GREEN

- 初期実装: `runtime.subscribe()`、`advanceInFixedSteps()`、`WaterAndFire`をtest firstで追加した。manual clockは60Hz固定stepと最後の余りへ分割し、通常frameとの二重加算を1frame skipで防ぐ。
- 微小時間RED: `1e-7ms`がtimer epsilonで破棄された。正の有限時間はepsilon以下でも1回進めるよう修正した。
- Duration RED: screenshot scenarioと混在していた時間検証を独立pageへ分離した。Space前に`advanceTime(1)`で次frame skipを予約し、signal反映直後もfire intensity `1`、同期2499msで`0.0004`、+1msで`0 / celebrating / 1800ms`を固定した。
- No-op clock RED: `advanceTime(0)`がmanual flagを立て、次の通常frameを誤って停止した。`advanceManualClock(runtime, flag, ms)`をtest firstで追加し、0・負数・NaN・Infinityは時間もflagも変えず、連続する正のcallは合算後に通常frameを1回だけskipする契約へ修正した。
- Projection RED 1: world座標testだけではmobile clippingを検出できず、orange fire上面が画面上端へ接触した。実camera telemetry接続直後の投影rectは`top=-4.1254px`で、8px安全余白を満たさなかった。
- Projection GREEN 1: fire 3層をcamera側へ0.7unit移し、水の描画終点もvisible fireへ同期した。mobile medium fire rectは`top=18.5536px`となった。
- Projection RED 2: 6 star groupを各5cubeの8 cornersから投影したところ、右側group 4/5のrect距離が`0px`だった。
- Projection GREEN 2: 全15 pairを事前投影し、group 4をtruck・DOM外へ移した。最小star pair gapはgroup 0/3の`8.4748px`、最小success gapはgroup 3の`22.3688px`となった。

## Implementation

- `advanceManualClock()`は正の有限値をguardしてからmanual flagを立て、`advanceInFixedSteps()`で同期加算する。無効値は完全no-op。
- `WorldFixedCamera`は任意のtelemetry refへ実camera `position / lookTarget / zoom / viewport`を毎frame上書きする。React state更新と毎frame allocationは行わない。
- `render_game_to_text()`は後方互換で`camera`と`visualLayout`を追加する。`visualLayout`は描画が参照する同じfire box / star group定義であり、検証専用の座標複製を持たない。
- E2EはTHREE OrthographicCameraを実telemetryから再構成し、各voxelの8 cornersをscreen-spaceへ投影する。
- mobile契約はfire上端8px以上、6 star groupすべてviewport内、全15 pairが4px以上、successBoxとの距離が4px以上。
- 水は青12/白6の2 InstancedMesh、火は3/2/1/0層、成功演出は白3/黄3の5-cube星6組を維持する。
- gameplayの射程6unit、照準dot閾値0.67、assist 35%、合計2500ms消火、1800ms成功演出は変更していない。

## Commands and results

- Focused runtime: Docker Vitest `src/test/voxelGameRuntime.test.ts`、16 tests PASS。
- Focused visual/runtime: Docker Vitest 2 files / 28 tests PASS。
- All unit: Docker Vitest 11 files / 55 tests PASS。
- Production build: TypeScript + Vite、2,267 modules、`index.html` / `vehicle-lab.html` / `voxel-game.html`生成、exit 0。既存chunk size警告のみ。
- Task 5 E2E: Docker内Vite + Playwright、duration、desktop mission、844x390 mobile、範囲外、背後の全page PASS。console error / page error 0。
- Task 4 camera E2E: PASS。`positionDrift=0.0013158`、`worldTurnDifference=0.0274089`、mobile landscape PASS。
- Vehicle Lab E2E: 機能・3 viewport画像検証PASS。SwiftShaderのため性能認証だけ物理GPU再検証が必要。
- `git diff --check`はPASS。static fire旧座標参照と`advanceTime(0)`停止用途の残りは0件。

## Task 5 E2E telemetry

- Duration arm: fire intensity `1`、spray signal active/targeted。
- 同期2499ms: fire intensity `0.0004000000000002231`、mission `active`。
- +1ms: fire intensity `0`、mission `celebrating`、celebration remaining `1800ms`。
- Desktop medium: fire intensity `0.53864`、火2層、水18cube。
- Mobile medium: fire intensity `0.55668`、火2層、水18cube、targeted distance `5.5353`。
- Mobile successBox: `x=323.90625 / y=20 / width=196.1875 / height=73`。
- 範囲外: distance `6.7818`、targeted false、2500ms後もfire intensity `1`。
- 背後: distance `4.3524`、targeted false、2500ms後もfire intensity `1`。
- Artifact: `output/voxel-game/task5-results.json`。

## Mobile screen-space projection

- Medium fire rect: `left=484.5000 / right=574.5817 / top=18.5536 / bottom=151.4636`。上端余白は要求8pxを10.5536px上回る。
- Star rectは全6組が844x390内。各groupは5cube十字。
- 全15 pairの最小距離: group 0/3の`8.4748px`。要求4pxを4.4748px上回る。
- SuccessBoxとの最小距離: group 3の`22.3688px`。要求4pxを18.3688px上回る。
- 旧不具合のgroup 4/5は投影上で分離し、画像でも白/黄の十字を別々に判別できる。

## Visual inspection

- `output/voxel-game/fire-medium-water.png`（1280x720、原寸）: 2層炎と18cube水列が完全表示。建物埋没、上端clip、車体遮蔽なし。
- `output/voxel-game/mission-complete.png`（1280x720、原寸）: 白3/黄3の星6組とDOMが完全表示・非重複。
- `output/voxel-game/fire-medium-water-mobile.png`（844x390、原寸）: orange上面を含む2層炎、水の先端、消防車、道路が完全表示。
- `output/voxel-game/mission-complete-mobile.png`（844x390、原寸）: 6組すべてが5-cube十字として判別でき、truck・DOM・他starによる遮蔽なし。
- desktop/mobileとも純ボクセル語彙、主要オブジェクトの欠け・画面外はみ出し・操作阻害なし。

## Static smoke / self-review

- static fire削除後の旧座標参照は`rg`で残り0件。
- Task 5 / Task 4 E2Eでscene-ready、主要画面、実運転、camera、mission chainの最小起動smokeを確認。
- E2Eはvehicle teleportやruntime signal直接注入を使わず、W/D/Spaceと公開`advanceTime()`のみを使用する。
- camera telemetryは任意refの後方互換追加で、Task 4 fixed-world/yaw非追従契約を維持する。
- Task 6以降の積み木破壊・復元scene、旧`game/`、Vehicle Lab sourceは変更していない。

## Concerns

- Viteの500kB超chunk警告は既存のまま。型検査と3 entry生成は成功している。
- Vehicle LabはDocker/SwiftShaderで実行したため物理GPU性能を認証していない。機能・画像・console回帰はPASSしている。

# 純ボクセル働く車

React、React Three Fiber、Three.js、Rapierで作る、働く車のボクセル箱庭ゲームです。消防車で火を消したり、ブルドーザーで工事がれきを片付けたりしながら、積み木を壊して自由に遊べます。消防車を単体で確認できるVehicle Labも残しています。

## 起動

ホスト環境へ依存をインストールせず、Docker Composeで起動します。

```bash
docker compose up --build web
```

- 標準ゲーム: <http://localhost:5180/>
- 互換URL: <http://localhost:5180/voxel-game.html>
- 消防車デザイン確認用Vehicle Lab: <http://localhost:5180/vehicle-lab.html>

## 公開版

- GitHub Pages: <https://santa928.github.io/toy-rescue-course/>

`main`へのpushで`.github/workflows/deploy-pages.yml`がunit testとproduction buildを実行し、
`dist/`をGitHub Pagesへ公開します。プロジェクトPages向けのasset baseは
`/toy-rescue-course/`です。

## 本番箱庭

72×72相当の机上箱庭を、中央の車庫、北の公園、東の火災現場、
西の積み木・工事広場、南の自由走行地区で構成しています。中央の道路から
各地区へ寄り道でき、消防車の消火、ブルドーザーのがれき片付け、積み木破壊を
同じ1枚続きの世界で遊べます。

## ゲームの操作

- `W` / `↑`: 画面上へ移動
- `S` / `↓`: 画面下へ移動
- `A` / `←`: 画面左へ移動
- `D` / `→`: 画面右へ移動
- 画面左下レバー: 倒した画面方向へ移動
- `Space` / 右下の主操作ボタン: 選んだ車の道具を使う
- `F` / 右上ボタン: fullscreenの開始・終了

中央車庫の中で停止すると「しょうぼうしゃ」と「ブルドーザー」を選べます。選択に失敗や解除条件はなく、車庫へ戻れば何度でも乗り換えられます。消防車の主操作は放水、ブルドーザーの主操作は前面ブレードです。

放水すると青と白のボクセル水粒がノズルから流れ、火へ届いたときだけ着弾飛沫が広がります。ブルドーザーでは西地区の道しるべをたどり、走りながらブレードを動かして3個の工事がれきへ触れると、ボクセル破片へ崩して片付けられます。仕事を終えた後は自由走行になり、車庫へ戻ると同じ仕事を最初から何度でも遊べます。

どちらの車でも赤・黄・青・緑の積み木へ勢いよくぶつかると、元の積み木の内側から6片へ連続して崩れ、少し待って車両が離れていれば同じ場所へ復元します。北の公園の木の幹と火災建物本体には進入できません。

南地区には赤・青・黄の色水プールと色シャワーがあります。通り抜けると選んだ車の塗装部分だけが12秒間その色に変わり、同じ場所へ入り直すと12秒へ戻ります。別の色へ入れば即座に上書きされ、時間切れか車庫で別の車へ乗り換えると元の玩具色へ戻ります。窓、タイヤ、梯子、ブレード、灯火は元の色を保つので、車の役割は見分けられます。

炎から約7unit以内でおおむね正面を向いて放水すると、見えている炎へ照準が補助されます。真横・背後・範囲外からの放水では消火できません。

### 箱庭の物理対象

- 車庫は正面開口から出入りし、背面壁・左右壁を通り抜けません。
- 北の公園の赤い遊具と黄色い支柱はsolidです。
- 中央ハブのゲートpostと南の自由走行地区の標識postはsolidです。
- 炎は燃えている間だけ進入できず、消火後は同じ場所を走れます。
- 黄色い道しるべは道路へ埋め込まれた案内灯なので通過できます。
- 樹冠、窓、屋根装飾、道路線、水、星は非solidです。

炎は18 slot以内の固定poolを赤い外炎・橙の中炎・黄白い芯の3色batchで描く立体ボクセルVFXです。
炎の舌はslotごとに非同期で揺れ、火の粉は上昇・縮小して循環します。消火では表示数が
18→12→6→0へ減り、車庫へ帰って仕事を再開すると18へ戻ります。炎の配置は本番の
放水照準位置をanchorにしているため、照準点と見えている炎がずれません。

最終E2E、3 viewportの代表画像、software renderer分類はDocker内で生成します。
物理GPU性能は、同じ3 viewportをホストの物理GPU対応ブラウザで別途認証します。

```bash
docker compose --profile e2e run --rm --build voxel-game-e2e
docker compose --profile e2e run --rm --build voxel-game-vehicles-e2e
docker compose --profile e2e run --rm --build voxel-game-colors-e2e
```

## Vehicle Labの操作

- マウスドラッグ／1本指ドラッグ: 消防車を回り込んで見る
- マウスホイール／ピンチ: 拡大・縮小
- 正面・左・背面・右ボタン: 固定方向へ切り替える

固定方向で拡大・縮小しても選択中の方向は維持されます。ドラッグで回転すると自由視点へ移り、固定方向ボタンを再度選ぶとカメラ位置と拡大率がデザイン基準へ戻ります。

## 検証

テスト、3つのHTML entryのbuild、3 viewportの実ブラウザ検証は、すべてDocker内で実行します。最新fresh unit testは34 files / 315 testsです。

```bash
docker compose run --rm web npm test
docker compose run --rm web npm run build
docker compose --profile e2e run --rm --build production-smoke-e2e
docker compose --profile e2e run --rm --build e2e
docker compose --profile e2e run --rm --build voxel-game-e2e
docker compose --profile e2e run --rm --build voxel-game-vehicles-e2e
docker compose --profile e2e run --rm --build voxel-game-colors-e2e
```

production buildはReact、Three、R3F、Drei、React Three Rapier、Rapier compat、ゲーム固有entryを
決定的なchunkへ分割します。`postbuild`が3つのHTML entryからのasset参照と、game entry 350kB、
通常chunk 600kB、Three 750kB、Rapier 2.25MBの上限を自動検証します。2026-08-01の実測は
game 84,583 bytes、通常vendor最大192,532 bytes、Three 718,551 bytes、Rapier 2,237,128 bytesです。

Voxel Gameのcanonical、二車種、色替えE2Eは、frame待機、公開状態読取、keyboard／touch stick、
制動、world軸走行、座標補正を`scripts/voxel-game-e2e/drive-harness.mjs`で共有します。canonicalの
放水との同時押しに使うCDP touch driverと、各feature固有のassert・reset診断は個別scriptに残します。
共有境界のpure／fake page契約はDocker内のNode testで単独確認できます。

```bash
docker compose run --rm web node --test scripts/voxel-game-e2e/drive-harness.node-test.mjs
```
`production-smoke-e2e`は生成済みbundleをVite previewで配信し、root、互換URL、Vehicle LabのWebGL起動と
console／page／request errorがないことを実ブラウザで確認します。

ブラウザ検証結果、12枚の固定方向画像、Desktopのdesign／near／far画像は `output/vehicle-lab/` に生成されます。このディレクトリはgit管理しません。

Voxel Gameの `run-manifest.json`、`results.json`、3 viewport・水・破壊・物理接触を含む代表画像は `output/voxel-game/` に生成されます。二車種の乗り換え・ブルドーザー仕事・帰庫再開の結果と6枚の代表画像は `output/voxel-game-vehicles/` に、色替えの実走、再接触、上書き、時間切れ、乗り換え競合の結果と6枚の代表画像は `output/voxel-game-colors/` に生成されます。software／unknown rendererのfpsは記録しますが、物理GPU性能としては認証しません。

2026-08-01の色遊び込み実装を1280×720の `ANGLE Metal Renderer: Apple M4` で2秒warm-up＋12秒計測した結果、消防車はmedian 59.88fps／p10 56.82fps／平均59.92fps（scene 28 calls、車体7 calls）、ブルドーザーはmedian 59.88fps／p10 56.82fps／平均58.92fps（scene 27 calls、車体7 calls）でした。色遊びstationは78 cube／5 callsで、両車とも認証目標のmedian 55fps以上／p10 45fps以上を満たしています。72×72の現mapではchunk streaming／LODは不要と判定し、96×96超への拡張または性能未達時だけ再評価します。実機再認証時は `/?gpu-cert=<任意の非空値>` を開くと、通常プレイへ影響しない12秒probeがhidden DOMへ1回だけ結果を出します。

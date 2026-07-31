# 純ボクセル消防車

React、React Three Fiber、Three.js、Rapierで作る、働く車のボクセル箱庭ゲームです。消防車で自由に走り回り、放水で火を消す仕事と、積み木を壊す遊びを楽しめます。消防車を単体で確認できるVehicle Labも残しています。

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

72×72相当の机上箱庭を、中央の消防車庫、北の公園、東の火災現場、
西の積み木広場、南の自由走行地区で構成しています。中央の道路から
各地区へ寄り道でき、消防車の消火と積み木破壊を同じ1枚続きの世界で遊べます。

## ゲームの操作

- `W` / `↑`: 画面上へ移動
- `S` / `↓`: 画面下へ移動
- `A` / `←`: 画面左へ移動
- `D` / `→`: 画面右へ移動
- 画面左下レバー: 倒した画面方向へ移動
- `Space` / 「みず」: 放水
- `F` / 右上ボタン: fullscreenの開始・終了

放水すると青と白のボクセル水粒がノズルから流れ、火へ届いたときだけ着弾飛沫が広がります。赤・黄・青・緑の積み木へ勢いよくぶつかると、元の積み木の内側から6片へ連続して崩れ、少し待って車両が離れていれば同じ場所へ復元します。北の公園の木の幹と火災建物本体には消防車で進入できません。

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
```

## Vehicle Labの操作

- マウスドラッグ／1本指ドラッグ: 消防車を回り込んで見る
- マウスホイール／ピンチ: 拡大・縮小
- 正面・左・背面・右ボタン: 固定方向へ切り替える

固定方向で拡大・縮小しても選択中の方向は維持されます。ドラッグで回転すると自由視点へ移り、固定方向ボタンを再度選ぶとカメラ位置と拡大率がデザイン基準へ戻ります。

## 検証

テスト、3つのHTML entryのbuild、3 viewportの実ブラウザ検証は、すべてDocker内で実行します。最新fresh unit testは20 files / 207 testsです。

```bash
docker compose run --rm web npm test
docker compose run --rm web npm run build
docker compose --profile e2e run --rm --build e2e
docker compose --profile e2e run --rm --build voxel-game-e2e
```

ブラウザ検証結果、12枚の固定方向画像、Desktopのdesign／near／far画像は `output/vehicle-lab/` に生成されます。このディレクトリはgit管理しません。

Voxel Gameの `run-manifest.json`、`results.json`、3 viewport・水・破壊・物理接触を含む33枚の代表画像は `output/voxel-game/` に生成されます。software／unknown rendererのfpsは記録しますが、物理GPU性能としては認証しません。2026-07-31の過去計測（HEAD `535a5e0`）では、`ANGLE Metal Renderer: Apple M4`でDesktop 1280×720が平均60.1961fps、tablet landscape 1024×768が平均60.0702fps、mobile landscape 844×390が平均60.0678fpsとなり、各目標を満たしました。現HEADでは物理GPUをfresh再認証していないため、この値をcurrent性能認証とは扱いません。

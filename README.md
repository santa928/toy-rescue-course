# おもちゃレスキューコース

React Three FiberとThree.jsで作る、働く車のおもちゃ箱ゲームです。現在は既存ゲームに加え、本開発前のデザイン確認用として純ボクセル消防車のVehicle Labを提供します。

## 起動

ホスト環境へ依存をインストールせず、Docker Composeで起動します。

```bash
docker compose up --build web
```

- 既存ゲーム: <http://localhost:5180/>
- 純ボクセル消防車: <http://localhost:5180/vehicle-lab.html>

## 純ボクセル消防車ゲーム

- URL: <http://localhost:5180/voxel-game.html>
- `W` / `↑`: 画面上へ移動
- `S` / `↓`: 画面下へ移動
- `A` / `←`: 画面左へ移動
- `D` / `→`: 画面右へ移動
- 画面左下レバー: 倒した画面方向へ移動
- `Space` / 「みず」: 放水
- `F` / 右上ボタン: fullscreenの開始・終了

放水すると青と白のボクセル水粒がノズルから流れ、火へ届いたときだけ着弾飛沫が広がります。赤・黄・青・緑の積み木へ勢いよくぶつかると、元の積み木の内側から6片へ連続して崩れ、少し待って車両が離れていれば同じ場所へ復元します。中央公園の木の幹と火災建物本体には消防車で進入できません。

最終E2E、3 viewportの代表画像、renderer分類と性能実測はDocker内で生成します。

```bash
docker compose --profile e2e run --rm --build voxel-game-e2e
```

## Vehicle Labの操作

- マウスドラッグ／1本指ドラッグ: 消防車を回り込んで見る
- マウスホイール／ピンチ: 拡大・縮小
- 正面・左・背面・右ボタン: 固定方向へ切り替える

固定方向で拡大・縮小しても選択中の方向は維持されます。ドラッグで回転すると自由視点へ移り、固定方向ボタンを再度選ぶとカメラ位置と拡大率がデザイン基準へ戻ります。

## 検証

テスト、複数HTMLのbuild、3 viewportの実ブラウザ検証は、すべてDocker内で実行します。

```bash
docker compose run --rm web npm test
docker compose run --rm web npm run build
docker compose --profile e2e run --rm --build e2e
docker compose --profile e2e run --rm --build voxel-game-e2e
```

ブラウザ検証結果、12枚の固定方向画像、Desktopのdesign／near／far画像は `output/vehicle-lab/` に生成されます。このディレクトリはgit管理しません。

Voxel Gameの `run-manifest.json`、`results.json`、8枚の代表画像は `output/voxel-game/` に生成されます。software／unknown rendererのfpsは記録しますが、物理GPU性能としては認証しません。

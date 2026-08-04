# 純ボクセル働く車

React、React Three Fiber、Three.js、Rapierで作る、働く車のボクセル箱庭ゲームです。消防車で火を消し、ブルドーザーで工事がれきを片付け、ショベルカーで土山を掘り、救急車で公園の患者を手当てし、パトカーで巡回しながら、積み木を壊して自由に遊べます。消防車を単体で確認できるVehicle Labも残しています。

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

96×96の机上箱庭を、中央の車庫、北の公園、東の火災現場、
西の積み木・工事広場、南の自由走行地区、北西のこうじヤード、南東のおもちゃのまちで構成しています。中央の道路から
各地区へ寄り道でき、消防車の消火、ブルドーザーのがれき片付け、ショベルカーの土掘り、救急車の手当て、パトカーの巡回、積み木破壊を
同じ1枚続きの世界で遊べます。

## ゲームの操作

- `W` / `↑`: 画面上へ移動
- `S` / `↓`: 画面下へ移動
- `A` / `←`: 画面左へ移動
- `D` / `→`: 画面右へ移動
- 画面の空いている場所をタッチし、そのまま進みたい画面方向へスワイプ（左下の「どこでも」レバーからも操作可能）
- `Space` / 右下の主操作ボタン: 選んだ車の道具を使う
- `F` / 右上ボタン: fullscreenの開始・終了
- 右上の`おと オフ／オン`: 玩具BGM、走行音、車種別アクション音、成功音、対応端末の短い振動をまとめて切り替える

画面上の仕事札には、仕事名に加えて「何へ・どの操作をするか」と`クリア 現在/目標`が表示されます。右上の小さな「おしごとマップ」では、選んだ車色の現在地、黄色い次ターゲット、目的地までの距離を確認できます。対象を完了すると次の未完了対象へピンが移り、仕事完了後は中央車庫を示します。車庫へ戻ると次の仕事が始まり、消防車の炎も再び表示されます。

中央車庫の中で停止すると「しょうぼうしゃ」「ブルドーザー」「ショベルカー」「きゅうきゅうしゃ」「パトカー」を選べます。選択に失敗や解除条件はなく、車庫へ戻れば何度でも乗り換えられます。消防車の主操作は放水、ブルドーザーは前面ブレード、ショベルカーはバケット、救急車は手当て、パトカーはサイレンです。

放水すると青と白のボクセル水粒がノズルから流れ、火へ届いたときだけ着弾飛沫が広がります。消防車以外の主操作は、仕事対象から離れていても押した瞬間から車種固有の玩具アクションが出ます。ブルドーザーはブレードを落として黄色い衝撃と亀裂、土煙を広げ、ショベルカーは0.9秒の「下げる・すくう・持ち上げる・戻す」で土色cubeを放ります。救急車は赤白の十字waveとheartを広げ、パトカーは0.5秒の赤青灯、beam、走行trailを出します。共通の最大48 slotを1 draw callで描くため、派手さを増やしても車体物理やカメラは動かしません。

仕事対象の近くでは同じアクションが仕事へ作用します。ブルドーザーは西地区の道しるべをたどり、走りながらブレードを動かして3個の工事がれきへ触れると12個相当のボクセル破片へ崩します。ショベルカーは土山の横でバケットを0.7秒動かすと掘削が進み、救急車は患者の横で手当てを1.2秒続けると患者が起き上がり、パトカーは赤青の巡回門をサイレン中に走り抜けると巡回できます。黄色い成功星、成功音、振動は仕事が成立した時だけ出るので、どこでも遊べる自由アクションを完了と誤認しません。各車種には3件の仕事があり、仕事を終えて自由走行から車庫へ戻ると、同じ仕事が連続しない次の依頼へ進みます。未完了の帰庫や乗り換えでは依頼を変えません。

通常プレイの仕事順はページを開くたびに変わり、検証や再現ではURLへ`?job-seed=1`のような10進整数を付けると同じ順序になります。現在のjob ID、仕事名、巡回番号、seed、実判定対象座標、具体的な操作文、次ターゲット、達成数は`render_game_to_text()`の`mission`へ公開します。

音は初期状態ではオフで、右上の`おと オフ`を押した後だけ始まります。外部音源を読み込まず、木琴風の五音BGM、小さな速度連動エンジン音、放水・ブレード・バケット・手当て・赤青サイレンをWeb Audioで生成します。乗り換え、対象完了、仕事完了には短い合図が入り、touch対応端末では対象／仕事完了だけ短く振動します。非表示中とオフ中はAudioContextを停止し、設定は保存しません。現在の有効状態、context、車種、action kind、gain、cue／振動回数は`render_game_to_text()`の`audio`へ公開します。

どの車でも赤・黄・青・緑の積み木へ勢いよくぶつかると、元の積み木の内側から6片へ連続して崩れ、少し待って車両が離れていれば同じ場所へ復元します。北の公園の木の幹と火災建物本体には進入できません。

南地区には赤・青・黄の色水プールと色シャワーがあります。通り抜けると選んだ車の塗装部分だけが12秒間その色に変わり、同じ場所へ入り直すと12秒へ戻ります。別の色へ入れば即座に上書きされ、時間切れか車庫で別の車へ乗り換えると元の玩具色へ戻ります。窓、タイヤ、履帯、梯子、ブレード、バケット、灯火は元の色を保つので、車の役割は見分けられます。

炎から約7unit以内でおおむね正面を向いて放水すると、見えている炎へ照準が補助されます。真横・背後・範囲外からの放水では消火できません。

### 箱庭の物理対象

- 車庫は正面開口から出入りし、背面壁・左右壁を通り抜けません。
- 北の公園の赤い遊具と黄色い支柱はsolidです。
- 中央ハブのゲートpostと南の自由走行地区の標識postはsolidです。
- こうじヤードの詰所、クレーン柱、木材、標識postはsolidです。
- おもちゃのまちの家、街路樹の幹、入口標識postはsolidです。
- 炎は燃えている間だけ進入できず、消火後は同じ場所を走れます。
- 黄色い道しるべは道路へ埋め込まれた案内灯なので通過できます。
- 樹冠、窓、屋根装飾、道路線、水、星は非solidです。

炎は18 slot以内の固定poolを赤い外炎・橙の中炎・黄白い芯の3色batchで描く立体ボクセルVFXです。
炎の舌はslotごとに非同期で揺れ、火の粉は上昇・縮小して循環します。消火では表示数が
18→12→6→0へ減り、車庫へ帰って仕事を再開すると18へ戻ります。炎の配置は本番の
放水照準位置をanchorにしているため、照準点と見えている炎がずれません。

追従カメラはRapierの描画補間後の車体位置を使い、平坦な箱庭では高さを固定します。
車体を壁へ押し付けたときの小さな接触補正は0.18unitの余白内で吸収するため、車だけが
物理反応し、街とHUDを含む画面全体はブルブル揺れません。車体の剛体原点も最初から
接地位置へ生成するので、起動時と車庫リセット時の0.8unit落下は発生しません。

最終E2E、3 viewportの代表画像、software renderer分類はDocker内で生成します。
物理GPU性能は、代表Desktop viewportをホストの物理GPU対応ブラウザで車種別に認証します。

```bash
docker compose --profile e2e run --rm --build voxel-game-e2e
docker compose --profile e2e run --rm --build voxel-game-vehicles-e2e
docker compose --profile e2e run --rm --build voxel-game-colors-e2e
docker compose --profile e2e run --rm --build voxel-game-fleet-e2e
docker compose --profile e2e run --rm --build voxel-game-audio-e2e
docker compose --profile e2e run --rm --build voxel-game-map-e2e
docker compose --profile e2e run --rm --build voxel-game-swipe-e2e
docker compose --profile e2e run --rm --build voxel-game-break-coverage-e2e
docker compose --profile e2e run --rm --build voxel-game-camera-stability-e2e
```

canonical E2Eはscenarioの開始、30秒ごとのheartbeat、成功／失敗、経過秒を`[voxel-e2e]`行へ出力し、
同じ進捗を`run-manifest.json`へ保存します。長い回帰をfocus単位で再現するときは、次の専用serviceへ
`production-map`、`nonbreak`、`collision`、`break-red`、`break-yellow`、`break-blue`、`break-green`の
いずれかを渡します。未指定または未対応値はbrowser起動前に拒否されます。

```bash
VOXEL_GAME_FOCUS=nonbreak docker compose --profile e2e run --rm --build voxel-game-focus-e2e
```

## Vehicle Labの操作

- マウスドラッグ／1本指ドラッグ: 消防車を回り込んで見る
- マウスホイール／ピンチ: 拡大・縮小
- 正面・左・背面・右ボタン: 固定方向へ切り替える

固定方向で拡大・縮小しても選択中の方向は維持されます。ドラッグで回転すると自由視点へ移り、固定方向ボタンを再度選ぶとカメラ位置と拡大率がデザイン基準へ戻ります。

## 検証

テスト、3つのHTML entryのbuild、3 viewportの実ブラウザ検証は、すべてDocker内で実行します。玩具アクション強化後のfresh unit testは50 files / 515 testsです。

```bash
docker compose run --rm web npm test
docker compose run --rm web npm run build
docker compose --profile e2e run --rm --build production-smoke-e2e
docker compose --profile e2e run --rm --build e2e
docker compose --profile e2e run --rm --build voxel-game-e2e
VOXEL_GAME_FOCUS=collision docker compose --profile e2e run --rm --build voxel-game-focus-e2e
docker compose --profile e2e run --rm --build voxel-game-vehicles-e2e
docker compose --profile e2e run --rm --build voxel-game-colors-e2e
docker compose --profile e2e run --rm --build voxel-game-fleet-e2e
docker compose --profile e2e run --rm --build voxel-game-audio-e2e
docker compose --profile e2e run --rm --build voxel-game-map-e2e
docker compose --profile e2e run --rm --build voxel-game-swipe-e2e
docker compose --profile e2e run --rm --build voxel-game-break-coverage-e2e
docker compose --profile e2e run --rm --build voxel-game-camera-stability-e2e
```

production buildはReact、Three、R3F、Drei、React Three Rapier、Rapier compat、ゲーム固有entryを
決定的なchunkへ分割します。`postbuild`が3つのHTML entryからのasset参照と、game entry 350kB、
通常chunk 600kB、Three 750kB、Rapier 2.25MBの上限を自動検証します。2026-08-04の玩具アクション強化後の実測は
game 180,389 bytes、通常vendor最大192,532 bytes、Three 718,551 bytes、Rapier 2,237,128 bytesです。

Voxel Gameのcanonical、二車種、色替えE2Eは、frame待機、公開状態読取、keyboard／touch stick、
制動、world軸走行、座標補正を`scripts/voxel-game-e2e/drive-harness.mjs`で共有します。canonicalの
放水との同時押しに使うCDP touch driverと、各feature固有のassert・reset診断は個別scriptに残します。
共有境界のpure／fake page契約はDocker内のNode testで単独確認できます。

```bash
docker compose run --rm web node --test \
  scripts/voxel-game-e2e/*.node-test.mjs \
  scripts/voxel-game-screenshot-proof.node-test.mjs \
  scripts/voxel-game-break-physics-contract.node-test.mjs
```
共有走行、回転車体とsolidのSAT接触、scenario進捗、HUD screenshot proof、job別火災経路を含むNode test 32件を実行します。
canonical fullの最新manifestは19 scenario成功、37 artifacts＝37 screenshot proofs、contract failure 0、
browser error 0/0/0です。消防車は3 viewportすべてで異なる2仕事を完了し、帰庫後に3件目へ進みます。96×96マップ専用E2Eは、こうじヤード68unit、おもちゃのまち71unitの実走、別出口、代表solid衝突、7地区、40 solid、HUD 8px安全余白を3 viewportで確認します。

カメラ安定性専用E2EはDesktop／Tablet／Mobile landscapeで車体を車庫壁へ押し付け、車体の
XZ移動が127〜141回反転する条件でも、カメラXYZの反転0回、高さ変動0、browser error 0件を
確認します。3枚の目視用画像は`output/voxel-game-camera-stability/`へ生成されます。

7地区には、道路より低い19枚の固有色床・入口模様と21群（54 box）の街角セットがあります。床、模様、花、コーン、看板板などは通過でき、街灯柱、ベンチ本体、柵支柱、消火栓など硬い大物だけをsolidにしています。既存27件と合わせたstatic colliderは40件です。専用E2Eは7地区×Desktop／Tablet／Mobile landscapeの21画面で床色、装飾、HUD実寸、代表solid衝突、non-solid通過、scene 34 calls以下を検証します。

```bash
VOXEL_GAME_STREETSCAPE_VIEWPORT=desktop docker compose --profile e2e run --rm --build voxel-game-streetscape-e2e
VOXEL_GAME_STREETSCAPE_VIEWPORT=tablet docker compose --profile e2e run --rm --build voxel-game-streetscape-e2e
VOXEL_GAME_STREETSCAPE_VIEWPORT=mobile-landscape docker compose --profile e2e run --rm --build voxel-game-streetscape-e2e
```

`production-smoke-e2e`は生成済みbundleをVite previewで配信し、root、互換URL、Vehicle LabのWebGL起動と
console／page／request errorがないことを実ブラウザで確認します。

ブラウザ検証結果、12枚の固定方向画像、Desktopのdesign／near／far画像は `output/vehicle-lab/` に生成されます。このディレクトリはgit管理しません。

Voxel Gameの `run-manifest.json`、`results.json`、3 viewport・水・破壊・物理接触を含む37枚の代表画像は `output/voxel-game/` に生成されます。乗り換え、ブルドーザー3仕事、自由blade、対象衝撃、帰庫再開の結果と18枚は `output/voxel-game-vehicles/` に、色替えの実走、再接触、上書き、時間切れ、乗り換え競合の結果と6枚は `output/voxel-game-colors/` に生成されます。ショベルカーの掘削cycle、救急車のcare wave、パトカーの赤青巡回について、自由action、対象作用、成功、帰庫、次仕事までを3 viewportで実走した42枚は `output/voxel-game-fleet/` へ生成されます。実AudioContextのon/off、5車種action、速度連動engine、HUD実寸とオン／オフ6枚は`output/voxel-game-audio/`へ生成されます。追加2地区の経路、物理、HUD実寸と6枚は`output/voxel-game-map/`へ生成されます。全画面スワイプ運転の任意原点、上下左右、HUD競合、同時主操作、3 viewportの12枚は`output/voxel-game-swipe/`へ生成されます。積み木の同一面5位置について、衝突前後10枚と速度・接触回数は`output/voxel-game-break-coverage/`へ生成されます。software／unknown rendererのfpsは記録しますが、物理GPU性能としては認証しません。

2026-08-02の地区床・街角装飾版を1280×720の `ANGLE Metal Renderer: Apple M4` で各車2秒warm-up＋12秒計測しました。5台すべてmedian 59.88fps、p10は55.87〜57.47fps、平均は59.90〜59.98fpsで、認証目標のmedian 55fps以上／p10 45fps以上を満たしています。sceneは消防車30、ブルドーザー29、ショベルカー・救急車・パトカー32 calls、各車体は7 callsでした。96×96ちょうど、40 static collider、床1 `InstancedMesh`と既存palette batchのまま性能目標を満たしたため、chunk streaming／LODは導入しません。一辺96unit超への拡張または将来の物理GPU性能未達時だけ再評価します。再測定時は `/?gpu-cert=<任意の非空値>` を開くと、通常プレイへ影響しない12秒probeがhidden DOMへ1回だけ結果を出します。

2026-08-04の玩具アクション強化版も同じApple M4実GPU、1280×720、2秒warm-up＋12秒で再測定しました。4車種すべてmedian 59.88fps、p10 56.50〜57.14fps、平均60.00fpsで、sceneはブルドーザー33、ショベルカー・救急車・パトカー34 calls、各車体7 callsです。共通48-slot action VFXを1 `InstancedMesh`、対象VFXを2 batch、色遊びを1 batchへ集約した状態で性能目標を維持しています。

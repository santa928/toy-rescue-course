# 消防車以外の玩具アクション強化 設計

## 目的

消防車の放水を基準品質として残し、ブルドーザー、ショベルカー、救急車、パトカーの主操作を、
ミッション対象が近くにいない自由走行中でも押した瞬間から楽しく、対象付近では仕事の進行が
より明瞭になる玩具アクションへ強化する。仕事条件、自由走行、車両選択、物理、地図、カメラは
変えず、視覚、車体アニメーション、既存Web Audioの応答だけを強化する。

## 承認済み方針

- 採用: どこで押しても車両固有の派手なアクションを出し、対象付近では同じ入力を仕事へ作用させる。
- 判断委任: 車種別の詳細は推奨案で進め、個別デザイン承認を待たず実装、検証、公開まで行う。
- 公開許可: `main`へのpushとGitHub Pages公開を行う。

## 要件台帳

| ID | 状態 | 要件 | 今回の扱い |
| --- | --- | --- | --- |
| REQ-001〜REQ-087 | 維持 | 純ボクセル、5車種、15仕事、96×96箱庭、自由走行、物理、HUD、音、性能、公開契約 | 既存unit／E2Eを回帰gateにする。 |
| REQ-088 | 追加 | 4車種の主操作は対象がなくても押下直後に見える反応を返す | 車体部品、車両周囲VFX、操作ボタンを同じ入力へ接続する。 |
| REQ-089 | 追加 | 押し続けても玩具として繰り返し遊べる | press、hold loop、releaseの決定的な周期を車種別に持つ。 |
| REQ-090 | 追加 | 対象へ作用している間は対象側の反応で進行を示す | 既存接触判定の結果をtarget VFXへ渡し、判定条件自体は変えない。 |
| REQ-091 | 追加 | 完了時は車種固有の大きな成功演出を出す | 共通の黄色い星だけに頼らず、土、赤白、赤青など役割色で描き分ける。 |
| REQ-092 | 追加 | 音がオフでも4車種を見分けられる | シルエット、動く部品、色、粒子の方向を車種ごとに変える。 |
| REQ-093 | 追加 | 音がオンなら押下開始、継続、対象作用、完了を聞き分けられる | 既存Web Audioへ短いattackとtarget cueを追加し、外部音源は使わない。 |
| REQ-094 | 追加 | 派手さのためにカメラや操作を不安定にしない | camera shake、全画面flash、動的RigidBody粒子を使わない。 |
| REQ-095 | 追加 | 毎frame React state更新と可変オブジェクト生成を増やさない | pure frame helper、ref、固定slot `InstancedMesh`を使う。 |
| REQ-096 | 追加 | Desktop、Tablet、Mobile landscapeでアクションと仕事を実操作検証する | 各車種のidle、free action、target action、completionを画像とtelemetryで確認する。 |

## 要件差分

| 区分 | 対象 | 理由 | 影響 |
| --- | --- | --- | --- |
| 維持 | REQ-001〜REQ-087 | 公開済みのゲーム契約を壊さない | ミッション判定時間、接触半径、速度条件、地図、カメラを変えない。 |
| 追加 | REQ-088〜REQ-096 | 押した瞬間と作用中の楽しさが不足している | 車体、車両周囲、対象、HUD、音へ段階的feedbackを追加する。 |
| 保留 | 新しい仕事、対象数、報酬、スコア | 今回は既存アクションの質へ集中する | アクション評価後に別設計で検討する。 |
| 削除 | なし | 既存の遊びを失わない | なし。 |

## 世界観辞書

- 全体: 箱庭の中で手に取って遊ぶ、密度の高い純ボクセル玩具。写実的な煙、液体、レンズ効果は使わない。
- 動き: 小さな部品がただ点滅するのではなく、役割部品が大きく「ためる、動く、戻る」の順で反応する。
- 粒子: 角のある積み木片。車種色と役割色を使い、半透明の霧や大量の物理破片は使わない。
- 成功: 対象そのものの変化を主役にし、その周囲へ車種固有の積み木花火を広げる。
- HUD: 右下の丸い主操作ボタンは、押下時に沈み、外周リングとiconが一度弾む。盤面を覆う文言は出さない。
- 音: 外部音源なしの玩具音。短いattackで押下を返し、継続音はBGMやengineを塞がない音量にする。
- 禁止: camera shake、画面全体の白flash、3Hzを超える高輝度点滅、写実的なけが・犯罪・破壊。

## 比較した方式

### A. 共通4段階 + 車種別strategy（採用）

全車種を`press burst → hold loop → target response → completion`の4段階へ揃え、transform、色、周期は
車種別pure strategyで返す。共通の固定pool rendererを1つだけ追加し、既存target VFXを車種別に拡張する。

- 長所: 押下応答と品質gateを共有しながら、4台を違う玩具として見せられる。
- 長所: 固定pool 1 draw callで性能上限を守りやすい。
- 短所: 共通frame契約と各strategyの両方を先に設計する必要がある。

### B. 既存共通粒子の色と個数だけを増やす（不採用）

差分は小さいが、土掘り、手当て、巡回が同じ粒子花火に見え、自由走行中の車体反応も改善しない。

### C. 物理破片、強いcamera kick、大きなscreen effect（不採用）

瞬間的には派手だが、3歳児の操作対象を見失いやすく、過去の接触時カメラ振動を再発させる。
Rapier bodyとdraw callも増えるため、箱庭の玩具表現には合わない。

## 共通リアクション契約

### 1. Press burst

- 入力の立ち上がりから次frameまでに車体部品と車両周囲VFXを開始する。
- HUDボタンはCSSだけで押し込みと1回の外周ringを表示する。
- actionが仕事条件を満たさなくても必ず見える。仕事進捗は増やさない。

### 2. Hold loop

- 押下継続中は0.55〜1.0秒の車種固有cycleを繰り返す。
- release時は途中で消さず、現在cycleの短い戻りだけ完了してidleへ戻る。
- 毎frame配列生成やReact state更新は行わない。

### 3. Target response

- 既存の距離、速度、継続時間gateが成立したframeだけ対象側を反応させる。
- hold進捗は対象のpulse、粒子密度、色の明るさで示し、円形progress UIは追加しない。
- 対象外で出る自由VFXと対象VFXは空間的に分け、成功したように誤認させない。

### 4. Completion

- runtimeが完了を登録した時刻を唯一の起点にする。
- 0.9〜1.4秒で収束し、次のtarget markerを隠さない。
- 既存の成功音、振動、仕事進捗と同時に開始する。

## 車種別デザイン

### ブルドーザー: 「ドン、ガガガ」

- Press: bladeを素早く下げ、車体を一度だけ浅く沈ませる。blade前方へ黄、灰、茶の力cubeを扇状に飛ばす。
- Hold: 走行中はblade両端から交互に小さな土煙cubeを出し、停止中はbladeが小さく油圧bounceする。
- Target: がれき接触中は接触面から短い亀裂状cubeを広げる。既存破片を6個から12個相当へ増やし、前方へ押し流す。
- Completion: 黄灰の角張った衝撃ringと大きさの違う破片を出し、対象は0.25秒で潰れてから崩れる。

### ショベルカー: 「すくって、ポン」

- Press: armを下げるだけでなく、bucketを内側へcurlして一連の掘削cycleを作る。
- Hold: 0.9秒ごとに`下げる → すくう → 少し持ち上げる → 戻す`を繰り返す。bucket先端から橙灰の軌跡cubeを出す。
- Target: 土cubeがbucket方向へ吸い寄せられ、持ち上げ局面で車体横へ小さな放物線として投げ出される。
- Completion: 土山が上から順に潰れ、茶橙のcubeが噴水状に上がって左右へ落ちる。物理bodyにはしない。

### 救急車: 「ピカッ、げんき！」

- Press: 赤十字と屋根灯を大きく1回pulseし、車体から赤白の十字型waveを2段階で外へ広げる。
- Hold: 赤白の小さな十字とheart形voxelが車体周囲をゆっくり上昇する。高頻度点滅は使わない。
- Target: 患者の周囲を赤白cubeが輪になって回り、hold進捗に合わせて低い位置から頭上へ移る。
- Completion: 患者が既存の起き上がりに小さなanticipationを加えて立ち、頭上へ大きなheartと十字が弾ける。

### パトカー: 「ピーポー、キラキラ」

- Press: 屋根の赤青灯を大きく切り替え、左右へ赤青の短い積み木ringを一度放つ。
- Hold: 2Hz以下の赤青切替、屋根から短い縦beam cube、走行時だけ車体後方へ交互色の短いtrailを出す。
- Target: 巡回門の赤青accentが入口から中央へ順番に点灯し、通過方向が分かる。
- Completion: 門から赤青cubeがアーチ状に広がり、通過後は白い完了色へ滑らかに戻す。

## アーキテクチャ

### 車両周囲VFX

- `vehicleActionVfx.ts`: 4車種のcycle、press edge、fixed transform、palette indexを返すpure helper。
- `VehicleActionVfx.tsx`: 最大48slotの単一`InstancedMesh`をrefで更新する。instance colorを使い1 draw callにする。
- `VoxelGameScene.tsx`: 非消防車選択時だけ描画し、`commandRef`と`vehicleTelemetryRef`を渡す。

### 車体アニメーション

- 既存`VoxelBulldozer`、`VoxelExcavator`、`VoxelAmbulance`、`VoxelPolice`のpalette batchは変えない。
- booleanだけの動作を、pureなphase helperから得たoffset、rotation、scaleへ置き換える。
- 車体rootとRapier colliderは動かさず、見た目のrole partだけを動かす。

### 対象VFX

- `BulldozerDebrisMission`と`ActionTargetMission`の判定は維持する。
- active contactと0〜1のhold progressを既存frame helperへ追加する。
- pool容量は増やしてもbatch数は増やさず、完成済みtargetは既存runtime状態を唯一の真実にする。

### HUDと音

- 主操作ボタンはDOM `:active`と入力中classでpress ringを出す。子要素実寸と親境界を既存helperで検証する。
- Web Audioは押下edgeの短いattack cueとtarget作用中の音色変化を追加する。音オフ時はAudioContextを起動しない。
- touchの振動は既存の対象／仕事完了だけを維持し、押下ごとの振動は追加しない。

## データフロー

1. keyboard／pointer入力が既存`DriveCommand.primaryAction`を更新する。
2. 車体modelと`VehicleActionVfx`が同じrefを読み、press edgeとhold phaseを独立計算する。
3. 既存mission sceneが距離、速度、hold条件を計算し、成立時だけtarget responseを更新する。
4. runtimeのcompletion eventがtarget completion、音、振動、仕事進捗を同期する。
5. telemetryはactive slot数、cycle phase、target progressを公開し、E2Eは描画と一致することを確認する。

## エラー処理

- 非有限の時刻、delta、位置、速度はsafe値へclampし、slotを非activeへ戻す。
- vehicle ID、palette、target indexが不正なら自由VFXを隠し、mission runtimeや入力は止めない。
- audio node生成失敗時は現行どおり視覚だけで続行し、押下を不正解や失敗に変えない。
- WebGL contextやscene errorは既存ErrorBoundaryとbrowser error gateで検出する。

## テスト戦略

### Pure/unit

- 4車種それぞれのpress 0ms、hold中間、cycle終端、release戻りのtransform数、方向、paletteを固定する。
- disabled、不正時刻、不正位置、車種切替で全slotが正しく非active／再初期化されることを確認する。
- 既存の距離、速度、hold durationが変わらず、target progressだけがVFXへ渡ることを確認する。
- model phase、音mix、HUD button state、pool上限、draw call予算を固定する。

### Docker E2E

- Desktop 1280×720、Tablet 1024×768、Mobile landscape 844×390で4車種を選択する。
- 各車種でidle、対象外press、hold loop、target作用、completionを実操作する。
- 各状態のtelemetry、canvas、HUD境界、console／page／request error 0を検証する。
- 各車種4状態×3 viewportの代表画像を保存し、車体、粒子、対象、操作ボタンを原寸目視する。
- canonical full、production smoke、公開URLのfocus E2Eを回帰する。

## 実装・検証結果（2026-08-04）

- 共通48-slotの`VehicleActionVfx`を1 `InstancedMesh`で実装し、車種切替時と非active時はslotを隠す。
- ブルドーザーはblade slam、亀裂、12個相当の破片、ショベルカーは0.9秒の掘削cycle、救急車は十字waveとheart、パトカーは0.5秒の赤青灯、beam、trail、archを実装した。
- 対象VFXは5描画から2描画、色遊びは5描画から1描画へ集約し、仕事判定、物理body、camera座標は変更していない。
- fresh unitは50 files / 515 tests、E2E補助は32 tests、production buildはgame 180,389 bytes、Three 718,551 bytes、Rapier 2,237,128 bytesで全予算内。
- 車種別E2Eはブルドーザー18枚、ショベルカー・救急車・パトカー42枚、AudioContext 6枚をDesktop、Tablet、Mobile landscapeで生成し、自由action、対象作用、成功、HUD境界を確認した。
- canonical fullは19 scenario、37 artifacts、contract failure 0、console／page／request error 0/0/0。代表8 solidの安定後最大貫通深さは0.00143以下だった。
- Apple M4実GPUの1280×720、2秒warm-up＋12秒計測で4車種ともmedian 59.88fps、p10 56.50〜57.14fps、平均60.00fps。sceneは33〜34 calls、車体は7 callsだった。
- feature SHA `c465eaf`のGitHub Pages run `30939984761`はbuild／deploy成功。公開URLの実pointer actionではactive cubeがブルドーザー14、ショベルカー12、救急車16、パトカー12、press count 1→4、release復帰、browser error 0を確認した。

## 受け入れ条件

- [x] 4車種すべてで、対象外でも押下100ms以内に車体、周囲VFX、HUDの3箇所が反応する。
- [x] 音を切っても4車種のアクションを静止画と短い連続frameで区別できる。
- [x] 対象作用中と対象外actionを誤認せず、既存仕事条件と完了数が変わらない。
- [x] 各車種の完了演出が共通星だけでなく役割色と対象変化を持つ。
- [x] camera座標、車体物理位置、操作方向へVFX由来の振動やdriftがない。
- [x] 4車種の車体draw call 7以下、scene最大34 calls以下を維持する。
- [x] game entry 350kB、通常chunk 600kB、Three 750kB、Rapier 2.25MB以内を維持する。
- [x] Desktop、Tablet、Mobile landscapeでHUDの重なり、はみ出し、操作阻害がない。
- [x] fresh unit、budget build、専用E2E、canonical、production smoke、公開E2Eが成功する。
- [x] task単位の日本語commit、secret scan、main push、Pages成功、remote SHA一致を確認する。

## 非対象

- 消防車の放水、炎、消火判定の変更。
- 新車両、新ミッション、新地区、map拡張、報酬、スコア、制限時間。
- camera shake、全画面post-processing、bloom、motion blur、写実的particle texture。
- 動的RigidBody破片、地形変形、多関節IK、外部音声asset、音量設定の保存。

## 性能目標

- 車両周囲VFXは最大48 fixed slot、追加1 draw call、毎frameallocation 0を目標にする。
- 既存target poolのbatch数を維持し、slot増加だけで演出密度を上げる。
- 非選択車、action inactive、画面外jobはinstance count 0にする。
- Apple M4 physical GPUで4車種ともmedian 55fps以上、p10 45fps以上、scene 34 calls以下を再認証する。
- Docker software rendererのfpsは機能回帰の記録だけに使い、性能達成根拠にしない。

## リスクと対策

| リスク | 対策 |
| --- | --- |
| 派手な粒子で車両や対象が隠れる | 最大高さ、半径、寿命を車体外接寸法基準で制限し、画像で輪郭を確認する。 |
| 4車種が色違いの同じ演出になる | 方向、周期、role part、target変化の4点を車種別strategyで固定する。 |
| 仕事外actionが完了と誤認される | 黄色い成功星、成功音、振動はruntime completion時だけに限定する。 |
| camera振動が再発する | cameraとRigidBodyへ値を書かず、visual child transformとfixed VFXだけを更新する。 |
| 点滅が強すぎる | 高輝度切替は2Hz以下、全画面flashなし、CSS reduced-motionではring反復を止める。 |
| scene callとbundleが予算超過する | 1つのvertex-color `InstancedMesh`へ集約し、budget testと物理GPU probeをgateにする。 |
| 共通sceneが再び密結合する | press VFX、target VFX、model phase、audio cueをpure helper境界で分離する。 |

## 自己レビュー

- Placeholder: 仮置き語や未確定の選択肢は残していない。
- 整合性: 仕事判定は維持し、自由actionは視覚と音だけ、completionだけが成功cueを出す。
- Scope: 4車種の既存主操作強化に限定し、消防車、map、新仕事は含めていない。
- 曖昧性: 押下応答、cycle、target response、completion、性能、検証viewportを数値または状態で固定した。

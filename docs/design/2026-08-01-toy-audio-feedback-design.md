# 玩具の音と振動 横断フィードバック設計

**日付:** 2026-08-01

**状態:** 実装・local検証済み（公開URL検証待ち）

**対象:** 5車種のBGM、走行音、専用アクション音、成功音、振動、HUD、telemetry

## 1. 目的

消防車、ブルドーザー、ショベルカー、救急車、パトカーの操作に、見た目と同じ「積み木のおもちゃ」の手触りを音と短い振動で加える。音がなくても既存の表示だけで遊べる契約を維持し、音はユーザーが右上ボタンを押した後だけ再生する。

## 2. 世界観辞書

| 対象 | 語彙・モチーフ | 避ける表現 |
| --- | --- | --- |
| BGM | 木琴、玩具ピアノ、五音音階、短い反復 | 映画的、緊迫、長い旋律、外部音源 |
| エンジン | 小さなゼンマイ、丸い低音、速度に追従 | 写実的な排気音、爆音 |
| 消防車 | 水しぶき、空気の「シュッ」 | 写実的な高圧噴射、悲鳴 |
| ブルドーザー | 低い「ガタガタ」、木の歯車 | 金属の強い衝撃音 |
| ショベルカー | バケットの「コトン」、土の軽い摩擦 | 重機の騒音、鋭いクラッシュ |
| 救急車 | 丸い2音、手当てのきらめき | 不安を煽る実在サイレン |
| パトカー | 赤青灯に合わせた短い2音 | 持続する大音量の警報 |
| 成功 | 上昇する3音、短い木琴 | ファンファーレ、評価・失敗音 |
| UI | 既存の黒い玩具ラベル、白文字、橙のON表示 | 設定モーダル、音量スライダー |

背景、盤面、HUD、ボタン、対象、文言、エフェクトと同じく、音も「木製の机に置いた純ボクセル玩具」という語彙に統一する。

## 3. 要件台帳

| ID | 状態 | 要件 | 判断 |
| --- | --- | --- | --- |
| REQ-001〜REQ-062 | 維持 | 純ボクセル箱庭、5車種、15仕事、自由走行、物理、色遊び、PC/touch、公開・性能契約 | 既存unit／E2Eを回帰gateにする。 |
| REQ-063 | 追加 | 音はユーザー操作後だけ開始し、初期状態は無音 | Web Audioの自動再生制限を守り、`おと オフ／オン`ボタンで明示する。 |
| REQ-064 | 追加 | 5車種すべてに速度連動の玩具エンジン音がある | 物理telemetryの速度を0〜1へ正規化し、周波数と音量だけを滑らかに更新する。 |
| REQ-065 | 追加 | 車種別アクションが音だけでも区別できる | 放水、ブレード、掘削、手当て、パトロールを別の音色・周期へ割り当てる。 |
| REQ-066 | 追加 | BGMは短い五音音階で、仕事の邪魔をしない | 外部assetなしの手続き生成とし、BGMはエンジン・アクションより小さくする。 |
| REQ-067 | 追加 | 対象完了・仕事完了・乗り換えを短い合図で伝える | mission snapshot差分から離散eventを1回だけ生成する。 |
| REQ-068 | 追加 | touch対応端末では対象完了と仕事完了を短く振動で伝える | 音と振動を有効にした後だけ`navigator.vibrate`を使い、未対応時は無視する。 |
| REQ-069 | 追加 | 非表示中やOFF中に音を鳴らさない | `visibilitychange`とtoggleでAudioContextをsuspendし、再表示時は有効中だけresumeする。 |
| REQ-070 | 追加 | 音の毎frame更新でReact再描画や可変poolを増やさない | telemetry refを読む命令的directorと固定Web Audio graphを使う。 |
| REQ-071 | 追加 | 音の状態とmixを決定的に検証できる | `render_game_to_text()`へenabled、context、vehicle、action kind、gain、cue数を出す。 |

### 要件差分

| 区分 | 要件 | 理由・影響・代替案・復帰条件 |
| --- | --- | --- |
| 維持 | REQ-001〜REQ-062 | 公開済みの操作・見た目・仕事・物理を変更しない。 |
| 追加 | REQ-063〜REQ-071 | 5車種を横断する感覚フィードバックを完成させる。 |
| 保留 | マップ拡張、chunk streaming、LOD | 本タスクでは音の回帰範囲を独立させる。音公開後に次タスクとして復帰する。 |
| 削除 | なし | ユーザー合意なしに要件を削除しない。 |

## 4. UI配置

- `おと オフ／オン`は右上の全画面ボタン直下へ置く。
- 右端は全画面ボタンと同じ14px、上端はsafe area + 68pxとし、全画面ボタン実寸との間に8px以上を確保する。
- Desktop／Tabletは94×48px以上、Mobile landscapeは84×44px以上を確保する。
- 車両selector、中央mission、右下action、左下joystickのどれとも矩形が交差しないことを3 viewportで数値確認する。
- visible labelは短い`おと オフ`／`おと オン`、accessible nameは`おとと振動をオンにする／オフにする`とする。
- Web Audio非対応ならdisabledの`おと なし`を表示する。ゲーム操作はそのまま利用できる。

## 5. 音響アーキテクチャ

### 5.1 pure mixer

`toyAudioMix.ts`は時刻、車種、速度、アクション状態、enabledから次を返す。

- 五音音階のBGM周波数とgain
- 速度連動engine周波数とgain
- 車種別action kind、2系統の周波数・gain、noise gain
- 無効時はすべてのgainが0

車種定義と周期計算はpureで、境界値・非有限値・全5車種をVitestで検証する。

### 5.2 event差分

`toyAudioEvents.ts`は前後のmission snapshotから`vehicle-switch`、`target-complete`、`mission-complete`を導出する。最終対象ではtargetとmissionを別snapshotで各1回鳴らせるが、同じsnapshotを再通知しても重複させない。

### 5.3 Web Audio graph

ユーザーclick時に初めて`AudioContext`を生成する。固定sourceはBGM、engine、action A、action B、noiseの最大5本とし、各gainをmasterへ接続する。毎frameは`setTargetAtTime`で周波数とgainを変更し、nodeや配列を生成しない。成功音だけは離散event時に短命oscillatorを生成し、終了後に自動解放する。

### 5.4 React接続

`useToyAudioFeedback`が1本の`requestAnimationFrame`で既存telemetry refとcommand refを読み、directorを更新する。React state更新はtoggle、context state、visibility、mission eventなどの低頻度時だけに限定する。

## 6. 車種別mix

| 車種 | action kind | 主成分 |
| --- | --- | --- |
| 消防車 | `water` | 低いnoise + 小さな高音パルス |
| ブルドーザー | `blade` | 低いtriangleの周期振動 |
| ショベルカー | `bucket` | 丸いsquareの2段パルス |
| 救急車 | `care` | sineの柔らかい2音 |
| パトカー | `siren` | red/blue相当の2音を0.28秒交互 |

`primaryAction=false`ではaction gainを0にする。サイレンはパトカーのアクション中だけ鳴り、通常走行では鳴らさない。

## 7. 状態遷移

```text
初期 locked/off
  └─ ユーザーclick → context生成/resume → enabled/running
       ├─ hidden → enabled/suspended
       │    └─ visible → enabled/running
       ├─ mission差分 → cue + 対応端末だけ振動
       └─ ユーザーclick → disabled/suspended
unmount → node停止/context close
```

resumeに失敗した場合は`enabled=false`へ戻し、ボタンを再操作可能にする。ゲーム本体は止めない。

## 8. 受け入れ条件

- [x] 初期ロードでAudioContextを作らず、consoleにautoplay errorが出ない。
- [x] ボタン押下後にcontextがrunningとなり、再押下でsuspendedとなる。
- [x] 5車種の走行音とアクション音がpure mixとruntime telemetryで識別できる。
- [x] 対象完了、仕事完了、乗り換えcueがsnapshot差分ごとに1回だけ発火する。
- [x] touch対応時だけ短い振動patternを呼び、未対応時に例外を出さない。
- [x] Desktop 1280×720、Tablet 1024×768、Mobile landscape 844×390でHUDが重ならない。
- [x] keyboardとtouchの既存操作、5車種の仕事、色遊び、物理が回帰しない。
- [x] `render_game_to_text()`から音状態を検証できる。
- [x] Docker内の全unit、build、専用E2E、既存production smokeを通す。
- [ ] GitHub Pages公開URLでも専用E2Eとconsole cleanを確認する。

## 9. 非対象

- 音量スライダー、ミキサー設定、設定保存、音源ダウンロード。
- 実在のサイレン音、音声、環境音、立体音響、HRTF、reverb。
- ゲームオーバー、失敗音、時間切れ、ダメージ振動。
- マップ拡張、追加車両、追加仕事、chunk streaming／LOD。

## 10. リスクと対策

| リスク | 対策 |
| --- | --- |
| ブラウザの自動再生制限 | user clickまでcontextを生成せず、resume失敗をUI状態へ戻す。 |
| 音が強く幼児を驚かせる | master gain上限を低くし、サイレンを短い玩具音へ限定する。 |
| background tabで鳴り続ける | visibilityでsuspendし、復帰条件をenabledに限定する。 |
| AudioContext/node leak | 固定graphを1個だけ所有し、unmountで停止・closeする。 |
| 毎frame GCやReact再描画 | pure scalar frame + imperative ref + fixed graphに限定する。 |
| E2E環境で実音を判定できない | pure testと公開telemetryでfrequency/gain/action kind/contextを検証する。 |
| HUDが狭い横画面で重なる | 主要HUDとのanchor条件を3 viewportでDOM矩形測定する。 |

## 11. 性能目標

- persistent audio sourceは最大5、persistent gainは6以下。
- audio frame更新は1 RAFあたりscalar計算のみ、React state更新0回。
- 外部fetch 0、追加音源asset 0、bundleへのバイナリ追加0。
- 既存bundle budgetを維持する。
- 既存の物理GPU性能契約を変更しない。最終goalで物理GPUを再認証する。

## 12. 最終版チェック

- [x] 受け入れ条件がある。
- [x] 非対象がある。
- [x] リスクと対策がある。
- [x] 性能目標がある。

## 13. local実測

- unit: 46 files / 446 tests、すべて成功。
- production build: 656 modules、game 140,509B、React 192,532B、Three 718,551B、Rapier 2,237,128B。全budget内。
- production smoke: root、`/voxel-game.html`、`/vehicle-lab.html`のWebGL起動とconsole／page／request errorなし。
- 音専用E2E: manifest `2026-08-01T17:45:44.578Z`。3 viewportすべてでactual AudioContextの`locked → running → suspended`、5 action kind、4 vehicle-switch cue、速度連動engineを確認。
- HUD: 全画面ボタンとの右端anchor一致、上下8px以上、主要HUD間8px以上、内部2子要素の親内収まりを3 viewportで数値確認。オン／オフ6枚を目視し、状態差、重なり、はみ出し、盤面遮蔽なし。
- fleet回帰: manifest `2026-08-01T17:43:03.991Z`。3 viewportでショベル、救急、パトカーの仕事完了、帰庫、次仕事へ進行。24画像中、長い仕事名の代表3枚を追加目視して音ボタンとの干渉なし。
- fresh回帰で発見したパトカーの車庫右壁迂回は、固定`x=6`を壁外縁＋車体外接幅＋1.5unitの計算値へ変更し、Desktop単独と全3 viewportの双方で完走した。
- Docker software rendererのfpsは物理GPU性能認証へ使用しない。音実装は3D sceneを変更しないため、物理GPU再認証は最終goalで実施する。

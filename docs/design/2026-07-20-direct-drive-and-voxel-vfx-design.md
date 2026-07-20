# 画面方向ダイレクト操作とボクセルVFX強化 設計書

## 状態

- 会話設計: 2026-07-20 承認済み
- Written spec: 2026-07-20 承認済み
- 対象entry: `voxel-game.html`
- 基準設計: `docs/design/2026-07-19-voxel-firetruck-gameplay-slice-design.md`

## 目的

純ボクセル消防車ゲームの操作とリアクションを、固定カメラの箱庭を直感的に遊べる手触りへ改良する。

1. 左右入力の反転感と旋回操作を廃止し、入力した画面方向へ消防車が直接進むようにする。
2. 静止して見える放水を、ノズルから着弾点へ連続して流れるボクセル水流へ変える。
3. 離れた場所へ破片が出現する破壊を、元ブロック内部から破片が飛び出す連続した崩壊へ変える。

## 世界観辞書

- 主語: 子どもが手で動かす、短く太い働く車のおもちゃ。
- 材質: 角の立った不透明な色付きブロック。写実テクスチャ、丸い粒子、ガラス表現を使わない。
- 水: 水色と白の小さなボクセルが列になって流れ、着弾点で小さく弾ける。
- 破壊: 元の積み木がその場で6片へ割れ、衝突方向から外側と上へ飛ぶ。補助片も角張った小ボクセルに限定する。
- 動き: 瞬間移動ではなく、開始点・移動中・着地点が読める。誇張は玩具らしい範囲に留める。
- UI: 現在のクリーム、赤、濃灰、黄、水色の玩具パネルを維持する。

## 要件差分台帳

| ID | 状態 | 要件 | 理由・影響・代替・復帰条件 |
|---|---|---|---|
| REQ-014 | 維持 | 車両、箱庭、水、破片を純ボクセル表現で統一する | 不透明なcuboidとInstancedMeshを維持する。流体シェーダーへは置き換えない。 |
| REQ-017 | 維持 | 放水は車両前方へ出し、近距離・前方の火だけを軽く自動追尾する | 照準と消火判定は変更せず、表示上の水粒だけを時間方向へ動かす。 |
| REQ-018 | 強化 | 積み木は衝突で6片へ崩れ、約5秒後に安全なら復元する | 6片を元ブロック内部から開始させ、衝突方向を使った初速で飛ばす。1.2秒表示、5秒復元、半径3の安全条件は維持する。 |
| REQ-021 | 維持 | カメラは世界方向固定で車両位置だけを追従する | 画面方向操作の基準として固定カメラを利用し、車両yawでは回転させない。 |
| CTRL-001 | 追加 | WASD、矢印、タッチレバーは画面の上下左右へ直接移動させる | 左入力は画面左、右入力は画面右へ進む。カメラ角度に依存しない世界座標固定操作にはしない。 |
| CTRL-002 | 追加 | 消防車は移動ベクトルの方向へ滑らかに向きを変える | 入力直後から移動を開始し、車体yawだけが短く追従する。無入力時は向きを保持して減速する。 |
| CTRL-003 | 追加 | 斜め入力で最高速度を増やさない | digital入力は長さ1へ正規化し、touchはレバーの大きさを0〜1の速度倍率として使う。 |
| CTRL-004 | 置換 | 旧`steer + throttle`による旋回運転を廃止する | 理由: 左右反転感があり、左右入力がその方向への移動になっていない。影響: 既存E2Eの曲線走行を全面更新する。代替: 画面方向の`moveX + moveY`。復帰条件: ダイレクト操作が実機で旧操作より明確に劣ると確認された場合だけ再検討する。 |
| WATER-001 | 追加 | 放水中は水粒がノズルから先端へ時間差で連続移動する | 24個前後の固定instanceを循環させ、毎frameのmesh生成を行わない。 |
| WATER-002 | 追加 | 有効な火へ当たる時は着弾点に短いボクセル飛沫を表示する | 消火判定と同じtarget結果を使い、範囲外・背面では飛沫を出さない。 |
| BREAK-001 | 追加 | 6破片の初期AABBは元ブロックAABB内に収める | 遠方への瞬間spawnを禁止し、破壊の連続性を保証する。 |
| BREAK-002 | 追加 | 破片は衝突方向を基準に、異なる外向き・上向き速度を持つ | 決定的なslot別係数を使い、ランダム値で回帰画像を揺らさない。 |
| BREAK-003 | 追加 | 破壊直後に小さな補助片を短時間だけ表示する | 32slot以下の固定InstancedMeshを使い、物理colliderは持たせない。 |
| REG-001 | 維持 | 24個のRapier破片body/collider/mesh identityを再利用する | poolの増減、破壊ごとのReact再mount、新規mesh割当を禁止する。 |
| REG-002 | 維持 | PC/touch、消火、帰庫再開、全4色破壊、旧Vehicle Labを回帰確認する | 操作変更の影響範囲が大きいため、既存最終E2Eを新操作へ移植する。 |

保留・削除するユーザー向け機能はない。旧旋回操作だけを、承認されたダイレクト操作へ置換する。

## 操作設計

### 共通command

`DriveCommand`を次へ変更する。

```ts
interface DriveCommand {
  readonly moveX: number; // -1: 画面左、+1: 画面右
  readonly moveY: number; // -1: 画面下、+1: 画面上
  readonly spray: boolean;
}
```

- Keyboard: `A/ArrowLeft = moveX -1`、`D/ArrowRight = moveX +1`、`W/ArrowUp = moveY +1`、`S/ArrowDown = moveY -1`。
- Touch: DOM座標の右を`moveX +`、上を`moveY +`へ変換する。現在のY反転は入力変換層だけで行う。
- Digital斜め入力は正規化する。Touchはdead zone 0.14を維持し、レバー半径を速度倍率として残す。
- PCとtouchは同じpure helperを通し、入力方式ごとの左右符号を持たせない。

### 画面方向からworld方向への変換

固定カメラの水平投影から、正規直交する`screenRight`と`screenUp`を作る。

```text
desiredWorld = screenRight * moveX + screenUp * moveY
```

このbasisはカメラ実装と共通定数から作り、VehicleController内へ符号を重複記述しない。カメラyawは固定なので、車両yawを入力変換へ使わない。

### 車両物理

- 目標平面速度は`desiredWorld * 7.4 * inputMagnitude`。
- 入力中は現在速度から目標速度へ指数dampingする。無入力時は既存相当の自然減速を維持する。
- 目標yawは`atan2(desiredWorld.x, desiredWorld.z)`。最短角差から角速度を求め、車体だけを滑らかに移動方向へ向ける。
- 移動はyaw完了を待たない。短時間だけ車体の向きが追従するが、入力方向と実際の移動方向は常に一致させる。
- 放水方向は車体の現在forwardを使う。移動方向ではなく、見えているノズル方向と一致させる。

## 放水VFX設計

### 表現

- 水流本体は青16・白8を目安とする固定instance pool。
- 各instanceは`phaseOffset`を持ち、正規化ageを`fract(flowTime * speed + phaseOffset)`で求める。
- 位置はノズルからvisible distanceまで補間し、終端へ近づくほど小さな下向き放物線と微小な上下揺れを加える。
- instance scaleは開始・終了で少し小さくし、中間を最も読みやすくする。
- 放水停止時は全instanceを非表示にし、再開時はノズル側から流れが始まる。

### 着弾飛沫

- `targeted && sprayActive`の時だけ、照準終端に青・白8instanceの飛沫を出す。
- 飛沫は同じtarget directionを基準に、上下・左右へ短い決定的な方向を持つ。
- lifetimeは約220ms。連続放水中は位相をずらして再利用する。
- 水流と飛沫は既存2色のInstancedMeshへまとめ、描画callを不要に増やさない。

### データ境界

水粒位置を作るpure helperへ`flowTime`、nozzle、direction、distance、targetedを渡す。表示とE2E telemetryは同じ計算結果を使う。消火の2500ms判定は変更しない。

## 破壊VFX設計

### 主破片

- 6片は約0.5unitのcubeとし、元1.5unit block内へ3列×2段で配置する。
- `activateFragment()`はblock中心とslotの小さなlocal offsetだけで初期位置を決める。広場へ離して配置するblock別offset表は削除する。
- 衝突成立時の車両forwardをblock別に保存し、主な飛散方向に使う。
- slotごとの左右spread、上向き成分、速度倍率を決定的に定義する。水平速度はおおむね2〜3.5unit/s、上向き速度は2.2〜3.8unit/sを初期候補とする。
- 破片同士と地面のRapier衝突、回転、1.2秒後のdisable/sleep、5秒安全復元を維持する。
- 非車両bodyの衝突速度を破壊判定へ使わない契約を維持する。

### 補助片

- 最大32slotの小さなcubeを単一InstancedMeshで事前確保する。
- 1回の破壊で8slotを使い、衝突地点から約350msだけ拡散・縮小する。
- colliderを持たず、ゲーム状態へ影響させない。
- block色をinstance colorへ設定し、4色blockの同時破壊でも新規materialを作らない。

## アーキテクチャ境界

- `input/controlState.ts`: device入力を画面方向commandへ正規化するpure層。
- `scene/screenRelativeMovement.ts`: camera basis、world移動vector、目標yawを作るpure層。
- `scene/VehicleController.tsx`: Rapier速度・yaw追従・telemetryのみを担当する。
- `scene/waterFlow.ts`: 水流と飛沫のinstance transformを作るpure層。
- `scene/WaterAndFire.tsx`: poolの所有、frame time、instance反映、既存mission signalを担当する。
- `scene/breakableVfx.ts`: 主破片の初期offset/velocityと補助片ageを作るpure層。
- `scene/BreakableBlockPlaza.tsx`: Rapier pool、impact event、補助片InstancedMeshの所有を担当する。

高頻度の位置はReact stateへ入れず、ref・Rapier・InstancedMeshへ閉じる。mission phaseや復元など低頻度状態だけ既存runtime subscriptionを使う。

## エラー処理とライフサイクル

- `NaN`、無限大、長さ0の入力vectorは停止commandへ正規化する。
- カメラbasisが作れない場合は既存固定カメラ定数から安全なbasisへ戻す。
- blur、visibilitychange、pointercancel、lostpointercapture、unmountでは`moveX/moveY/spray`をすべて解除する。
- VFX poolはunmountで全instanceを非表示にし、animation frameやtimerを残さない。
- reset、帰庫再開、fragment expiryで古いVFX ageを次のイベントへ持ち越さない。

## テスト設計

### Unit RED → GREEN

1. `A`が`moveX:-1`、`D`が`moveX:+1`を返し、左右が反転しない。
2. W/A/S/Dとtouchの同じ方向が同じcommandを返す。
3. digital斜め入力の長さが1、touch中間入力は大きさを維持する。
4. 画面左・右・上・下が固定カメラbasis上の対応world方向になる。
5. 目標yawが移動vectorを向き、角差は最短方向へ正規化される。
6. 異なる`flowTime`で同じ水instanceの位置が前進し、全instanceがnozzle〜visible end内にある。
7. targeted時だけ飛沫が生成され、age 1でscale 0になる。
8. 全24主破片の初期AABBがそれぞれ元block AABB内にある。
9. slot速度は6方向で一意、衝突forwardとのdotが正、上向き成分が正である。
10. 主破片24slot identityと補助片pool上限が固定される。

### Browser E2E

- Desktop: W/A/S/Dを個別に短く押し、車両の画面投影が上・左・下・右へ移動する。A/Dでその場旋回だけをしない。
- Touch: レバーを4方向と斜めへ動かし、keyboardと同じ画面方向・速度上限になる。指の片側解放、cancel、visibility後も回帰確認する。
- Water: 放水開始、流動中、着弾飛沫の3時点でinstance位置と画像を取得し、2frame間で先端だけでなく複数粒が前進する。
- Break: 衝突成立frameでは6片が元block AABB内、その後150〜350msで外側・上へ分離する。赤・黄・青・緑の全色で実車衝突を行う。
- Mission: 新操作でPC/touchとも車庫→火災現場→消火→freeRoam→帰庫再開を完走する。
- Layout: desktop 1280×720、tablet 1024×768、mobile landscape 844×390でHUD、車両、水、飛沫、破片がviewport内にあり、操作を阻害しない。
- Regression: unit、3-entry build、Voxel統合E2E、Vehicle Lab E2E、completed/failed manifestを再実行する。

## 受け入れ条件

- 左右入力は画面の対応方向へ進み、PCとレバーで符号差がない。
- 4方向入力で車両位置が変化し、その場旋回だけの状態が残らない。
- 車体は移動方向へ滑らかに向き、固定カメラは回転しない。
- 放水中、複数の水粒がノズルから先端へ連続して移動して見える。
- 有効着弾時にだけ短い飛沫が見える。
- 破壊frameの6主破片は元block内部から開始し、その後に物理的に分離する。
- 全4色の破壊、他block非破壊、1.2秒消失、5秒安全復元、24slot identityが維持される。
- PC/touchの完全ミッションループと旧Vehicle Lab回帰がPASSする。
- 代表3 viewportの動画相当frame列と静止画を目視し、欠け・HUD重複・瞬間移動に見える破綻がない。

## 非対象

- NavMesh、自動運転、ドリフト、車輪ごとのサスペンション。
- 流体シミュレーション、メタボール、屈折、濡れた地面、永続する水たまり。
- ブロックの任意分割、破片数の動的増加、破片による連鎖破壊。
- カメラ回転、追加車両、乗り換え、スコア、制限時間。
- 旧ゲーム削除と`/`への昇格。

## 性能目標

- 車両本体7 draw callsを維持する。
- 水流・飛沫は2色2 draw calls以内を目標とする。
- 主破片は既存24slot固定、補助片は32instance以下・1 draw callを目標とする。
- 物理bodyは主破片24と車両・既存worldだけ。水と補助片へbodyを追加しない。
- 物理GPUでDesktop 60fps、Mobile/Tablet 30fpsの既存目標を維持する。
- SwiftShaderでは実測値を保存するが`certified:false`とし、物理GPU達成を主張しない。

## リスクと対策

| リスク | 対策 |
|---|---|
| 画面方向操作で既存の道路走行E2Eが全面的に壊れる | 純粋なscreen/world変換をunitで固定し、E2E helperを旋回手順ではなく目的画面方向の短い入力へ置換する。 |
| 車体yaw追従中に横滑りして見える | yaw dampingを短くし、玩具らしい即応性を優先する。実機で違和感があれば移動加速度だけを下げる。 |
| 水粒の位相がframe rateで揺れる | delta累積値を1箇所で管理し、pure transform helperへ明示的に渡す。固定時刻のunit/E2Eを用意する。 |
| 破片が広場外や他blockへ飛ぶ | block別初速を決定的にし、150〜350ms時点のworld AABBと他block impact 0を全色E2Eで検証する。 |
| 補助片でdraw callやallocationが増える | 単一InstancedMesh・固定32slot・instance colorを使い、破壊ごとの生成を禁止する。 |
| VFXを強くしすぎて車両やHUDが読めない | 3 viewportのframe列を原寸目視し、scale・lifetime・instance数を一度に1変数ずつ調整する。 |

## 採用判断

固定プールのボクセルVFX方式を採用する。物理水や滑らかなリボンシェーダーは、性能・決定性・純ボクセル表現のいずれかを損なうため採用しない。画面方向ダイレクト操作を新しい標準操作とし、旧旋回操作は互換モードとして残さない。

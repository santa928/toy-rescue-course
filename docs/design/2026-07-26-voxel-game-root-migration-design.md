# 新Voxel Game正式採用・ルート移行設計

## 目的

React + React Three Fiber + Rapierで再構築した純ボクセル消防車ゲームを正式採用し、
`/` の標準ゲームへ昇格する。比較のためだけに残していた旧ゲーム実装は、参照残りと
回帰を確認しながら削除する。

## 採用判断の根拠

- ユーザーが実機で見た目・画面方向操作・放水・破壊表現を承認済み。
- PC keyboardとmobile touchで、出庫・消火・自由走行・実走帰庫・再開を完走済み。
- 木、建物、車庫、遊具、燃焼中の炎へ意味に応じた物理判定を実装済み。
- Docker canonical full E2Eは2026-07-26のfresh runで
  `status: "completed"`、`contractFailures: []`、browser error 0/0/0、
  27 PNGと27 screenshot proofを確認済み。
- ホストの`ANGLE Metal Renderer: Apple M4`で、Desktop 1280×720・端末DPR 2
  （Canvas DPR上限1.5）の安定後5窓平均`60.0134fps`を確認済み。
  Tablet 1024×768とMobile landscape 844×390も既存30fps目標を満たした。

## 世界観辞書

移行は入口と不要コードの整理だけを行い、次の表現を変えない。

- 背景・盤面: 暖かい木製の箱庭、濃灰のテープ道路、黄色い埋め込み道しるべ。
- 主役: 短く太い純ボクセル消防車、赤・白・黒・銀・青の玩具色。
- 対象: 木製の火災建物、赤黄青緑の積み木、中央公園、白赤の開放型車庫。
- HUD: 上中央の仕事、左下の運転スティック、右下の放水、右上の全画面。
- エフェクト: 青白の流れる放水、着弾飛沫、中心から展開する6主破片、成功星。

## 要件台帳

| ID | 状態 | 要件 | 実現方法 |
|---|---|---|---|
| REQ-MIG-001 | 追加 | `/` で新Voxel Gameを直接起動する | `index.html`を`src/voxel-game/main.tsx`へ接続する |
| REQ-MIG-002 | 維持 | 既存の`/voxel-game.html`を互換URLとして残す | 同じ新Voxel Game entryを指すHTML aliasとして維持する |
| REQ-MIG-003 | 維持 | Vehicle Labを残す | `/vehicle-lab.html`と`src/vehicle-lab/`を変更しない |
| REQ-MIG-004 | 追加 | 旧ゲームruntime・scene・HUD・CSSを削除する | 参照グラフで新entryから独立している12ファイルを削除する |
| REQ-MIG-005 | 追加 | 旧ゲーム専用の型・テスト・E2E・依存を削除する | `__toyRescueTelemetry`、2 test files、旧responsive script、`lucide-react`を除去する |
| REQ-MIG-006 | 維持 | 新ゲームの操作・物理・見た目を変えない | `src/voxel-game/`と共有Voxel modelへ機能変更を入れない |
| REQ-MIG-007 | 追加 | `/`と互換URLの同一性を自動検証する | Desktop/Mobileのroot smokeと既存canonical E2Eを実行する |
| REQ-MIG-008 | 追加 | READMEの標準URL・検証件数を移行後へ同期する | 起動・操作・検証・互換URLを更新する |

## 要件差分

| 旧方針 | 新方針 | 判定 | 理由・影響・代替案・復帰条件 |
|---|---|---|---|
| 旧ゲームを`/`へ残す | 新Voxel Gameを`/`へ昇格する | 変更 | 受け入れ条件と物理GPU目標を満たしたため。互換URLとして`/voxel-game.html`を残す |
| 旧ゲーム削除を非対象にする | 旧ゲーム固有コードを削除対象にする | 追加 | 比較役を終え、二重保守をなくすため。Git履歴から復帰可能 |
| 3つの独立したゲーム表示をbuildする | `/`と`/voxel-game.html`は同じ新ゲームを表示する | 変更 | HTML出力は3つを維持するが、ゲームruntimeは新Voxel Gameへ一本化する |
| 旧色替え・5車種testを維持する | 旧実装と一緒に削除する | 削除 | 新ゲームのconsumerがなく、残すと廃止機能だけを固定するため。車種追加時は新domainとして再設計する |
| `lucide-react`を利用する | dependencyから削除する | 削除 | 唯一のconsumerが旧HUD。将来必要になれば用途確定後に再追加する |

## 削除対象

合計2,132行。次の12ファイルだけを削除する。

- `src/main.tsx`
- `src/App.tsx`
- `src/components/Hud.tsx`
- `src/game/data/vehicles.ts`
- `src/game/input/actions.ts`
- `src/game/simulation/colorEffect.ts`
- `src/scene/ToyRescueScene.tsx`
- `src/scene/VehicleModel.tsx`
- `src/styles/global.css`
- `src/test/colorEffect.test.ts`
- `src/test/vehicleData.test.ts`
- `scripts/verify-responsive.mjs`

削除後は`src/global.d.ts`から旧`__toyRescueTelemetry`型だけを除き、
`package.json`と`package-lock.json`から`lucide-react`をDocker内のnpmで削除する。

## 維持対象

- `src/voxel-game/`全体。
- `src/vehicle-lab/`全体。Voxel Gameが共有する消防車modelを含む。
- `voxel-game.html`、`vehicle-lab.html`。
- Voxel Game / Vehicle Labのunit・E2E・screenshot proof基盤。
- 過去の設計・計画書。履歴資料として削除しない。

## 受け入れ条件

- `/`と`/voxel-game.html`が同じ新Voxel Gameを表示し、初期missionが`assigned`である。
- Desktop 1280×720とMobile landscape 844×390で、Canvas/HUDがviewport内に収まる。
- `/vehicle-lab.html`の表示・操作・resource契約が回帰しない。
- 旧ファイル名、旧import、`__toyRescueTelemetry`、`lucide-react`の参照が0件になる。
- Docker内unit、production build、Voxel Game canonical full E2E、Vehicle Lab E2Eが成功する。
- build後も`index.html`、`voxel-game.html`、`vehicle-lab.html`を生成する。
- Voxel Game E2Eで`contractFailures: []`、browser error 0/0/0、27/27 proofを維持する。

## 非対象

- 新しい車両、ミッション、マップ区画、セーブ機能の追加。
- Voxel Gameの操作、camera、物理、VFX、HUD layoutの変更。
- `voxel-game.html` aliasやVehicle Labの削除。
- bundle分割、dependencyの大規模更新。
- 過去の設計・計画書の書き換え・削除。

## リスクと対策

| リスク | 対策 |
|---|---|
| rootだけ旧ゲームのまま残る | rootをDesktop/Mobileで直接開き、`mode: "drive-ready"`を検証する |
| 旧型importが削除後に残る | `rg`参照残りチェックとTypeScript buildを必須にする |
| Voxel GameがVehicle Lab共有modelまで失う | `src/vehicle-lab/`を明示的に維持し、Vehicle Lab E2Eを回す |
| 旧dependencyが残る | Docker内`npm uninstall lucide-react`後にlockfileと`npm ls`を確認する |
| URL変更でブックマークが壊れる | `/voxel-game.html`を互換URLとして維持する |
| 削除後に戻せない | 日本語commitを1単位にまとめ、Git履歴から復帰可能にする |

## 性能目標

- Voxel Gameの既存目標を維持する: Desktop 1280×720は物理GPUで60fps、
  Tablet/Mobile landscapeは30fps以上。
- draw call、動的body、破片pool、水poolを増やさない。
- root昇格はHTML entryの切替だけとし、描画runtimeへ追加処理を入れない。

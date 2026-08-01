# 色付きプール・色付きシャワー遊び Implementation Plan

> 実行方式: `superpowers:executing-plans`でmain上を1 TaskずつTDD実装する。各Taskは日本語commit、
> 全範囲secret scan、origin/mainへのpush、remote SHA 0/0、Actions／Pages確認で閉じる。

**Goal:** 南地区へ赤・青・黄のpool／showerを追加し、二車種の一時車体色、再接触、別色上書き、
時間切れ、乗り換え競合を完成版品質で実装する。

**Architecture:** 型付きmap source → pure `VehicleColorEffectRuntime` → Scene clock → 限定palette tint →
HUD／telemetryの一方向接続にする。station VFXは固定slot `InstancedMesh`とpure frame helperを使う。

**Tech Stack:** React, TypeScript, React Three Fiber, Three.js, Rapier, Vitest, Playwright, Docker Compose。

## Global Constraints

- npm／test／build／dev serverはDocker内だけで実行する。
- REDはmodule不存在または具体的behavior assertionで確認し、GREEN後にfocused／full回帰を通す。
- `progress.md`、`output/`はgit管理しない。
- 既存消防車、ブルドーザー、mission、積み木、入力、物理、3 viewportを回帰対象にする。
- 毎frame React state更新、無制限particle、写実流体、追加依存を入れない。
- 各Taskのpush前にstagedと`origin/main..HEAD`をsecret scanする。

---

## Task 1: 型付きcolor sourceと南地区配置

**Files:**
- Modify: `src/voxel-game/scene/productionWorldMap.ts`
- Modify: `src/voxel-game/scene/worldLayout.ts`
- Modify: `src/test/productionWorldMap.test.ts`

- [x] RED: 6 source、3色×2 kind、南地区包含、非重複、有限trigger boundsのtestを書く。
- [x] Docker focused testでsource不存在のFAILを確認する。
- [x] `ColorPlaySourceDefinition`とcanonical配置を実装し、map validatorへ接続する。
- [x] 既存sign postをtrigger外へ移し、solidと走行経路の干渉を避ける。
- [x] focused map testとproduction render test、buildを通す。
- [x] `色遊びの配置契約を追加する`でcommit・scan・push・公開確認する。

## Task 2: 一時色のpure runtime

**Files:**
- Create: `src/voxel-game/domain/VehicleColorEffectRuntime.ts`
- Create: `src/test/vehicleColorEffectRuntime.test.ts`

- [x] RED: 初回、接触保持、離脱減算、同source再接触、別色上書き、期限、切替、invalid入力を書く。
- [x] Docker focused testでmodule不存在FAILを確認する。
- [x] 12,000ms定数、snapshot、subscriber、秒境界signatureを実装する。
- [x] rejected切替は呼ばず、成功切替の別vehicleだけclearできるAPIにする。
- [x] focused testとfull unit、buildを通す。
- [x] `一時車体色の状態機械を追加する`でcommit・scan・push・公開確認する。

## Task 3: 二車種の限定palette tint

**Files:**
- Create: `src/vehicle-lab/model/vehiclePaint.ts`
- Create: `src/test/vehiclePaint.test.ts`
- Modify: `src/vehicle-lab/scene/VoxelFireTruck.tsx`
- Modify: `src/vehicle-lab/scene/VoxelBulldozer.tsx`
- Modify: `src/voxel-game/scene/VehicleController.tsx`

- [x] RED: fire-truckは`red`、bulldozerは`yellow`だけをpaintableとするtestを書く。
- [x] original色、赤青黄、不正値fallback、非paint部品不変を固定する。
- [x] modelへ`paintColor` propを追加し、material色だけを派生させる。
- [x] vehicle draw callとvoxel countが不変であるtestを追加する。
- [x] focused/full unit、buildを通す。
- [x] `二車種へ一時塗装を描画する`でcommit・scan・push・公開確認する。

## Task 4: pool／showerの固定slot VFX

**Files:**
- Create: `src/voxel-game/scene/colorPlayVfx.ts`
- Create: `src/voxel-game/scene/VehicleColorPlayground.tsx`
- Create: `src/test/colorPlayVfx.test.ts`
- Modify: `src/voxel-game/scene/VoxelGameScene.tsx`

- [x] RED: 3色、pool 8、shower 18、合計78、5 draw call以下、有限frameをtestする。
- [x] pool surface波動とshower drop循環のpure frame helperを実装する。
- [x] 3色batch＋白frame＋濃灰baseを固定`InstancedMesh`で描画する。
- [x] frame loopで新規配列／geometry／materialを作らない。
- [x] focused/full unit、build、renderer call差分を確認する。
- [x] `色水プールとシャワーを描画する`でcommit・scan・push・公開確認する。

## Task 5: runtime、Scene、HUD、telemetry統合

**Files:**
- Modify: `src/global.d.ts`
- Modify: `src/voxel-game/VoxelGameApp.tsx`
- Modify: `src/voxel-game/scene/VoxelGameScene.tsx`
- Modify: `src/voxel-game/scene/VehicleController.tsx`
- Modify: `src/voxel-game/ui/VoxelGameHud.tsx`
- Modify: `src/voxel-game/ui/hudLayout.ts`
- Modify: `src/voxel-game/styles.css`
- Modify: `src/test/voxelGameHud.test.tsx`
- Modify: `src/test/hudLayout.test.ts`

- [x] RED: colorEffect telemetry、manual clock、成功／拒否切替、HUD文言、4矩形安全条件を書く。
- [x] Scene clockで位置同期後にeffectを進め、manual `advanceTime`との二重進行を防ぐ。
- [x] App subscriptionをactivation／秒境界だけReactへ反映する。
- [x] active paint色をVehicleControllerへ渡し、成功した別車種切替だけclearする。
- [x] mission pill下へ`.color-effect-pill`をアンカーし、aria-liveを同期する。
- [x] focused/full unit、build、canonical nonbreak回帰を通す。
- [x] `色替え状態をゲーム本体へ統合する`でcommit・scan・push・公開確認する。

## Task 6: 3 viewport E2E、目視、性能、ドキュメント

**Files:**
- Create: `scripts/verify-voxel-game-colors.mjs`
- Modify: `docker-compose.yml`
- Modify: `README.md`
- Modify: `docs/design/2026-08-01-vehicle-color-play-design.md`
- Modify: `progress.md`（git管理外）

- [x] RED: actual UI／keyboard／touchで南地区へ走り、source未実装assertを確認する。
- [x] 3 viewportで赤pool、離脱、再接触、青上書き、期限、黄showerを完遂する。
- [x] rejected切替維持、帰庫後の成功切替clearを実DOMとtelemetryで確認する。
- [x] 色pillとmissionの10px、viewport 8px、操作阻害なしを数値assertする。
- [x] 6代表画像をoriginal detailで目視し、station、色車体、HUD、主要対象を確認する。
- [x] fresh full unit、build、canonical、二車種E2Eを通す。
- [x] physical Apple M4で消防車／ブルドーザーを各12秒計測し、目標とdraw callを記録する。
- [x] 72×72で性能達成ならchunk streaming／LOD不要を記録する。
- [x] READMEと要件台帳、受け入れ条件、非対象、リスク、性能目標、作業ログを同期する。
- [x] `色替え遊びを本番検証する`でcommit・全範囲scan・pushする。
- [x] Actions／Pages success、公開URLへの専用E2E、remote SHA 0/0を確認し、完了記録を追加pushする。

## Final checklist

- 受け入れ条件: 設計書の9項目をunit／E2E／目視／性能へ対応させる。
- 非対象: 色混合、保存、写実流体、評価、追加車両を実装しない。
- リスクと対策: contact edge、React更新、palette、切替、draw call、配置、HUDを検証する。
- 性能目標: station 78 cube／5 calls、vehicle 7 calls、median 55／p10 45を維持する。

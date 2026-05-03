# おもちゃレスキューコース Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** R3F + Rapier で、働くくるまを選んで積み木や色替えギミックで遊べる3DブラウザゲームMVPを作る。

**Architecture:** React DOMがHUDと車種選択を担当し、R3F Canvasが3Dプレイフィールドを担当する。物理挙動はRapier、車種・色効果・入力は小さなpure simulationモジュールに分けてテストする。

**Tech Stack:** React, TypeScript, Vite, @react-three/fiber, drei, @react-three/rapier, Vitest, Playwright client.

---

## ファイル構成

- `package.json`: npm scriptsと依存関係。
- `Dockerfile.dev`, `docker-compose.yml`: 開発環境をDocker内で実行する。
- `src/game/data/vehicles.ts`: 車種データ。
- `src/game/simulation/colorEffect.ts`: 一時色効果のpure logic。
- `src/game/input/actions.ts`: 入力状態の型と初期値。
- `src/scene/ToyRescueScene.tsx`: R3F/Rapierの3Dゲーム本体。
- `src/scene/VehicleModel.tsx`: 車種ごとのプリミティブモデル。
- `src/components/Hud.tsx`: 車種選択、色効果表示、操作ボタン。
- `src/App.tsx`: 状態管理とCanvas/HUD接続。
- `src/test/*.test.ts`: pure logicテスト。

## タスク

- [ ] 1. `package.json`、TypeScript、Vite、Docker設定を作る。
- [ ] 2. 車種データと色効果の失敗テストを作る。
- [ ] 3. 車種データと色効果の実装を追加し、テストを通す。
- [ ] 4. React/R3Fのアプリ骨格、HUD、3D床、カメラ、ライトを作る。
- [ ] 5. Rapierで車体、積み木、プール、シャワーを作る。
- [ ] 6. キーボード/タッチ操作、車種切り替え、色効果を接続する。
- [ ] 7. `render_game_to_text` と `advanceTime` を追加する。
- [ ] 8. Docker内で test/build を実行し、必要なら修正する。
- [ ] 9. Docker内でdev serverを起動し、Playwrightでdesktop/tablet/mobileを確認する。

# 玩具の音と振動 実装計画

**Design source:** `docs/design/2026-08-01-toy-audio-feedback-design.md`

**対象要件:** REQ-063〜REQ-071

## Task 1: pure mixとevent差分をTDDする

- [ ] `src/test/toyAudioMix.test.ts`で無効時、BGM、速度、全5車種action、非有限入力を先に失敗させる。
- [ ] `src/voxel-game/audio/toyAudioMix.ts`を最小実装する。
- [ ] `src/test/toyAudioEvents.test.ts`で乗り換え、対象完了、仕事完了、重複抑止、振動patternを先に失敗させる。
- [ ] `src/voxel-game/audio/toyAudioEvents.ts`を最小実装する。

## Task 2: 固定Web Audio graphとdirectorを実装する

- [ ] context生成をuser gestureまで遅延する。
- [ ] BGM、engine、action A/B、noiseの固定graphを構築する。
- [ ] pure frameを`setTargetAtTime`へ適用する。
- [ ] cueの短命node、suspend/resume/close、失敗時fallbackを実装する。
- [ ] fake backendによるdirector unit testを追加する。

## Task 3: React、HUD、telemetryへ接続する

- [ ] `useToyAudioFeedback`で既存refを1 RAFから読む。
- [ ] mission snapshot差分をcueと振動へ接続する。
- [ ] `VoxelGameHud`へ右上のaccessible toggleを追加する。
- [ ] `render_game_to_text()`へ音状態を追加する。
- [ ] HUD unit testとtelemetry testを更新する。

## Task 4: 専用E2Eと3 viewport visualを作る

- [ ] 初期off、toggle on/off、visibility、5車種action kind、走行gainを検証する。
- [ ] Desktop 1280×720、Tablet 1024×768、Mobile landscape 844×390を撮影する。
- [ ] sound／fullscreen／selector／mission／controlsのDOM矩形と安全余白を数値検証する。
- [ ] 3枚を目視し、重なり、はみ出し、主要オブジェクト阻害がないことを確認する。

## Task 5: Docker回帰と公開

- [ ] 変更関連unit、全unit、production build、bundle budgetをDocker内で実行する。
- [ ] production smokeと音専用E2EをDocker内のproduction previewで実行する。
- [ ] README、設計、計画、manifestへ実測結果を記録する。
- [ ] staged差分と`origin/main..HEAD`をsecret scanする。
- [ ] 日本語コミットを作成しmainへpushする。
- [ ] remote SHA、ahead/behind 0/0、GitHub Actions／Pages successを確認する。
- [ ] 公開URLで音専用E2E、root／compat／Vehicle Lab smoke、console cleanを確認する。
- [ ] 公開結果を別の日本語コミットで記録し、再push・再公開確認する。

## 検証コマンド方針

開発runtimeをホストへ入れないため、Node.jsを使うtest、build、preview、Playwrightはすべて既存Docker Compose service内で実行する。ホストでは`rg`、`git diff`、`git status`、成果物の目視だけを行う。

## 完了条件

- [ ] REQ-063〜REQ-071がunit、telemetry、E2E、実画面で対応する。
- [ ] 既存REQ-001〜REQ-062の回帰がない。
- [ ] 非対象を暗黙に実装・削除していない。
- [ ] 公開URLとremote mainが同じSHAを示す。

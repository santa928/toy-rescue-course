# 画面全体スワイプ運転 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画面の空いている任意位置から指を置き、スワイプした画面方向へ働く車を直接運転できる浮動スティックを追加する。

**Architecture:** 既存HUDの最背面へviewport全体のpointer surfaceを追加し、最初のpointer座標をその操作だけの原点としてrefへ保持する。既存の赤いレバーDOMを原点へ移動し、pureな正規化helperから既存`setTouchStick()`へ値を渡すため、screen-relative movement、Rapier、cameraは変更しない。

**Tech Stack:** React 19、TypeScript、Pointer Events、React Three Fiber、Rapier、Vitest、Playwright CDP、Docker Compose。

## Global Constraints

- Issue #2全体を1つの日本語論理commitにまとめ、検証後に`main`へ1回pushする。設計commit `9551ee0`は同じpushへ含める。
- pointer moveごとのReact state更新は0。ref、`DriveCommand` ref、DOM styleだけを更新する。
- 追加Three draw call、Rapier body／collider、asset fetchはすべて0。
- 既存14% dead zone、keyboard、固定レバー開始点、車種別主操作、multi-pointer主操作を維持する。
- 車両選択、全画面、音、主操作は運転surfaceより前面に置き、押下で運転を開始させない。
- pointerup、pointercancel、lostpointercapture、blur、hidden、unmountで必ず停止する。
- Docker内でunit test、build、E2Eを実行する。
- game entry 350kB、通常chunk 600kB、Three 750kB、Rapier 2.25MB以内。

---

### Task 1: Issue #2 画面全体スワイプ運転

**Files:**

- Modify: `src/voxel-game/ui/touchPointerMath.ts`
- Modify: `src/test/touchPointerMath.test.ts`
- Create: `src/voxel-game/ui/FullscreenDrivePad.tsx`
- Delete: `src/voxel-game/ui/TouchJoystick.tsx`
- Modify: `src/voxel-game/ui/VoxelGameHud.tsx`
- Modify: `src/voxel-game/styles.css`
- Modify: `src/test/voxelGameHud.test.tsx`
- Create: `scripts/verify-fullscreen-swipe-drive.mjs`
- Modify: `docker-compose.yml`
- Modify: `README.md`
- Modify: `docs/design/2026-08-02-fullscreen-swipe-drive-design.md`
- Modify: `docs/design/2026-08-02-fullscreen-swipe-drive-plan.md`

**Interfaces:**

- Consumes: `VoxelGameControls.setTouchStick(x: number, y: number): void`、`toDriveCommand(ControlState): DriveCommand`、`window.render_game_to_text()`、`.primary-action-button`。
- Produces: `resolveSwipePointer(origin: SwipeOrigin, clientX: number, clientY: number, maximumDistance: number): JoystickPointer`。
- Produces: `FullscreenDrivePad({ controls }: { readonly controls: VoxelGameControls }): ReactElement`。
- Preserves: `.touch-joystick`、`.touch-joystick__thumb`、`.touch-joystick__label` selector contract。
- Adds: `.touch-drive-surface` full-viewport pointer surface。

- [x] **Step 1: swipe正規化の失敗テストを書く**

`src/test/touchPointerMath.test.ts`へ原点、半径内、半径外、非有限入力を追加する。

```ts
expect(resolveSwipePointer({ x: 320, y: 240 }, 350, 200, 80))
  .toEqual({ x: 0.375, y: -0.5 });

const clamped = resolveSwipePointer({ x: 0, y: 0 }, 100, 100, 50);
expect(Math.hypot(clamped.x, clamped.y)).toBeCloseTo(1, 8);

expect(resolveSwipePointer({ x: Number.NaN, y: 0 }, 10, 10, 50))
  .toEqual({ x: 0, y: 0 });
```

- [x] **Step 2: REDを確認する**

Run:

```bash
docker compose run --rm web npm test -- src/test/touchPointerMath.test.ts
```

Expected: `resolveSwipePointer`がexportされていないためFAIL。

- [x] **Step 3: pure正規化helperを実装する**

`src/voxel-game/ui/touchPointerMath.ts`へ次を追加する。

```ts
export interface SwipeOrigin {
  readonly x: number;
  readonly y: number;
}

/** pointer開始点から現在点への差を円形の-1〜1入力へ正規化する。 */
export function resolveSwipePointer(
  origin: SwipeOrigin,
  clientX: number,
  clientY: number,
  maximumDistance: number,
): JoystickPointer {
  if (![origin.x, origin.y, clientX, clientY, maximumDistance].every(Number.isFinite)
    || maximumDistance <= 0) return { x: 0, y: 0 };
  const rawX = (clientX - origin.x) / maximumDistance;
  const rawY = (clientY - origin.y) / maximumDistance;
  const magnitude = Math.hypot(rawX, rawY);
  if (magnitude <= 1) return { x: rawX, y: rawY };
  return { x: rawX / magnitude, y: rawY / magnitude };
}
```

- [x] **Step 4: pure testをGREENにする**

Run:

```bash
docker compose run --rm web npm test -- src/test/touchPointerMath.test.ts src/test/voxelGameControls.test.ts
```

Expected: 全test成功。既存dead zoneとkeyboard fallbackも成功。

- [x] **Step 5: HUD契約の失敗テストを書く**

`src/test/voxelGameHud.test.tsx`の代表SSRへ次を追加する。

```ts
expect(html).toContain('class="touch-drive-surface"');
expect(html).toContain('aria-label="画面をスライドして運転"');
expect(html).toContain('class="touch-joystick__label">どこでも');
```

Run:

```bash
docker compose run --rm web npm test -- src/test/voxelGameHud.test.tsx
```

Expected: 全画面surfaceと新文言がないためFAIL。

- [x] **Step 6: 浮動drive padを実装する**

`FullscreenDrivePad.tsx`は`activePointerRef`、`originRef`、`surfaceRef`、`padRef`、`thumbRef`を持つ。pointer downでpadを原点へ移し、moveで`resolveSwipePointer()`とthumbを同期する。releaseは全ref、command、DOM inline styleを初期化する。

```tsx
<div
  className="touch-drive-surface"
  onLostPointerCapture={handleLostPointerCapture}
  onPointerCancel={handlePointerEnd}
  onPointerDown={handlePointerDown}
  onPointerMove={handlePointerMove}
  onPointerUp={handlePointerEnd}
  ref={surfaceRef}
>
  <div aria-label="画面をスライドして運転" className="touch-joystick" data-active="false" ref={padRef}>
    <span aria-hidden="true" className="touch-joystick__track" />
    <span aria-hidden="true" className="touch-joystick__thumb" ref={thumbRef} />
    <span aria-hidden="true" className="touch-joystick__label">どこでも</span>
  </div>
</div>
```

`VoxelGameHud.tsx`では`FullscreenDrivePad`をHUDの最初の子にし、古い`TouchJoystick`描画を削除する。

- [x] **Step 7: surfaceと浮動padのCSSを実装する**

`styles.css`へ最背面surfaceを追加し、active padだけpointer原点へ移動できるようinline `left/top/bottom/transform`を受ける。既存`.touch-joystick`の待機位置と安全余白は維持する。

```css
.touch-drive-surface {
  position: absolute;
  inset: 0;
  pointer-events: auto;
  touch-action: none;
  user-select: none;
}

.touch-joystick {
  pointer-events: auto;
}
```

- [x] **Step 8: componentとunit testをGREENにする**

Run:

```bash
docker compose run --rm web npm test -- \
  src/test/touchPointerMath.test.ts \
  src/test/voxelGameControls.test.ts \
  src/test/voxelGameHud.test.tsx \
  src/test/hudLayout.test.ts
```

Expected: 全test成功。

- [x] **Step 9: focused実touch E2Eを書く**

`scripts/verify-fullscreen-swipe-drive.mjs`はPlaywright ChromiumとCDP `Input.dispatchTouchEvent`を使い、Desktop touch 1280×720、Tablet 1024×768、Mobile landscape 844×390を確認する。

各viewportで次をassertする。

```js
assert.equal(document.elementFromPoint(origin.x, origin.y)?.closest('.touch-drive-surface') !== null, true);
assert(Math.abs(padCenter.x - origin.x) <= 1 && Math.abs(padCenter.y - origin.y) <= 1);
assert(command.moveX * expectedX > 0.7 || command.moveY * expectedY > 0.7);
assert(fixedCameraScreenDelta[0] * expectedX > 8 || fixedCameraScreenDelta[1] * expectedY > 8);
assert.deepEqual(released.controls, { moveX: 0, moveY: 0, primaryAction: false });
```

さらに音ボタン、車両選択、主操作の単独tapで`moveX/moveY`が0のまま、運転pointer＋主操作pointerの同時保持で移動と`primaryAction`が同時にtrueになることを確認する。3 viewportの待機・右drag・上drag画像を`output/voxel-game-swipe/`へ保存する。

`docker-compose.yml`へ`voxel-game-swipe-e2e` serviceを追加し、Docker内でproduction build／preview後にscriptを実行する。

- [x] **Step 10: E2E scriptの構文を確認する**

Run:

```bash
docker compose run --rm web node --check scripts/verify-fullscreen-swipe-drive.mjs
```

Expected: exit 0。

- [x] **Step 11: focused E2Eを実行して画像を目視する**

Run:

```bash
docker compose --profile e2e run --rm --build voxel-game-swipe-e2e
```

Expected: 3 viewportすべてで任意原点、上下左右、release、HUD button、同時主操作、browser error 0件が成功。生成画像を原寸で開き、浮動pad中心、thumb、主要車両、HUDの操作阻害がないことを確認する。

- [x] **Step 12: canonical touch回帰を実行する**

Run:

```bash
VOXEL_GAME_FOCUS=nonbreak docker compose --profile e2e run --rm --build voxel-game-focus-e2e
```

Expected: direct movement、touch mission、water timeline、3 viewport layoutが成功。

- [x] **Step 13: docsを実測値へ更新する**

`README.md`へ「画面の空いている場所をタッチして、そのまま進みたい方向へスワイプ」を追加する。設計書とこのplanを`実装・ローカル検証完了`へ更新し、unit数、bundle bytes、E2E結果、目視結果を記録する。

- [x] **Step 14: fresh full gateを通す**

Run:

```bash
docker compose run --rm web npm test
docker compose run --rm web npm run build
git diff --check
```

Expected: 全unit成功、TypeScript／Vite／postbuild budget成功、whitespace error 0件。

- [ ] **Step 15: security gate、commit、push、公開、Issue closeを行う**

`pre-push-security-check`に従い、ステージ済みと`origin/main..HEAD`全体を検査する。検出0件なら次の日本語commitを作る。

```bash
git commit -m '画面全体のスワイプ運転を追加する'
git push origin main
```

remote SHA一致、GitHub Actions/Pages成功、cache-busting公開URLで任意位置スワイプとerror 0件を確認する。commit、test、build、E2E、Actions、公開URLをIssue #2へコメントし、`completed`でcloseする。

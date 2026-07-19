# 純ボクセル消防車ゲームプレイ縦切り Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 独立した `voxel-game.html` に、純ボクセル消防車を運転し、前方へ放水して火を消し、指定積み木を壊して遊べる36×36相当の縦切り箱庭を作る。

**Architecture:** 旧ゲームは変更せず、`src/voxel-game/` にpure TypeScriptのruntime、入力、Rapier物理、R3Fシーン、React DOM HUDを分離して新設する。高頻度な車両状態はrefとRapierへ閉じ、ミッション、火、積み木の決定的な状態遷移は `VoxelGameRuntime` が固定stepで処理する。

**Tech Stack:** React 19、TypeScript 5.9、Vite 7、React Three Fiber 9、Three.js 0.181、Drei 10、React Three Rapier 2、Vitest 4、Playwright 1.59、Docker Compose。

## Global Constraints

- 開発サーバー、npm、npx、test、build、PlaywrightはすべてDockerコンテナ内で実行する。
- 旧 `index.html`、旧 `src/App.tsx`、旧 `src/scene/`、旧 `src/components/Hud.tsx` は本計画で削除・置換しない。
- 新規エントリは `voxel-game.html`、新規実装は `src/voxel-game/` に閉じる。
- 承認済み消防車は640ボクセル、色別7 draw callsを維持する。
- 車、道路、木、建物、火、水、道しるべ、破片を純ボクセル表現で統一し、角丸モデル、写実的な流体、煙、post-processingを追加しない。
- 箱庭は36×36相当の1区画。下側に車庫、中央に公園、右上に火災現場、左側に積み木広場、外周に周回道路を置く。
- カメラは世界方向固定の高い斜め視点で、車両位置だけを追従する。
- PCはWASD／矢印＋Space、タッチは左スティック＋右放水ボタンを使う。
- ゲームオーバー、制限時間、点数、通貨、解除、星評価は追加しない。
- Desktop 1280×720は物理GPUで60fps目標、tablet landscape 1024×768とmobile landscape 844×390は30fps以上を目標にする。
- UIはCanvas境界とsafe areaをアンカーにし、固定高さの推測配置を避ける。
- 新規または実質改修する関数、hook、class、moduleへ役割が分かるJSDocを付ける。
- `progress.md` は各タスク完了、失敗、検証結果のたびに追記するがgitへ追加しない。
- 実装中に旧コードを削除しない。新規方針採用後の削除は対象一覧を提示して別途承認を得る。

---

## File Structure

```text
voxel-game.html                                      # 新Voxel GameのVite entry
vite.config.ts                                       # 3つ目のHTML input
src/global.d.ts                                      # 検証hookとtelemetry型
src/vehicle-lab/scene/VoxelFireTruck.tsx             # group propsを受け取れる共有車両表示
src/voxel-game/domain/VoxelGameRuntime.ts             # mission/fire/breakableの決定的状態機械
src/voxel-game/domain/sprayTargeting.ts               # framework非依存の前方コーン照準
src/voxel-game/input/controlState.ts                  # keyboard/touchを共通commandへ変換
src/voxel-game/input/useVoxelGameControls.ts          # DOM入力eventと押下解除
src/voxel-game/scene/worldLayout.ts                   # 36×36配置定数
src/voxel-game/scene/VoxelWorld.tsx                   # 床、道路、公園、車庫、火災建物
src/voxel-game/scene/VehicleController.tsx            # Rapier車両制御、復帰、telemetry
src/voxel-game/scene/WorldFixedCamera.tsx             # 世界方向固定follow camera
src/voxel-game/scene/WaterAndFire.tsx                 # 水ボクセル、火の段階表示、自動照準
src/voxel-game/scene/BreakableBlockPlaza.tsx          # 破壊可能積み木とpool破片
src/voxel-game/scene/VoxelGameScene.tsx               # scene compositionとruntime接続
src/voxel-game/ui/TouchJoystick.tsx                   # pointer-based analog stick
src/voxel-game/ui/VoxelGameHud.tsx                    # mission、joystick、spray、fullscreen
src/voxel-game/VoxelGameApp.tsx                       # runtime、Canvas、HUD、公開hook
src/voxel-game/main.tsx                               # React mount
src/voxel-game/styles.css                             # safe-area anchored layout
src/test/voxelGameRuntime.test.ts                     # mission/fire/breakable unit tests
src/test/sprayTargeting.test.ts                       # range/cone tests
src/test/voxelGameControls.test.ts                    # input normalization tests
src/test/worldLayout.test.ts                          # bounds/anchor tests
scripts/verify-voxel-game.mjs                         # Docker Playwright E2E
docker-compose.yml                                    # voxel-game-e2e service
README.md                                             # URL、操作、検証方法
```

## Spec Coverage

| 要件 | 実装・検証Task |
| --- | --- |
| REQ-001、REQ-005、REQ-007、REQ-014、REQ-016、REQ-020 | Task 3、Task 4、Task 8 |
| REQ-002、REQ-013、REQ-018 | Task 1、Task 6、Task 8 |
| REQ-009、REQ-010、REQ-017、REQ-019 | Task 1、Task 5、Task 7、Task 8 |
| REQ-011、REQ-012、REQ-021、REQ-022 | Task 2、Task 4、Task 7、Task 8 |
| REQ-015 | Task 3で承認済み640ボクセルデータを再利用し、既存Vehicle Lab回帰をTask 8で検証する |
| REQ-023 | Task 8で旧実装非変更を検証する。旧実装削除はCompletion Gate後の別計画へ残す |
| REQ-003、REQ-004、REQ-006、REQ-008の乗り換え部分 | 本縦切りでは保留し、削除も代替実装もしない |

---

### Task 1: 決定的なゲーム状態機械

**Files:**
- Create: `src/voxel-game/domain/VoxelGameRuntime.ts`
- Create: `src/test/voxelGameRuntime.test.ts`
- Modify: `progress.md`

**Interfaces:**
- Consumes: なし。
- Produces: `MissionPhase`、`VoxelGameSnapshot`、`VoxelGameSignals`、`VoxelGameRuntime`。後続タスクは `setSignals()`、`registerBlockImpact()`、`advance()`、`resetMission()`、`getSnapshot()` だけを使う。

- [ ] **Step 1: mission、消火、破壊、復元の失敗テストを書く**

```ts
import { describe, expect, it } from 'vitest';
import { VoxelGameRuntime } from '../voxel-game/domain/VoxelGameRuntime';

describe('VoxelGameRuntime', () => {
  it('有効放水2500msで消火し、お礼演出後に自由走行へ移る', () => {
    const runtime = new VoxelGameRuntime(['plaza-red']);
    runtime.setSignals({ sprayActive: true, sprayOnFire: true });

    runtime.advance(2_500);
    expect(runtime.getSnapshot()).toMatchObject({ fireIntensity: 0, missionPhase: 'celebrating' });

    runtime.advance(1_800);
    expect(runtime.getSnapshot()).toMatchObject({ missionPhase: 'freeRoam', routeVisible: false });
  });

  it('火の範囲外へ放水しても強さを減らさない', () => {
    const runtime = new VoxelGameRuntime(['plaza-red']);
    runtime.setSignals({ sprayActive: true, sprayOnFire: false });
    runtime.advance(5_000);
    expect(runtime.getSnapshot().fireIntensity).toBe(1);
  });

  it('衝突速度4未満では壊さず、4以上で壊す', () => {
    const runtime = new VoxelGameRuntime(['plaza-red']);
    runtime.registerBlockImpact('plaza-red', 3.99);
    expect(runtime.getSnapshot().blocks[0]?.phase).toBe('intact');
    runtime.registerBlockImpact('plaza-red', 4);
    expect(runtime.getSnapshot().blocks[0]).toMatchObject({ phase: 'broken', respawnRemainingMs: 5_000 });
  });

  it('5秒後も車両が復元領域内なら待機し、離れたら復元する', () => {
    const runtime = new VoxelGameRuntime(['plaza-red']);
    runtime.registerBlockImpact('plaza-red', 7);
    runtime.setBlockClear('plaza-red', false);
    runtime.advance(5_000);
    expect(runtime.getSnapshot().blocks[0]?.phase).toBe('broken');
    runtime.setBlockClear('plaza-red', true);
    runtime.advance(16.67);
    expect(runtime.getSnapshot().blocks[0]?.phase).toBe('intact');
  });

  it('自由走行中に車庫へ戻ると仕事を初期化する', () => {
    const runtime = new VoxelGameRuntime(['plaza-red']);
    runtime.setSignals({ sprayActive: true, sprayOnFire: true });
    runtime.advance(2_500);
    runtime.advance(1_800);
    runtime.setSignals({ atGarage: true });
    runtime.advance(16.67);
    expect(runtime.getSnapshot()).toMatchObject({ fireIntensity: 1, missionPhase: 'assigned', routeVisible: true });
  });
});
```

- [ ] **Step 2: focused testをDocker内で実行しREDを確認する**

Run:

```bash
docker compose run --rm web npm test -- src/test/voxelGameRuntime.test.ts
```

Expected: FAIL with `Failed to resolve import "../voxel-game/domain/VoxelGameRuntime"`。

- [ ] **Step 3: runtimeを最小実装する**

```ts
export type MissionPhase = 'assigned' | 'active' | 'celebrating' | 'freeRoam';
export type BreakablePhase = 'intact' | 'broken';

export interface VoxelGameSignals {
  readonly atGarage: boolean;
  readonly sprayActive: boolean;
  readonly sprayOnFire: boolean;
}

export interface BreakableSnapshot {
  readonly id: string;
  readonly phase: BreakablePhase;
  readonly respawnRemainingMs: number;
}

export interface VoxelGameSnapshot {
  readonly blocks: readonly BreakableSnapshot[];
  readonly celebrationRemainingMs: number;
  readonly elapsedMs: number;
  readonly fireIntensity: number;
  readonly missionPhase: MissionPhase;
  readonly routeVisible: boolean;
  readonly signals: VoxelGameSignals;
}

interface MutableBreakableState {
  clear: boolean;
  id: string;
  phase: BreakablePhase;
  respawnRemainingMs: number;
}

const EXTINGUISH_DURATION_MS = 2_500;
const CELEBRATION_DURATION_MS = 1_800;
const RESPAWN_DURATION_MS = 5_000;
const BREAK_IMPACT_THRESHOLD = 4;

/** 消火ミッションと壊せる積み木を固定stepで進めるframework非依存runtime。 */
export class VoxelGameRuntime {
  private blocks: MutableBreakableState[];
  private celebrationRemainingMs = 0;
  private elapsedMs = 0;
  private fireIntensity = 1;
  private missionPhase: MissionPhase = 'assigned';
  private signals: VoxelGameSignals = { atGarage: false, sprayActive: false, sprayOnFire: false };

  public constructor(blockIds: readonly string[]) {
    this.blocks = blockIds.map((id) => ({ clear: true, id, phase: 'intact', respawnRemainingMs: 0 }));
  }

  /** 入力・空間判定から得た現在signalを部分更新する。 */
  public setSignals(signals: Partial<VoxelGameSignals>): void {
    this.signals = { ...this.signals, ...signals };
  }

  /** 指定blockの復元領域から車両が離れているか更新する。 */
  public setBlockClear(id: string, clear: boolean): void {
    const block = this.blocks.find((entry) => entry.id === id);
    if (block) block.clear = clear;
  }

  /** 有効衝突を受けた指定blockを破壊状態へ移す。 */
  public registerBlockImpact(id: string, impactSpeed: number): void {
    const block = this.blocks.find((entry) => entry.id === id);
    if (!block || block.phase === 'broken' || impactSpeed < BREAK_IMPACT_THRESHOLD) return;
    block.phase = 'broken';
    block.respawnRemainingMs = RESPAWN_DURATION_MS;
  }

  /** runtimeを指定ミリ秒だけ決定的に進める。 */
  public advance(milliseconds: number): void {
    const deltaMs = Math.max(0, milliseconds);
    let extinguishedThisStep = false;
    this.elapsedMs += deltaMs;

    if ((this.missionPhase === 'assigned' || this.missionPhase === 'active') && this.signals.sprayActive) {
      this.missionPhase = 'active';
      if (this.signals.sprayOnFire) {
        this.fireIntensity = Math.max(0, this.fireIntensity - deltaMs / EXTINGUISH_DURATION_MS);
        if (this.fireIntensity === 0) {
          this.missionPhase = 'celebrating';
          this.celebrationRemainingMs = CELEBRATION_DURATION_MS;
          extinguishedThisStep = true;
        }
      }
    }

    if (this.missionPhase === 'celebrating' && !extinguishedThisStep) {
      this.celebrationRemainingMs = Math.max(0, this.celebrationRemainingMs - deltaMs);
      if (this.celebrationRemainingMs === 0) this.missionPhase = 'freeRoam';
    } else if (this.missionPhase === 'freeRoam' && this.signals.atGarage) {
      this.resetMission();
    }

    for (const block of this.blocks) {
      if (block.phase !== 'broken') continue;
      block.respawnRemainingMs = Math.max(0, block.respawnRemainingMs - deltaMs);
      if (block.respawnRemainingMs === 0 && block.clear) block.phase = 'intact';
    }
  }

  /** 消火仕事だけを初期状態へ戻す。 */
  public resetMission(): void {
    this.fireIntensity = 1;
    this.missionPhase = 'assigned';
    this.celebrationRemainingMs = 0;
    this.signals = { ...this.signals, atGarage: false, sprayOnFire: false };
  }

  /** 外部へ変更不能な現在snapshotを返す。 */
  public getSnapshot(): VoxelGameSnapshot {
    return {
      blocks: this.blocks.map(({ id, phase, respawnRemainingMs }) => ({ id, phase, respawnRemainingMs })),
      celebrationRemainingMs: this.celebrationRemainingMs,
      elapsedMs: this.elapsedMs,
      fireIntensity: this.fireIntensity,
      missionPhase: this.missionPhase,
      routeVisible: this.missionPhase === 'assigned' || this.missionPhase === 'active',
      signals: { ...this.signals },
    };
  }
}
```

- [ ] **Step 4: focused testと既存testをDocker内でGREEN確認する**

Run:

```bash
docker compose run --rm web npm test -- src/test/voxelGameRuntime.test.ts
docker compose run --rm web npm test
```

Expected: 新規5件と既存15件を含む全test PASS。

- [ ] **Step 5: progressへ結果を追記してコミットする**

```bash
git add src/voxel-game/domain/VoxelGameRuntime.ts src/test/voxelGameRuntime.test.ts
git commit -m "消防車ミッションの状態機械を追加"
```

---

### Task 2: 共通入力と前方放水照準

**Files:**
- Create: `src/voxel-game/input/controlState.ts`
- Create: `src/voxel-game/input/useVoxelGameControls.ts`
- Create: `src/voxel-game/domain/sprayTargeting.ts`
- Create: `src/test/voxelGameControls.test.ts`
- Create: `src/test/sprayTargeting.test.ts`
- Modify: `progress.md`

**Interfaces:**
- Consumes: なし。
- Produces: `ControlState`、`DriveCommand`、`createControlState()`、`setDigitalAction()`、`setTouchStick()`、`toDriveCommand()`、`useVoxelGameControls()`、`resolveSprayTarget()`。

- [ ] **Step 1: 入力正規化と照準の失敗テストを書く**

```ts
import { describe, expect, it } from 'vitest';
import { createControlState, setDigitalAction, setTouchStick, toDriveCommand } from '../voxel-game/input/controlState';

describe('voxel game controls', () => {
  it('前後と左右を-1から1へ正規化する', () => {
    let state = createControlState();
    state = setDigitalAction(state, 'forward', true);
    state = setDigitalAction(state, 'left', true);
    expect(toDriveCommand(state)).toEqual({ spray: false, steer: -1, throttle: 1 });
  });

  it('touch stickをkeyboardより優先し、dead zone内を0にする', () => {
    const state = setTouchStick(createControlState(), 0.8, -0.6);
    expect(toDriveCommand(state)).toEqual({ spray: false, steer: 0.8, throttle: 0.6 });
    expect(toDriveCommand(setTouchStick(state, 0.05, 0.05))).toEqual({ spray: false, steer: 0, throttle: 0 });
  });
});
```

```ts
import { describe, expect, it } from 'vitest';
import { resolveSprayTarget } from '../voxel-game/domain/sprayTargeting';

describe('resolveSprayTarget', () => {
  it('前方かつ6unit以内の火だけをtargetにする', () => {
    expect(resolveSprayTarget([0, 1, 0], [0, 0, -1], [0.8, 1, -4])).toMatchObject({ targeted: true });
    expect(resolveSprayTarget([0, 1, 0], [0, 0, -1], [0, 1, 4])).toMatchObject({ targeted: false });
    expect(resolveSprayTarget([0, 1, 0], [0, 0, -1], [0, 1, -6.01])).toMatchObject({ targeted: false });
  });
});
```

- [ ] **Step 2: Docker focused testでREDを確認する**

Run:

```bash
docker compose run --rm web npm test -- src/test/voxelGameControls.test.ts src/test/sprayTargeting.test.ts
```

Expected: 2つのmoduleが未作成のためFAIL。

- [ ] **Step 3: pure input stateと照準を実装する**

```ts
export type DigitalAction = 'forward' | 'backward' | 'left' | 'right' | 'spray';

export interface ControlState {
  readonly digital: Readonly<Record<DigitalAction, boolean>>;
  readonly touchStick: readonly [number, number] | null;
}

export interface DriveCommand {
  readonly spray: boolean;
  readonly steer: number;
  readonly throttle: number;
}

/** 全操作を離した初期状態を返す。 */
export function createControlState(): ControlState {
  return { digital: { backward: false, forward: false, left: false, right: false, spray: false }, touchStick: null };
}

/** keyboardまたはbuttonのdigital actionを不変更新する。 */
export function setDigitalAction(state: ControlState, action: DigitalAction, pressed: boolean): ControlState {
  return { ...state, digital: { ...state.digital, [action]: pressed } };
}

/** touch stickを-1から1へclampし、dead zone内なら中央へ戻す。 */
export function setTouchStick(state: ControlState, x: number, y: number): ControlState {
  const clampedX = Math.max(-1, Math.min(1, x));
  const clampedY = Math.max(-1, Math.min(1, y));
  return { ...state, touchStick: Math.hypot(clampedX, clampedY) < 0.14 ? [0, 0] : [clampedX, clampedY] };
}

/** device固有状態を車両が読む共通commandへ変換する。 */
export function toDriveCommand(state: ControlState): DriveCommand {
  const digitalSteer = Number(state.digital.right) - Number(state.digital.left);
  const digitalThrottle = Number(state.digital.forward) - Number(state.digital.backward);
  return {
    spray: state.digital.spray,
    steer: state.touchStick?.[0] ?? digitalSteer,
    throttle: state.touchStick ? -state.touchStick[1] : digitalThrottle,
  };
}
```

```ts
export interface SprayTargetResult {
  readonly direction: readonly [number, number, number];
  readonly distance: number;
  readonly targeted: boolean;
}

/** 前方6unit、約48度以内の火へだけ放水方向を35%補正する。 */
export function resolveSprayTarget(
  origin: readonly [number, number, number],
  forward: readonly [number, number, number],
  target: readonly [number, number, number],
): SprayTargetResult {
  const delta = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]] as const;
  const distance = Math.hypot(...delta);
  const normalizedTarget = distance > 0 ? delta.map((value) => value / distance) as [number, number, number] : [0, 0, 0];
  const dot = forward[0] * normalizedTarget[0] + forward[1] * normalizedTarget[1] + forward[2] * normalizedTarget[2];
  const targeted = distance <= 6 && dot >= 0.67;
  if (!targeted) return { direction: forward, distance, targeted };
  const mixed = forward.map((value, index) => value * 0.65 + normalizedTarget[index]! * 0.35) as [number, number, number];
  const length = Math.hypot(...mixed) || 1;
  return { direction: mixed.map((value) => value / length) as [number, number, number], distance, targeted };
}
```

- [ ] **Step 4: DOM hookを実装する**

`useVoxelGameControls()` は `ControlState` をstateではなくrefへ保持し、`keydown` / `keyup`、`blur`、`visibilitychange`を登録する。W/ArrowUp=`forward`、S/ArrowDown=`backward`、A/ArrowLeft=`left`、D/ArrowRight=`right`、Space=`spray`。公開値は `commandRef`、`setTouchStick(x,y)`、`setSpray(pressed)`、`reset()` とする。cleanup時はlistenerを外し、全入力を解除する。

```ts
export interface VoxelGameControls {
  readonly commandRef: React.RefObject<DriveCommand>;
  readonly reset: () => void;
  readonly setSpray: (pressed: boolean) => void;
  readonly setTouchStick: (x: number, y: number) => void;
}

export function useVoxelGameControls(): VoxelGameControls;
```

- [ ] **Step 5: testとbuildをDocker内でGREEN確認する**

```bash
docker compose run --rm web npm test -- src/test/voxelGameControls.test.ts src/test/sprayTargeting.test.ts
docker compose run --rm web npm run build
```

Expected: focused tests PASS、既存2 HTML build SUCCESS。

- [ ] **Step 6: progressへ追記してコミットする**

```bash
git add src/voxel-game/input src/voxel-game/domain/sprayTargeting.ts src/test/voxelGameControls.test.ts src/test/sprayTargeting.test.ts
git commit -m "消防車の共通入力と放水照準を追加"
```

---

### Task 3: 独立entryと純ボクセル箱庭

**Files:**
- Create: `voxel-game.html`
- Create: `src/voxel-game/main.tsx`
- Create: `src/voxel-game/VoxelGameApp.tsx`
- Create: `src/voxel-game/styles.css`
- Create: `src/voxel-game/scene/worldLayout.ts`
- Create: `src/voxel-game/scene/VoxelWorld.tsx`
- Create: `src/voxel-game/scene/VoxelGameScene.tsx`
- Create: `src/test/worldLayout.test.ts`
- Create: `scripts/verify-voxel-game.mjs`
- Modify: `vite.config.ts`
- Modify: `src/vehicle-lab/scene/VoxelFireTruck.tsx`
- Modify: `progress.md`

**Interfaces:**
- Consumes: `VoxelFireTruck`、`VoxelGameRuntime`、`VoxelGameControls`。
- Produces: `WORLD_BOUNDS`、`GARAGE_POSITION`、`FIRE_POSITION`、`BREAKABLE_BLOCKS`、`VoxelWorld`、3つ目のVite entry。

- [ ] **Step 1: layout contractの失敗テストを書く**

```ts
import { describe, expect, it } from 'vitest';
import { BREAKABLE_BLOCKS, FIRE_POSITION, GARAGE_POSITION, WORLD_BOUNDS } from '../voxel-game/scene/worldLayout';

describe('voxel world layout', () => {
  it('36×36相当の境界内へ主要地点を置く', () => {
    expect(WORLD_BOUNDS).toEqual({ maxX: 18, maxZ: 18, minX: -18, minZ: -18 });
    for (const [x, , z] of [GARAGE_POSITION, FIRE_POSITION, ...BREAKABLE_BLOCKS.map((block) => block.position)]) {
      expect(x).toBeGreaterThanOrEqual(WORLD_BOUNDS.minX);
      expect(x).toBeLessThanOrEqual(WORLD_BOUNDS.maxX);
      expect(z).toBeGreaterThanOrEqual(WORLD_BOUNDS.minZ);
      expect(z).toBeLessThanOrEqual(WORLD_BOUNDS.maxZ);
    }
  });

  it('壊せる積み木IDを重複させない', () => {
    expect(new Set(BREAKABLE_BLOCKS.map((block) => block.id)).size).toBe(BREAKABLE_BLOCKS.length);
  });
});
```

- [ ] **Step 2: focused REDを確認する**

```bash
docker compose run --rm web npm test -- src/test/worldLayout.test.ts
```

Expected: `worldLayout` module missingでFAIL。

- [ ] **Step 3: 配置定数を実装する**

```ts
export const WORLD_BOUNDS = { maxX: 18, maxZ: 18, minX: -18, minZ: -18 } as const;
export const GARAGE_POSITION = [0, 0.8, 14] as const;
export const FIRE_POSITION = [12, 1.2, -11] as const;
export const PARK_CENTER = [0, 0, 0] as const;
export const BREAKABLE_BLOCKS = [
  { color: '#ef4444', id: 'plaza-red', position: [-13, 0.75, 0] as const },
  { color: '#facc15', id: 'plaza-yellow', position: [-11.5, 0.75, -1.5] as const },
  { color: '#3b82f6', id: 'plaza-blue', position: [-12, 0.75, 1.6] as const },
  { color: '#65a30d', id: 'plaza-green', position: [-10.2, 0.75, 0.7] as const },
] as const;
```

- [ ] **Step 4: Vehicle Labを壊さず消防車group propsを受け取れるようにする**

```tsx
import type { ThreeElements } from '@react-three/fiber';

type VoxelFireTruckProps = ThreeElements['group'];

/** 純ボクセル消防車を色別instanceバッチで描画する。 */
export function VoxelFireTruck(props: VoxelFireTruckProps): ReactElement {
  assertValidVoxelModel(FIRE_TRUCK_VOXELS, FIRE_TRUCK_PALETTE_IDS);
  return (
    <group {...props}>
      <group position={FIRE_TRUCK_RENDER_PLAN.offset}>
        {FIRE_TRUCK_RENDER_PLAN.batches.map((batch) => <VoxelBatch batch={batch} key={batch.paletteId} />)}
      </group>
    </group>
  );
}
```

- [ ] **Step 5: 3つ目のVite entryを追加する**

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#d7b07a" />
    <title>純ボクセル消防車 | Voxel Game</title>
  </head>
  <body><div id="root"></div><script type="module" src="/src/voxel-game/main.tsx"></script></body>
</html>
```

`vite.config.ts` のinputへ次を追加する。

```ts
voxelGame: resolve(process.cwd(), 'voxel-game.html'),
```

- [ ] **Step 6: static worldとApp shellを作る**

`VoxelWorld.tsx` は以下を立方体meshで構成する。

- 36×36の木製床。
- 幅4の外周周回道路4辺と黄色い中央線。
- 中央12×8の公園、池、木3本、遊具1つ。
- 下側の白赤車庫。
- 右上の木製火災建物。
- 左側の積み木広場床。

すべて `boxGeometry` と `meshLambertMaterial` を使い、道路・公園の反復物は `InstancedMesh` へまとめる。`VoxelGameScene` はambient light、2方向light、OrthographicCamera、`Physics gravity={[0,-18,0]}`、static `VoxelFireTruck`、`VoxelWorld` を構成する。

`VoxelGameApp` は次のshellを返す。

```tsx
<main className="voxel-game-shell">
  <section className="voxel-game-canvas" aria-label="純ボクセル消防車の箱庭">
    <Canvas dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: 'high-performance' }}>
      <VoxelGameScene />
    </Canvas>
  </section>
</main>
```

- [ ] **Step 7: testと3 entry buildをDocker内で確認する**

```bash
docker compose run --rm web npm test -- src/test/worldLayout.test.ts src/test/fireTruckVoxels.test.ts src/test/voxelRenderPlan.test.ts
docker compose run --rm web npm run build
```

Expected: focused tests PASS、`dist/index.html`、`dist/vehicle-lab.html`、`dist/voxel-game.html`を生成。

- [ ] **Step 8: Docker serverとweb-game clientでstatic画面を確認する**

`scripts/verify-voxel-game.mjs` を次のsmoke clientとして作る。Task 8ではこの成功済みsmokeを残したまま、操作・性能・artifact lifecycleの検証を追加する。

```js
import fs from 'node:fs';
import { chromium } from 'playwright';

const baseUrl = process.env.VOXEL_GAME_BASE_URL ?? 'http://127.0.0.1:5173';
const outputDirectory = 'output/voxel-game';
fs.mkdirSync(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { height: 720, width: 1280 } });
const errors = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', (error) => errors.push(String(error)));

try {
  await page.goto(`${baseUrl}/voxel-game.html?verify=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.locator('.voxel-game-canvas canvas').waitFor({ state: 'visible' });
  await page.screenshot({ path: `${outputDirectory}/static-desktop.png` });
  if (errors.length > 0) throw new Error(`Voxel Game browser errors: ${errors.join(' | ')}`);
} finally {
  await browser.close();
}
```

```bash
docker compose up --build -d web
docker compose --profile e2e run --rm --build -e VOXEL_GAME_BASE_URL=http://web:5173 --entrypoint sh e2e -lc "node scripts/verify-voxel-game.mjs --smoke-static"
```

Expected: `voxel-game.html` が開き、console error 0、`output/voxel-game/static-desktop.png` が生成される。

- [ ] **Step 9: screenshotを実際に目視し、世界観辞書との差を修正する**

`output/voxel-game/static-desktop.png` を `view_image` で開き、消防車、木製床、周回道路、公園、車庫、火災建物、積み木広場が欠けずに読めることを確認する。

- [ ] **Step 10: progressへ追記してコミットする**

```bash
git add voxel-game.html vite.config.ts src/vehicle-lab/scene/VoxelFireTruck.tsx src/voxel-game src/test/worldLayout.test.ts scripts/verify-voxel-game.mjs
git commit -m "純ボクセル消防車の箱庭エントリを追加"
```

---

### Task 4: Rapier車両制御と世界方向固定カメラ

**Files:**
- Create: `src/voxel-game/scene/VehicleController.tsx`
- Create: `src/voxel-game/scene/WorldFixedCamera.tsx`
- Modify: `src/voxel-game/scene/VoxelGameScene.tsx`
- Modify: `src/voxel-game/VoxelGameApp.tsx`
- Modify: `src/global.d.ts`
- Modify: `progress.md`

**Interfaces:**
- Consumes: `DriveCommand` ref、`GARAGE_POSITION`、`WORLD_BOUNDS`、`VoxelFireTruck`。
- Produces: `VehicleTelemetryRef`、`VehicleController`、`WorldFixedCamera`、`resetVehicle()`、車両情報を含む初期`render_game_to_text()`、`reset_voxel_game_vehicle()`。

- [ ] **Step 1: 車両telemetry interfaceを定義する**

```ts
export interface VehicleTelemetry {
  readonly forward: readonly [number, number, number];
  readonly position: readonly [number, number, number];
  readonly resetCount: number;
  readonly speed: number;
}

export type VehicleTelemetryRef = React.MutableRefObject<VehicleTelemetry>;
```

- [ ] **Step 2: Rapier車両controllerを実装する**

`RigidBody` は `mass={1.4}`、`enabledRotations={[false,true,false]}`、`linearDamping={2.2}`、`angularDamping={5}` を使う。視覚モデルを子にし、`CuboidCollider args={[1.45,0.95,1.7]}` を1つ使う。

毎frame、現在yawから前方vectorを作り、`throttle * 7.4` を目標速度、`steer * 1.9 * clamp(abs(speed)/2.5,0.35,1)` を目標yaw角速度にする。`setLinvel` と `setAngvel` はwake up付きで呼ぶ。`y < -2` またはX/Zが境界から2unit外へ出た場合、車庫位置へtranslation/rotation/velocityをresetする。

```tsx
<RigidBody ref={bodyRef} colliders={false} enabledRotations={[false, true, false]} mass={1.4} position={GARAGE_POSITION}>
  <CuboidCollider args={[1.45, 0.95, 1.7]} position={[0, 0.95, 0]} />
  <group rotation={[0, Math.PI, 0]}><VoxelFireTruck /></group>
</RigidBody>
```

- [ ] **Step 3: 世界方向固定follow cameraを実装する**

OrthographicCameraの目標positionを `vehicle.position + [10, 12, 12]`、look targetを `vehicle.position + [0, 0.8, -1.5]` にし、deltaに依存しないexponential dampingで追従する。camera yawは車両yawを参照しない。landscapeのaspectに応じzoomを56〜72の範囲で更新する。

- [ ] **Step 4: 入力hook、controller、cameraをsceneへ接続する**

`VoxelGameApp` が `useVoxelGameControls()` を生成し、`commandRef` を `VoxelGameScene` へ渡す。static消防車は削除し、`VehicleController`へ置換する。HUDはまだ作らず、PC keyboardだけで走れる状態にする。

- [ ] **Step 5: 車両検証hookを段階的に公開する**

`src/global.d.ts` へ `render_game_to_text?: () => string` と `reset_voxel_game_vehicle?: () => void` を追加する。`VoxelGameApp` は座標系、現在のruntime snapshot、`VehicleTelemetry`をJSON化し、reset要求をcontrollerへ渡す。Task 5で火とmanual clock、Task 6で積み木、Task 7でcontrolsと最終型を追加するため、後続Taskは同じhook名を上書きせずpayloadだけを拡張する。

- [ ] **Step 6: Docker内test/buildを実行する**

```bash
docker compose run --rm web npm test
docker compose run --rm web npm run build
```

Expected: 全test PASS、3 HTML build SUCCESS。

- [ ] **Step 7: short input burstで前進、旋回、停止、境界復帰を確認する**

Playwrightで `voxel-game.html?verify=<timestamp>` を開き、Wを30frame、Aを18frame、無入力30frameの順に送る。各burst後に `render_game_to_text()` の `vehicle.position`、`forward`、`speed`を読み、前進で位置変化、旋回でforward変化、無入力で減速を確認する。境界外へ移すtest APIは追加せず、E2E専用の `window.reset_voxel_game_vehicle()` で車庫resetと`resetCount`増加を確認する。

- [ ] **Step 8: desktopとmobile landscape screenshotを目視する**

消防車が欠けず、進行方向の道路が見え、カメラが車両yawで回転しないことを2枚以上の画像で確認する。

- [ ] **Step 9: progressへ追記してコミットする**

```bash
git add src/voxel-game/scene/VehicleController.tsx src/voxel-game/scene/WorldFixedCamera.tsx src/voxel-game/scene/VoxelGameScene.tsx src/voxel-game/VoxelGameApp.tsx
git commit -m "純ボクセル消防車の運転と追従カメラを追加"
```

---

### Task 5: 放水、自動追尾、火、ミッション進行

**Files:**
- Create: `src/voxel-game/scene/WaterAndFire.tsx`
- Modify: `src/voxel-game/scene/VoxelGameScene.tsx`
- Modify: `src/voxel-game/VoxelGameApp.tsx`
- Modify: `src/voxel-game/domain/VoxelGameRuntime.ts`
- Modify: `src/global.d.ts`
- Modify: `progress.md`

**Interfaces:**
- Consumes: `resolveSprayTarget()`、`VoxelGameRuntime`、`VehicleTelemetryRef`、`FIRE_POSITION`、`DriveCommand.spray`。
- Produces: `WaterAndFire`、`MissionTelemetry`、fire intensityの3段階表示、`window.advanceTime()`。

- [ ] **Step 1: runtimeへ火の強さ変化通知を購読する軽量snapshot APIを追加する**

`VoxelGameRuntime` へ `subscribe(listener): () => void` を追加する。`advance()` の結果で `missionPhase`、`fireIntensity`、block phaseのいずれかが前回snapshotから変わったときだけlistenerを呼ぶ。毎frameのReact state更新を避ける。

- [ ] **Step 2: 水と火を純ボクセルで実装する**

`WaterAndFire` は次を行う。

- 火: intensity `>0.66` は大中小3層、`>0.33` は中小2層、`>0` は小1層、`0` は非表示。
- 水: spray中だけ最大18個の水色／白のcubeを前方へ並べる。同色ごとにInstancedMeshを使う。
- 照準: nozzle origin、vehicle forward、`FIRE_POSITION` を `resolveSprayTarget()` へ渡す。
- 判定: `targeted && command.spray` の間だけ `runtime.setSignals({sprayActive:true,sprayOnFire:true})`。
- 表示: targeted時もdirection補正は35%以内に限定する。

- [ ] **Step 3: 黄色い道しるべと成功演出を追加する**

`routeVisible` の間だけ車庫から右回り道路上へ12個の黄色いcubeを表示する。`celebrating` の間だけ火災現場上空へ黄色／白の星形に見える5-cube組を6個表示し、DOM HUDには「できた！」を出す。`freeRoam` で両方を消す。

- [ ] **Step 4: frame clockをruntimeへ接続する**

通常描画中は `useFrame((_, delta) => runtime.advance(Math.min(delta, 0.05) * 1000))` を使う。`window.advanceTime(milliseconds)` は60Hz固定stepへ分割してruntimeを進め、manual clock flagを1frameだけ立てて通常clockとの二重加算を防ぐ。`src/global.d.ts` へ同hook型を追加する。

- [ ] **Step 5: Docker unit/buildを実行する**

```bash
docker compose run --rm web npm test -- src/test/voxelGameRuntime.test.ts src/test/sprayTargeting.test.ts
docker compose run --rm web npm run build
```

Expected: missionとtargeting test PASS、3 HTML build SUCCESS。

- [ ] **Step 6: 消火chainをE2Eで確認する**

車両を火災現場前へ走らせ、Spaceを押した状態で `advanceTime(2500)` を呼ぶ。`fireIntensity:1 → 0`、`missionPhase:assigned/active → celebrating → freeRoam`、route消失、「できた！」表示と消失を順番に確認する。火の背後または6.01unit外では強さが変わらないscenarioも別pageで確認する。

- [ ] **Step 7: 火3段階、放水、成功演出のscreenshotを目視する**

少なくとも `fire-full.png`、`fire-medium-water.png`、`mission-complete.png` を開き、火、水、星が純ボクセル表現で消防車と同じ語彙に見えることを確認する。

- [ ] **Step 8: progressへ追記してコミットする**

```bash
git add src/voxel-game/domain/VoxelGameRuntime.ts src/voxel-game/scene/WaterAndFire.tsx src/voxel-game/scene/VoxelGameScene.tsx src/voxel-game/VoxelGameApp.tsx
git commit -m "消防車の放水と消火ミッションを追加"
```

---

### Task 6: 壊せる積み木とpool破片

**Files:**
- Create: `src/voxel-game/scene/BreakableBlockPlaza.tsx`
- Modify: `src/voxel-game/scene/VoxelGameScene.tsx`
- Modify: `src/voxel-game/domain/VoxelGameRuntime.ts`
- Modify: `progress.md`

**Interfaces:**
- Consumes: `BREAKABLE_BLOCKS`、`registerBlockImpact()`、`setBlockClear()`、runtime snapshot、`VehicleTelemetryRef`。
- Produces: 最大24個の再利用可能な破片、4つの壊せる積み木。

- [ ] **Step 1: 積み木colliderと衝突判定を実装する**

各積み木はintact中だけ `RigidBody type="fixed" colliders={false}` と `CuboidCollider args={[0.75,0.75,0.75]}` を持つ。`onCollisionEnter` の相対速度絶対値を取得し、`runtime.registerBlockImpact(id, speed)` へ渡す。4未満は状態を変えない。

- [ ] **Step 2: pool破片を実装する**

4ブロック×6片の24slotを初期化し、新しいmeshを破壊ごとに作らない。壊れたblockの6slotをdynamic Rapier bodyとして表示し、決定的な6方向の初速度を与える。1.2秒後に非表示、sleep、衝突無効化し、runtimeの5秒復元を待つ。

- [ ] **Step 3: 安全復元判定を接続する**

各block中心と車両positionのXZ距離が3unitを超えるときだけ `setBlockClear(id,true)`、それ以外はfalseにする。runtimeがintactへ戻ったら元blockを再表示し、破片slotはすべて非表示のままにする。

- [ ] **Step 4: Docker unit/buildを実行する**

```bash
docker compose run --rm web npm test -- src/test/voxelGameRuntime.test.ts src/test/worldLayout.test.ts
docker compose run --rm web npm run build
```

Expected: 衝突閾値と復元条件のunit test PASS、build SUCCESS。

- [ ] **Step 5: 破壊から復元までのmulti-step chainをE2E確認する**

有効速度で赤blockへ衝突し、`intact → broken`、破片表示、1.2秒後の破片非表示、5秒後も車両が近いとbroken維持、車両が離れた後のintact復元を順番に検証する。無効速度scenarioではintact維持を確認する。

- [ ] **Step 6: 破壊直後と復元後の画像を目視する**

`block-broken.png` で6片が積み木広場内に見え、`block-restored.png` で重複blockや残留破片がないことを確認する。

- [ ] **Step 7: progressへ追記してコミットする**

```bash
git add src/voxel-game/scene/BreakableBlockPlaza.tsx src/voxel-game/scene/VoxelGameScene.tsx src/voxel-game/domain/VoxelGameRuntime.ts
git commit -m "箱庭に壊れて戻る積み木を追加"
```

---

### Task 7: タッチHUD、telemetry、決定的clock、fullscreen

**Files:**
- Create: `src/voxel-game/ui/TouchJoystick.tsx`
- Create: `src/voxel-game/ui/VoxelGameHud.tsx`
- Modify: `src/voxel-game/VoxelGameApp.tsx`
- Modify: `src/voxel-game/styles.css`
- Modify: `src/global.d.ts`
- Modify: `progress.md`

**Interfaces:**
- Consumes: `VoxelGameControls`、runtime snapshot、`VehicleTelemetryRef`。
- Produces: 完成版`render_game_to_text()` payload、既存`advanceTime()`／`reset_voxel_game_vehicle()`の型整合、touch controls、fullscreen button。

- [ ] **Step 1: HUD componentを実装する**

`VoxelGameHud` は上中央にmission iconと短い文言、左下に`TouchJoystick`、右下に水滴アイコンの放水button、右上にfullscreen buttonを置く。文言は次の固定対応にする。

```ts
const MISSION_LABELS = {
  assigned: '火のところへいこう',
  active: 'おみずをかけよう',
  celebrating: 'できた！',
  freeRoam: 'じゆうにあそぼう',
} as const;
```

pointerdown/up/cancel/lostpointercaptureで入力を確実に解除する。buttonは `aria-pressed`、joystickは `aria-label="運転スティック"`、missionは `aria-live="polite"` を持つ。

- [ ] **Step 2: safe-area anchored CSSを実装する**

```css
.voxel-game-shell,.voxel-game-canvas{position:fixed;inset:0;overflow:hidden;touch-action:none}
.voxel-game-hud{position:fixed;inset:0;pointer-events:none;padding:calc(env(safe-area-inset-top) + 12px) calc(env(safe-area-inset-right) + 14px) calc(env(safe-area-inset-bottom) + 14px) calc(env(safe-area-inset-left) + 14px)}
.mission-pill{position:absolute;top:calc(env(safe-area-inset-top) + 12px);left:50%;transform:translateX(-50%);max-width:min(70vw,360px)}
.touch-joystick{position:absolute;left:calc(env(safe-area-inset-left) + 18px);bottom:calc(env(safe-area-inset-bottom) + 18px);width:clamp(112px,18vw,154px);aspect-ratio:1;pointer-events:auto}
.spray-button{position:absolute;right:calc(env(safe-area-inset-right) + 22px);bottom:calc(env(safe-area-inset-bottom) + 24px);width:clamp(88px,13vw,116px);aspect-ratio:1;border-radius:50%;pointer-events:auto}
.fullscreen-button{position:absolute;right:calc(env(safe-area-inset-right) + 14px);top:calc(env(safe-area-inset-top) + 12px);pointer-events:auto}
```

縦が390pxのmobile landscapeではmission pillの下端、joystickとspray buttonの上端、Canvas内の車両safe rectangleをruntime座標で測り、重ならないことをE2E assertionにする。

- [ ] **Step 3: telemetry型と公開hook payloadを完成させる**

```ts
export interface VoxelGameTextState {
  readonly coordinateSystem: 'origin=center, +x=right, +y=up, +z=toward-garage';
  readonly fire: { readonly intensity: number; readonly position: readonly [number, number, number]; readonly targeted: boolean };
  readonly mission: { readonly phase: import('./voxel-game/domain/VoxelGameRuntime').MissionPhase; readonly routeVisible: boolean };
  readonly blocks: readonly import('./voxel-game/domain/VoxelGameRuntime').BreakableSnapshot[];
  readonly controls: import('./voxel-game/input/controlState').DriveCommand;
  readonly vehicle: import('./voxel-game/scene/VehicleController').VehicleTelemetry;
}
```

Task 4の `render_game_to_text()` payloadへfire、mission、blocks、controlsを追加して上記をJSON stringifyする。Task 5の `advanceTime(ms)` とTask 4の `reset_voxel_game_vehicle()` は同じ実装を維持し、global型とcleanupを完成させる。

- [ ] **Step 4: fullscreenを実装する**

Fキーとfullscreen buttonで `document.documentElement.requestFullscreen()` / `document.exitFullscreen()` を切り替える。Escはブラウザ標準で終了させる。fullscreenchange後にCanvasの実寸がviewportと一致することをE2Eで確認する。

- [ ] **Step 5: Docker test/buildを実行する**

```bash
docker compose run --rm web npm test
docker compose run --rm web npm run build
```

Expected: 全unit PASS、3 HTML build SUCCESS。

- [ ] **Step 6: desktop/touchの全操作chainをE2E確認する**

- Keyboard: W/A/Space、blur後の全解除、F fullscreen、reset。
- Touch: joystick前進、旋回、pointercancel、spray長押し、release。
- State: UI文言と`render_game_to_text()`のphaseが一致する。
- Layout: HUD各要素がviewport内、操作要素同士非重複、主要車両safe rectangle非侵入。

- [ ] **Step 7: 3 viewport screenshotを目視する**

Desktop 1280×720、tablet landscape 1024×768、mobile landscape 844×390を開き、HUDの下端・右端、車両と主要地点、mission pillの重なりを画像とDOM数値の両方で確認する。

- [ ] **Step 8: progressへ追記してコミットする**

```bash
git add src/voxel-game/ui src/voxel-game/VoxelGameApp.tsx src/voxel-game/styles.css src/global.d.ts
git commit -m "消防車ゲームのタッチ操作と検証フックを追加"
```

---

### Task 8: Docker E2E、性能記録、README、最終回帰

**Files:**
- Modify: `scripts/verify-voxel-game.mjs`
- Modify: `docker-compose.yml`
- Modify: `README.md`
- Modify: `progress.md`

**Interfaces:**
- Consumes: `voxel-game.html`、公開hook、既存 `Dockerfile.e2e`、Vehicle Labのrenderer分類policy。
- Produces: `voxel-game-e2e` service、`output/voxel-game/run-manifest.json`、`results.json`、代表screenshots。

- [ ] **Step 1: E2E scriptを完成させる**

`scripts/verify-voxel-game.mjs` は次を実装する。

- run開始時に `output/voxel-game/` を完全resetし、`status:"running"` manifestを書く。
- Vite応答を30秒まで待つ。
- desktop/tablet/mobile landscapeを別contextで開く。
- console error、page error、request failureを収集する。
- keyboardまたはtouchで前進、旋回、停止、放水を操作する。
- `render_game_to_text()` で消火chainと破壊・復元chainを検証する。
- fullscreen、blur/pointercancel解除を検証する。
- HUD/Canvas/操作要素の境界をDOM数値で検証する。
- WebGL renderer名、steady renderer calls、2秒間のrAF/rendered frame deltaを記録する。
- renderer分類は `software | physical | unknown` の保守的3値を使い、明示physical GPUかつfps下限達成時だけ `certified:true` にする。
- software/unknownは実測値を残し、物理GPU達成とは扱わない。
- 成功時 `completed`、失敗時error付き `failed` manifestを必ず書く。

- [ ] **Step 2: 代表画像を生成する**

各viewportで次を保存する。

```text
output/voxel-game/desktop-driving.png
output/voxel-game/desktop-water-fire.png
output/voxel-game/desktop-block-broken.png
output/voxel-game/desktop-complete.png
output/voxel-game/tablet-landscape-driving.png
output/voxel-game/tablet-landscape-water-fire.png
output/voxel-game/mobile-landscape-driving.png
output/voxel-game/mobile-landscape-water-fire.png
```

- [ ] **Step 3: Composeへ独立E2E serviceを追加する**

```yaml
  voxel-game-e2e:
    profiles: ["e2e"]
    build:
      context: .
      dockerfile: Dockerfile.e2e
    working_dir: /app
    environment:
      VOXEL_GAME_BASE_URL: http://127.0.0.1:5173
    volumes:
      - ./output:/app/output
    command:
      - sh
      - -lc
      - |
        npm run dev -- --host 127.0.0.1 > /tmp/voxel-game-vite.log 2>&1 &
        server_pid=$$!
        trap 'kill "$$server_pid" 2>/dev/null || true' EXIT
        node scripts/verify-voxel-game.mjs || {
          cat /tmp/voxel-game-vite.log >&2
          exit 1
        }
```

- [ ] **Step 4: READMEへURL、操作、検証を追記する**

追記内容:

```markdown
## 純ボクセル消防車ゲーム

- URL: <http://localhost:5180/voxel-game.html>
- PC: WASD／矢印で運転、Spaceで放水、Fでfullscreen
- タッチ: 左スティックで運転、右の水ボタン長押しで放水

```bash
docker compose --profile e2e run --rm --build voxel-game-e2e
```
```

- [ ] **Step 5: 全自動検証をDocker内で実行する**

```bash
docker compose run --rm web npm test
docker compose run --rm web npm run build
docker compose --profile e2e run --rm --build voxel-game-e2e
docker compose --profile e2e run --rm --build e2e
```

Expected:

- 全unit test PASS。
- 3 HTML entry build SUCCESS。
- Voxel Game E2Eの操作、状態、layout、resource、runtime error検証PASS。
- Vehicle Lab E2Eの既存検証PASS。
- `output/voxel-game/run-manifest.json` が`completed`。
- physical GPUでない場合はperformance `certified:false` とrenderer分類を正直に記録する。

- [ ] **Step 6: 全8画像をoriginal detailで目視する**

消防車の見た目、道路、車庫、公園、火、水、積み木、破片、道しるべ、成功演出、HUDについて、欠け、重なり、方向、世界観辞書からの逸脱を確認する。問題が1つでもあれば最小修正し、E2Eと画像確認を最初から再実行する。

- [ ] **Step 7: 参照残りと旧実装非変更を確認する**

```bash
git diff --name-only 0a9168e..HEAD
rg -n "voxel-game" vite.config.ts README.md docker-compose.yml src scripts
git status --short
```

Expected: 旧 `src/App.tsx`、旧 `src/scene/`、旧 `src/components/Hud.tsx` の変更・削除なし。意図しないuntracked fileなし。

- [ ] **Step 8: 最終レビュー前コミットを作る**

```bash
git add scripts/verify-voxel-game.mjs docker-compose.yml README.md
git commit -m "純ボクセル消防車ゲームのE2E検証を追加"
```

- [ ] **Step 9: 完了前レビューを行う**

`superpowers:requesting-code-review` でspec `docs/design/2026-07-19-voxel-firetruck-gameplay-slice-design.md` とbase commit `0a9168e` を渡し、Critical/Importantを修正する。修正後はTask 8 Step 5〜7を再実行する。

---

## Completion Gate

- [ ] REQ-001〜REQ-023のうち本縦切り対象が各Taskへ対応している。
- [ ] 旧ゲーム、Vehicle Lab、Voxel Gameの3 entryが同時に起動・buildできる。
- [ ] PCとtouchで車庫から消火完了、自由走行、車庫再開まで完走できる。
- [ ] 前方近距離だけの自動追尾、無効方向、無効距離を検証した。
- [ ] 積み木の無効衝突、有効破壊、破片消失、近距離復元待機、離脱後復元を検証した。
- [ ] fixed-world cameraが車両yawで回転しないことを検証した。
- [ ] `render_game_to_text()` と `advanceTime()` が画面状態と一致する。
- [ ] 3 viewportでHUD境界、安全余白、主要3Dオブジェクトとの非重複を数値と画像で確認した。
- [ ] 全8代表画像を実際に開いて目視した。
- [ ] console error、page error、request failureが0件である。
- [ ] performance値、renderer名、renderer分類、certified判定を保存した。
- [ ] 物理GPUが確認できない環境では60fpsを認証したと主張しない。
- [ ] 旧コードを削除していない。
- [ ] `progress.md` に検証結果、既知制約、次の旧実装採用判断を残した。

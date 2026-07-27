# 立体ボクセル炎VFX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 静止した3段boxの火を、玩具世界に馴染む非同期アニメーション付き立体ボクセル炎へ置き換え、火勢3段階・完全消火・帰庫後復帰を見た目とtelemetryの両方で検証する。

**Architecture:** `fireVfx.ts` に18 slot固定の炎定義と決定的なpure frame計算を閉じ込め、`WaterAndFire.tsx` は赤・橙・黄白の3個の `InstancedMesh` へmatrixを転送する。既存runtime、hazard collider、水、照準、消火時間は変更せず、`VoxelGameApp.tsx` のtext hookと既存E2Eへactive slot数だけを追加する。

**Tech Stack:** React 19、TypeScript 5.9、React Three Fiber 9、Three.js 0.181、React Three Rapier 2、Vitest 4、Playwright 1.59、Docker Compose。

## Global Constraints

- 開発サーバー、npm、npx、test、build、PlaywrightはすべてDockerコンテナ内で実行する。
- 編集対象は炎VFX、炎telemetry、炎回帰、関連ドキュメントに限定する。
- 既存の消火2500ms、放水距離6、照準、`FIRE_HAZARD_BOX`、帰庫後復帰を変更しない。
- `FIRE_LAYER_BOXES`、`FIRE_LAYER_POSITIONS`、`fireLayerCount`、`visualLayout.fireLayers` は回帰互換のため残す。
- 炎は18固定slot、最大3 draw callとし、毎frameのReact state、material、geometry、mesh生成を追加しない。
- 炎、火の粉、建物、水、車両を不透明な立方体とLambert材質の玩具表現で統一する。
- 煙、texture、shader、post-processing、bloom、延焼、damage、音声は追加しない。
- 新規または実質改修する関数・moduleへ役割、入力単位、副作用が分かるJSDocを付ける。
- `progress.md` は各Taskの結果を追記するがgitへ追加しない。
- UI・3D見た目の完了報告前にDesktop 1280×720とMobile landscape 844×390を原寸目視する。
- 物理GPUの既存目標はDesktop 60fps、Tablet/Mobile landscape 30fps以上を維持する。Docker SwiftShaderのfpsは性能認証に使わない。
- 各TaskのRED、GREEN、回帰結果を確認してから日本語のコミットメッセージで分割コミットする。

---

## File Structure

```text
src/voxel-game/scene/fireVfx.ts                     # 18固定slotとpure frame計算
src/test/fireVfx.test.ts                            # シルエット、位相、火勢、入力防御
src/voxel-game/scene/WaterAndFire.tsx               # 3色InstancedMeshへのmatrix転送
src/voxel-game/VoxelGameApp.tsx                     # fireVoxelCount公開
src/global.d.ts                                     # text hook型契約
src/test/waterAndFire.test.ts                       # 既存hazard・段階互換
scripts/verify-voxel-game.mjs                       # 火勢3/2/0/復帰と画像proof
README.md                                           # 炎表現と検証方法
docs/design/2026-07-28-voxel-fire-vfx-design.md     # 実装結果
progress.md                                         # git対象外の実行ログ
```

## Spec Coverage

| 要件 | 実装・検証Task |
|---|---|
| FIRE-VFX-001、FIRE-VFX-002 | Task 1のslot配置・色役割、Task 3のDesktop/Mobile画像 |
| FIRE-VFX-003 | Task 1の位相差・火の粉cycle、Task 3の実ブラウザ連続frame |
| FIRE-VFX-004 | Task 1のactive count・最大高さ、Task 2とTask 3の3→2→1→0 telemetry |
| FIRE-VFX-005 | Task 2の既存定数維持、Task 3の2500ms消火・hazard・帰庫復帰 |
| FIRE-VFX-006 | Task 1の18 slot、Task 2の3色固定batch、Task 4のbuild/E2E |
| FIRE-VFX-007 | Task 1のunit、Task 2のtext hook、Task 3の27 proof |
| FIRE-VFX-008 | Task 3の1280×720・844×390目視、既存layout contract |

---

### Task 1: 炎slotと決定的なpure frame計算

**Files:**
- Create: `src/voxel-game/scene/fireVfx.ts`
- Create: `src/test/fireVfx.test.ts`
- Modify: `progress.md`

**Interfaces:**
- Consumes: `elapsedSeconds` と既存 `getFireLayerCount()` が返す0〜3。
- Produces: `FIRE_VOXEL_SLOTS`、`FIRE_VOXEL_POOL_SIZE`、`FIRE_ROLE_CAPACITY`、`createFireVoxelFrame()`、`getActiveFireVoxelCount()`。
- Invariant: slot番号は0〜17で一意、火勢1/2/3のactive数は6/12/18、同じ入力は同じframeを返す。

- [ ] **Step 1: slot、シルエット、motion、入力防御の失敗テストを書く**

```ts
import { describe, expect, it } from 'vitest';
import {
  FIRE_ROLE_CAPACITY,
  FIRE_VOXEL_POOL_SIZE,
  FIRE_VOXEL_SLOTS,
  createFireVoxelFrame,
  getActiveFireVoxelCount,
} from '../voxel-game/scene/fireVfx';

const activeFlames = (layerCount: number, elapsedSeconds = 0.25) => (
  createFireVoxelFrame({ elapsedSeconds, layerCount }).instances
    .filter(({ active, kind }) => active && kind === 'flame')
);

const maximumTop = (layerCount: number): number => Math.max(
  ...activeFlames(layerCount).map(({ position, scale }) => position[1] + scale[1] / 2),
);

describe('fireVfx', () => {
  it('0〜17の一意な固定slotを3色batchへ配る', () => {
    expect(FIRE_VOXEL_POOL_SIZE).toBe(18);
    expect(FIRE_VOXEL_SLOTS.map(({ slot }) => slot)).toEqual(
      Array.from({ length: 18 }, (_, slot) => slot),
    );
    expect(FIRE_ROLE_CAPACITY).toEqual({ core: 4, middle: 8, outer: 6 });
  });

  it.each([
    [0, 0], [1, 6], [2, 12], [3, 18],
  ])('火勢%sではactive slotが%s個になる', (layerCount, expected) => {
    expect(getActiveFireVoxelCount(layerCount)).toBe(expected);
  });

  it('最大火勢は幅広い根元と高さの違う2本以上の炎の舌を持つ', () => {
    const flames = activeFlames(3, 0);
    const base = flames.filter(({ position }) => position[1] < 1);
    const highTops = flames
      .map(({ position, scale }) => position[1] + scale[1] / 2)
      .filter((top) => top > 1.8);

    expect(Math.max(...base.map(({ position }) => position[0]))
      - Math.min(...base.map(({ position }) => position[0]))).toBeGreaterThanOrEqual(0.5);
    expect(Math.max(...base.map(({ position }) => position[2]))
      - Math.min(...base.map(({ position }) => position[2]))).toBeGreaterThanOrEqual(0.15);
    expect(highTops.length).toBeGreaterThanOrEqual(3);
  });

  it('火勢低下でactive数と最大高さが単調に減る', () => {
    expect(maximumTop(3)).toBeGreaterThan(maximumTop(2));
    expect(maximumTop(2)).toBeGreaterThan(maximumTop(1));
    expect(getActiveFireVoxelCount(3)).toBeGreaterThan(getActiveFireVoxelCount(2));
    expect(getActiveFireVoxelCount(2)).toBeGreaterThan(getActiveFireVoxelCount(1));
  });

  it('複数の炎が非同期に動き、基準位置0.18・基準scale18%以内に収まる', () => {
    const start = createFireVoxelFrame({ elapsedSeconds: 0, layerCount: 3 });
    const later = createFireVoxelFrame({ elapsedSeconds: 0.37, layerCount: 3 });
    const moved = later.instances.filter((current, index) => {
      const previous = start.instances[index];
      return current.kind === 'flame'
        && Math.hypot(...current.position.map((value, axis) => value - previous.position[axis])) > 0.005;
    });

    expect(moved.length).toBeGreaterThanOrEqual(8);
    for (const transform of later.instances.filter(({ kind }) => kind === 'flame')) {
      const slot = FIRE_VOXEL_SLOTS[transform.slot];
      expect(Math.hypot(...transform.position.map(
        (value, axis) => value - slot.basePosition[axis],
      ))).toBeLessThanOrEqual(0.18);
      transform.scale.forEach((value, axis) => {
        expect(Math.abs(value / slot.baseScale[axis] - 1)).toBeLessThanOrEqual(0.18);
      });
    }
  });

  it('火の粉はcycle内で上昇しながら縮み、寿命後に根元へ戻る', () => {
    const early = createFireVoxelFrame({ elapsedSeconds: 0.1, layerCount: 3 }).instances[15];
    const late = createFireVoxelFrame({ elapsedSeconds: 0.3, layerCount: 3 }).instances[15];
    const recycled = createFireVoxelFrame({ elapsedSeconds: 0.95, layerCount: 3 }).instances[15];

    expect(late.position[1]).toBeGreaterThan(early.position[1]);
    expect(late.scale[0]).toBeLessThan(early.scale[0]);
    expect(recycled.position[1]).toBeLessThan(late.position[1]);
  });

  it.each([
    { elapsedSeconds: Number.NaN, layerCount: Number.NaN },
    { elapsedSeconds: Number.POSITIVE_INFINITY, layerCount: 99 },
    { elapsedSeconds: -10, layerCount: -4 },
  ])('不正入力でも有限なtransformだけを返す', (input) => {
    const frame = createFireVoxelFrame(input);
    expect(frame.instances).toHaveLength(18);
    expect(frame.instances.flatMap(({ position, scale }) => [...position, ...scale])
      .every(Number.isFinite)).toBe(true);
  });
});
```

- [ ] **Step 2: focused testをDocker内で実行しREDを確認する**

Run:

```bash
docker compose exec -T web npm test -- --run src/test/fireVfx.test.ts
```

Expected: FAIL with `Failed to resolve import "../voxel-game/scene/fireVfx"`。

- [ ] **Step 3: 18 slotの型と定数を実装する**

```ts
export type FireVoxelRole = 'outer' | 'middle' | 'core';
export type FireVoxelKind = 'flame' | 'spark';

export interface FireVoxelSlot {
  readonly basePosition: readonly [number, number, number];
  readonly baseScale: readonly [number, number, number];
  readonly cycleSeconds: number;
  readonly kind: FireVoxelKind;
  readonly minimumLayerCount: 1 | 2 | 3;
  readonly phase: number;
  readonly role: FireVoxelRole;
  readonly slot: number;
}

export interface FireVoxelTransform {
  readonly active: boolean;
  readonly kind: FireVoxelKind;
  readonly position: readonly [number, number, number];
  readonly role: FireVoxelRole;
  readonly scale: readonly [number, number, number];
  readonly slot: number;
}

export interface FireVoxelFrame {
  readonly instances: readonly FireVoxelTransform[];
}

export const FIRE_VOXEL_POOL_SIZE = 18;
export const FIRE_ROLE_CAPACITY = { core: 4, middle: 8, outer: 6 } as const;

export const FIRE_VOXEL_SLOTS: readonly FireVoxelSlot[] = [
  { slot: 0, role: 'outer', kind: 'flame', minimumLayerCount: 1, basePosition: [12.92, 0.62, -9.05], baseScale: [0.95, 0.72, 0.9], phase: 0.04, cycleSeconds: 0.82 },
  { slot: 1, role: 'outer', kind: 'flame', minimumLayerCount: 2, basePosition: [12.62, 0.95, -8.82], baseScale: [0.58, 0.85, 0.55], phase: 0.21, cycleSeconds: 0.94 },
  { slot: 2, role: 'outer', kind: 'flame', minimumLayerCount: 2, basePosition: [13.22, 0.88, -9.22], baseScale: [0.58, 0.78, 0.55], phase: 0.48, cycleSeconds: 0.77 },
  { slot: 3, role: 'outer', kind: 'flame', minimumLayerCount: 3, basePosition: [12.68, 1.55, -8.96], baseScale: [0.44, 0.82, 0.44], phase: 0.67, cycleSeconds: 0.91 },
  { slot: 4, role: 'outer', kind: 'flame', minimumLayerCount: 3, basePosition: [13.18, 1.78, -9.12], baseScale: [0.4, 0.9, 0.4], phase: 0.83, cycleSeconds: 1.03 },
  { slot: 5, role: 'outer', kind: 'flame', minimumLayerCount: 3, basePosition: [12.96, 1.45, -9.38], baseScale: [0.42, 0.75, 0.42], phase: 0.34, cycleSeconds: 0.73 },
  { slot: 6, role: 'middle', kind: 'flame', minimumLayerCount: 1, basePosition: [12.92, 0.62, -8.98], baseScale: [0.68, 0.72, 0.62], phase: 0.13, cycleSeconds: 0.74 },
  { slot: 7, role: 'middle', kind: 'flame', minimumLayerCount: 1, basePosition: [12.76, 0.96, -8.92], baseScale: [0.48, 0.76, 0.46], phase: 0.42, cycleSeconds: 0.88 },
  { slot: 8, role: 'middle', kind: 'flame', minimumLayerCount: 2, basePosition: [13.12, 1.12, -9.03], baseScale: [0.46, 0.82, 0.44], phase: 0.61, cycleSeconds: 0.79 },
  { slot: 9, role: 'middle', kind: 'flame', minimumLayerCount: 2, basePosition: [12.72, 1.38, -9.05], baseScale: [0.36, 0.7, 0.35], phase: 0.91, cycleSeconds: 0.97 },
  { slot: 10, role: 'middle', kind: 'flame', minimumLayerCount: 3, basePosition: [13.08, 1.88, -9.12], baseScale: [0.32, 0.82, 0.32], phase: 0.28, cycleSeconds: 0.86 },
  { slot: 11, role: 'core', kind: 'flame', minimumLayerCount: 1, basePosition: [12.9, 0.55, -8.85], baseScale: [0.48, 0.58, 0.44], phase: 0.17, cycleSeconds: 0.69 },
  { slot: 12, role: 'core', kind: 'flame', minimumLayerCount: 1, basePosition: [12.78, 0.82, -8.82], baseScale: [0.3, 0.46, 0.28], phase: 0.56, cycleSeconds: 0.81 },
  { slot: 13, role: 'core', kind: 'flame', minimumLayerCount: 2, basePosition: [13.05, 1.08, -8.92], baseScale: [0.3, 0.55, 0.3], phase: 0.76, cycleSeconds: 0.9 },
  { slot: 14, role: 'core', kind: 'flame', minimumLayerCount: 3, basePosition: [12.88, 1.5, -8.92], baseScale: [0.26, 0.62, 0.26], phase: 0.38, cycleSeconds: 0.72 },
  { slot: 15, role: 'middle', kind: 'spark', minimumLayerCount: 1, basePosition: [12.6, 0.78, -8.8], baseScale: [0.16, 0.16, 0.16], phase: 0.1, cycleSeconds: 0.85 },
  { slot: 16, role: 'middle', kind: 'spark', minimumLayerCount: 2, basePosition: [13.16, 0.82, -8.95], baseScale: [0.15, 0.15, 0.15], phase: 0.43, cycleSeconds: 1.05 },
  { slot: 17, role: 'middle', kind: 'spark', minimumLayerCount: 3, basePosition: [12.92, 0.9, -9.25], baseScale: [0.14, 0.14, 0.14], phase: 0.77, cycleSeconds: 1.22 },
] as const;
```

- [ ] **Step 4: clamp、炎揺れ、火の粉cycle、active countを実装する**

実装契約:

```ts
const TAU = Math.PI * 2;

/** 不正入力を含む火勢を描画段階0〜3へ丸める。 */
function normalizeLayerCount(layerCount: number): 0 | 1 | 2 | 3 {
  if (!Number.isFinite(layerCount)) return 0;
  return Math.max(0, Math.min(3, Math.trunc(layerCount))) as 0 | 1 | 2 | 3;
}

/** 負値・非finiteを0へ寄せ、同一入力を決定的なVFX時刻へ変換する。 */
function normalizeElapsedSeconds(elapsedSeconds: number): number {
  return Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
}

/** 固定slotのうち現在火勢で表示する個数を返す。 */
export function getActiveFireVoxelCount(layerCount: number): number {
  const normalized = normalizeLayerCount(layerCount);
  return FIRE_VOXEL_SLOTS.reduce(
    (count, slot) => count + Number(normalized >= slot.minimumLayerCount),
    0,
  );
}
```

炎slotは `sin/cos` とslot固有の `phase/cycleSeconds` でX ±0.08、Y ±0.07、
Z ±0.04、Y scale ±14%、X/Z scale ±5%に収める。火の粉は
`age = modulo(time / cycleSeconds + phase, 1)` として2.0 unit上昇し、scaleを
100%から30%へ縮める。inactive slotはidentityを残してscaleだけ `[0, 0, 0]` にする。

```ts
/** 負値を含む値を0以上modulus未満へ循環させる。 */
function modulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/** 通常炎1slotの非同期な揺れと伸縮を計算する。 */
function createFlameTransform(
  slot: FireVoxelSlot,
  elapsedSeconds: number,
  active: boolean,
): FireVoxelTransform {
  const phaseRadians = slot.phase * TAU;
  const verticalWave = Math.sin(elapsedSeconds / slot.cycleSeconds * TAU + phaseRadians);
  const horizontalWave = Math.sin(
    elapsedSeconds / (slot.cycleSeconds * 1.37) * TAU + phaseRadians,
  );
  const depthWave = Math.cos(
    elapsedSeconds / (slot.cycleSeconds * 1.19) * TAU + phaseRadians,
  );
  return {
    active,
    kind: slot.kind,
    position: [
      slot.basePosition[0] + horizontalWave * 0.08,
      slot.basePosition[1] + verticalWave * 0.07,
      slot.basePosition[2] + depthWave * 0.04,
    ],
    role: slot.role,
    scale: active ? [
      slot.baseScale[0] * (1 - verticalWave * 0.05),
      slot.baseScale[1] * (1 + verticalWave * 0.14),
      slot.baseScale[2] * (1 - verticalWave * 0.05),
    ] : [0, 0, 0],
    slot: slot.slot,
  };
}

/** 火の粉1slotを上昇・縮小させ、寿命後に同じslotへ循環させる。 */
function createSparkTransform(
  slot: FireVoxelSlot,
  elapsedSeconds: number,
  active: boolean,
): FireVoxelTransform {
  const age = modulo(elapsedSeconds / slot.cycleSeconds + slot.phase, 1);
  const scaleFactor = 1 - age * 0.7;
  return {
    active,
    kind: slot.kind,
    position: [
      slot.basePosition[0] + Math.sin(age * TAU + slot.phase * TAU) * 0.12,
      slot.basePosition[1] + age * 2,
      slot.basePosition[2] + Math.cos(age * TAU + slot.phase * TAU) * 0.09,
    ],
    role: slot.role,
    scale: active ? [
      slot.baseScale[0] * scaleFactor,
      slot.baseScale[1] * scaleFactor,
      slot.baseScale[2] * scaleFactor,
    ] : [0, 0, 0],
    slot: slot.slot,
  };
}

/** 同じ時刻・火勢から同じ18 transformを返すpureな炎frame計算。 */
export function createFireVoxelFrame(input: {
  readonly elapsedSeconds: number;
  readonly layerCount: number;
}): FireVoxelFrame {
  const elapsedSeconds = normalizeElapsedSeconds(input.elapsedSeconds);
  const layerCount = normalizeLayerCount(input.layerCount);
  return {
    instances: FIRE_VOXEL_SLOTS.map((slot) => {
      const active = layerCount >= slot.minimumLayerCount;
      return slot.kind === 'spark'
        ? createSparkTransform(slot, elapsedSeconds, active)
        : createFlameTransform(slot, elapsedSeconds, active);
    }),
  };
}
```

- [ ] **Step 5: focused testをDocker内で実行しGREENを確認する**

Run:

```bash
docker compose exec -T web npm test -- --run src/test/fireVfx.test.ts
```

Expected: `src/test/fireVfx.test.ts` の全テストがPASS。

- [ ] **Step 6: 実行結果をgit対象外ログへ追記し、pure実装をコミットする**

```bash
git add src/voxel-game/scene/fireVfx.ts src/test/fireVfx.test.ts
git diff --cached --check
git commit -m '炎ボクセルの固定VFX計算を追加する'
```

---

### Task 2: 3色固定batch描画とtext telemetry

**Files:**
- Modify: `src/voxel-game/scene/WaterAndFire.tsx`
- Modify: `src/voxel-game/VoxelGameApp.tsx`
- Modify: `src/global.d.ts`
- Modify: `src/test/waterAndFire.test.ts`
- Modify: `progress.md`

**Interfaces:**
- Consumes: Task 1の `createFireVoxelFrame()`、`FIRE_ROLE_CAPACITY`、`getActiveFireVoxelCount()`。
- Produces: 赤 `outer`、橙 `middle`、黄白 `core` の3 `InstancedMesh` と `visuals.fireVoxelCount`。
- Compatibility: `getFireLayerCount()` と既存hazard定数・3層telemetryはそのまま残す。

- [ ] **Step 1: 既存hazard・段階互換と固定batch転送の失敗テストを追加する**

`src/test/waterAndFire.test.ts` へTask 1のhelperをimportし、次を追加する。

```ts
import type * as THREE from 'three';
import { createFireVoxelFrame, getActiveFireVoxelCount } from '../voxel-game/scene/fireVfx';
import { updateFireBatch } from '../voxel-game/scene/WaterAndFire';

it.each([
  [1, 3, 18], [0.66, 2, 12], [0.33, 1, 6], [0, 0, 0],
])('火の強さ%fは既存%s層・新VFX%s個へ一致する', (
  intensity,
  expectedLayers,
  expectedVoxels,
) => {
  const layerCount = getFireLayerCount(intensity);
  expect(layerCount).toBe(expectedLayers);
  expect(getActiveFireVoxelCount(layerCount)).toBe(expectedVoxels);
});

it('全18 transformからouter 6 slotだけを固定batch順へ転送する', () => {
  const setMatrixAt = vi.fn();
  const mesh = {
    instanceMatrix: { needsUpdate: false },
    setMatrixAt,
    visible: false,
  } as unknown as THREE.InstancedMesh;
  const frame = createFireVoxelFrame({ elapsedSeconds: 0.2, layerCount: 3 });

  updateFireBatch(mesh, 'outer', frame.instances);

  expect(setMatrixAt).toHaveBeenCalledTimes(6);
  expect(mesh.visible).toBe(true);
  expect(mesh.instanceMatrix.needsUpdate).toBe(true);
});

it('消火後も固定batch全slotへzero scale matrixを書き、batchを非表示にする', () => {
  const setMatrixAt = vi.fn();
  const mesh = {
    instanceMatrix: { needsUpdate: false },
    setMatrixAt,
    visible: true,
  } as unknown as THREE.InstancedMesh;
  const frame = createFireVoxelFrame({ elapsedSeconds: 0.2, layerCount: 0 });

  updateFireBatch(mesh, 'middle', frame.instances);

  expect(setMatrixAt).toHaveBeenCalledTimes(8);
  expect(mesh.visible).toBe(false);
  expect(mesh.instanceMatrix.needsUpdate).toBe(true);
});
```

- [ ] **Step 2: focused testをDocker内で実行しREDを確認する**

Run:

```bash
docker compose exec -T web npm test -- --run src/test/fireVfx.test.ts src/test/waterAndFire.test.ts
```

Expected: FAIL because `WaterAndFire` does not export `updateFireBatch` yet。

- [ ] **Step 3: `WaterAndFire` の静的3 meshを固定3 batchへ置き換える**

追加するref:

```ts
const outerFireRef = useRef<THREE.InstancedMesh>(null);
const middleFireRef = useRef<THREE.InstancedMesh>(null);
const coreFireRef = useRef<THREE.InstancedMesh>(null);
const fireElapsedRef = useRef(0);
```

追加する転送helper:

```ts
/** 全18 transformから同色slotだけを固定batch順へ転送する。 */
export function updateFireBatch(
  mesh: THREE.InstancedMesh | null,
  role: FireVoxelRole,
  instances: readonly FireVoxelTransform[],
): void {
  if (!mesh) return;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  let batchIndex = 0;
  let visible = false;

  for (const instance of instances) {
    if (instance.role !== role) continue;
    position.fromArray(instance.position);
    scale.fromArray(instance.active ? instance.scale : [0, 0, 0]);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(batchIndex, matrix);
    visible ||= instance.active;
    batchIndex += 1;
  }
  mesh.visible = visible;
  mesh.instanceMatrix.needsUpdate = true;
}
```

既存 `useFrame` のsnapshot取得直後に有限な `delta` を加算し、次のframeを3 batchへ渡す。

```ts
fireElapsedRef.current = (
  fireElapsedRef.current + (Number.isFinite(delta) ? Math.max(0, delta) : 0)
) % 120;
const fireFrame = createFireVoxelFrame({
  elapsedSeconds: fireElapsedRef.current,
  layerCount: getFireLayerCount(missionSnapshot.fireIntensity),
});
updateFireBatch(outerFireRef.current, 'outer', fireFrame.instances);
updateFireBatch(middleFireRef.current, 'middle', fireFrame.instances);
updateFireBatch(coreFireRef.current, 'core', fireFrame.instances);
```

削除対象は3個の条件付き静的 `<mesh>` だけ。`FIRE_LAYER_BOXES` と
`FIRE_LAYER_POSITIONS` は削除しない。

追加する3 batch:

```tsx
<instancedMesh args={[undefined, undefined, FIRE_ROLE_CAPACITY.outer]} frustumCulled={false} ref={outerFireRef} visible={false}>
  <boxGeometry args={[1, 1, 1]} />
  <meshLambertMaterial color="#ef3b24" emissive="#a51d16" emissiveIntensity={0.48} />
</instancedMesh>
<instancedMesh args={[undefined, undefined, FIRE_ROLE_CAPACITY.middle]} frustumCulled={false} ref={middleFireRef} visible={false}>
  <boxGeometry args={[1, 1, 1]} />
  <meshLambertMaterial color="#ff7a1a" emissive="#ef3b24" emissiveIntensity={0.55} />
</instancedMesh>
<instancedMesh args={[undefined, undefined, FIRE_ROLE_CAPACITY.core]} frustumCulled={false} ref={coreFireRef} visible={false}>
  <boxGeometry args={[1, 1, 1]} />
  <meshLambertMaterial color="#fff2a6" emissive="#ffb11b" emissiveIntensity={0.62} />
</instancedMesh>
```

- [ ] **Step 4: text hookへactive slot数を追加する**

`src/voxel-game/VoxelGameApp.tsx`:

```ts
const fireLayerCount = getFireLayerCount(runtime.fireIntensity);

visuals: {
  fireHazardEnabled: isFireHazardEnabled(runtime.fireIntensity),
  fireLayerCount,
  fireVoxelCount: getActiveFireVoxelCount(fireLayerCount),
  // 既存fieldを維持
}
```

`src/global.d.ts` の `visuals`:

```ts
readonly fireVoxelCount: number;
```

- [ ] **Step 5: focused unitとproduction buildをDocker内で実行する**

Run:

```bash
docker compose exec -T web npm test -- --run src/test/fireVfx.test.ts src/test/waterAndFire.test.ts src/test/voxelGameRenderTelemetry.test.ts
docker compose exec -T web npm run build
```

Expected: focused unitが全件PASSし、Vite production buildがexit 0。型consumer漏れなし。

- [ ] **Step 6: 削除した静的描画の参照残りと固定pool契約を確認してコミットする**

Run:

```bash
rg -n "fireVoxelCount|FIRE_ROLE_CAPACITY|createFireVoxelFrame" src scripts
rg -n "visualState\\.fireLayerCount >=|<mesh position=\\{FIRE_LAYER_BOXES" src/voxel-game/scene/WaterAndFire.tsx
git diff --check
```

Expected: 新consumerが揃い、旧条件付き3 meshの検索結果は0件。`FIRE_LAYER_BOXES` は
telemetry互換として残る。

```bash
git add src/voxel-game/scene/WaterAndFire.tsx src/voxel-game/VoxelGameApp.tsx src/global.d.ts src/test/waterAndFire.test.ts
git diff --cached --check
git commit -m '立体ボクセル炎を固定batchで描画する'
```

---

### Task 3: 実ブラウザの火勢遷移と代表画像

**Files:**
- Modify: `scripts/verify-voxel-game.mjs`
- Refresh: `output/voxel-game/desktop-fire-hazard-before.png`
- Refresh: `output/voxel-game/desktop-water-fire.png`
- Refresh: `output/voxel-game/tablet-landscape-water-fire.png`
- Refresh: `output/voxel-game/mobile-landscape-water-fire.png`
- Refresh: 既存canonical full E2Eの全27 proof
- Modify: `progress.md`

**Interfaces:**
- Consumes: `window.render_game_to_text()` の `visuals.fireVoxelCount`。
- Produces: 火勢3=18、2=12、0=0、帰庫復帰=18の実ブラウザ契約。
- Proof: 既存画像名と27件manifestを維持し、画像内容だけを新しい炎へ更新する。

- [ ] **Step 1: E2Eへ炎slot数の契約を先に追加する**

`assertInitialWorldPhysicsContract(initial)`:

```js
assert.equal(initial.visuals.fireVoxelCount, 18, 'Initial voxel fire pool is incomplete.');
assert.equal(initial.visuals.fireLayerCount, 3, 'Initial fire layer compatibility changed.');
```

Tabletの1000ms放水後:

```js
assert.equal(water.visuals.fireLayerCount, 2, 'Tablet fire did not enter the middle stage.');
assert.equal(water.visuals.fireVoxelCount, 12, 'Tablet middle-stage voxel count is wrong.');
```

完全消火直後:

```js
assert.equal(celebration.visuals.fireVoxelCount, 0, `${name}: voxel fire remains after 2500ms.`);
```

帰庫後:

```js
assert.equal(restarted.visuals.fireVoxelCount, 18, `${name}: voxel fire was not restored.`);
```

hazard lifecycleの `extinguished` と `restarted` にも同じ0/18 assertionを置き、
物理hazardと見た目が同時に切り替わることを固定する。

- [ ] **Step 2: nonbreak focusをDocker E2Eで実行する**

Run:

```bash
docker compose --profile e2e run --rm --build -e VOXEL_GAME_FOCUS=nonbreak voxel-game-e2e
```

Expected: `contractFailures: []`、browser error 0/0/0、Desktop/Mobile complete mission、
fire hazard lifecycle、Tablet弱火でslot数が18→12→0→18と一致。

- [ ] **Step 3: canonical full E2EをDocker内で実行し全27 proofを更新する**

Run:

```bash
docker compose --profile e2e run --rm --build voxel-game-e2e
```

Expected: `output/voxel-game/result.json` が `ok: true`、`contractFailures: []`、
browser error 0/0/0、required proof 27件。

- [ ] **Step 4: DesktopとMobileの代表画像を原寸目視する**

必ず画像そのものを開き、次を確認する。

- `desktop-fire-hazard-before.png`: 幅広い根元、赤い外炎、橙の中炎、黄白い芯、左右にずれた2本以上の炎の舌。
- `desktop-water-fire.png`: 青白い水と赤橙黄の炎が同時に識別でき、水が炎手前で止まる。
- `tablet-landscape-water-fire.png`: 弱火の高さと個数が最大火勢より少ない。
- `mobile-landscape-water-fire.png`: HUD、放水button、消防車を炎が覆わない。
- 画像の重なり、はみ出し、空白化、古い3段box残りがない。

- [ ] **Step 5: 結果JSONと画像manifestを確認してコミットする**

Run:

```bash
jq '{ok, contractFailures, errors, proofs: (.proofs | length)}' output/voxel-game/result.json
git status --short
git diff --check
git add scripts/verify-voxel-game.mjs
git diff --cached --check
git commit -m '炎VFXの実ブラウザ回帰を追加する'
```

`output/` と `progress.md` がgit対象外であることを維持する。

---

### Task 4: ドキュメント、全回帰、push

**Files:**
- Modify: `README.md`
- Modify: `docs/design/2026-07-28-voxel-fire-vfx-design.md`
- Modify: `progress.md`

- [ ] **Step 1: READMEと設計書へ確定実装を反映する**

READMEへ次を反映する。

- 火は18 slot以内・3色固定batchの立体ボクセル炎。
- 炎の舌は非同期に揺れ、火の粉は上昇・縮小して循環。
- 消火に伴って18→12→6→0へ減り、帰庫後に18へ戻る。
- 起動・操作・Docker検証コマンドは既存記述を維持する。

設計書へ「実装結果」節を追加し、実測のunit件数、build結果、E2E result、画像目視、
draw call上限、残課題の有無を記録する。事前設計の要件状態は変更しない。

- [ ] **Step 2: 全unitとproduction buildをfreshに実行する**

Run:

```bash
docker compose exec -T web npm test -- --run
docker compose exec -T web npm run build
```

Expected: 全unit PASS、production build exit 0。

- [ ] **Step 3: canonical full E2Eをfreshに再実行し、最終画像を目視する**

Run:

```bash
docker compose --profile e2e run --rm --build voxel-game-e2e
```

Expected: `ok: true`、`contractFailures: []`、browser error 0/0/0、27 proof。
Desktop 1280×720とMobile landscape 844×390を再度原寸目視する。

- [ ] **Step 4: docsをコミットし、送信範囲を検査する**

```bash
git add README.md docs/design/2026-07-28-voxel-fire-vfx-design.md
git diff --cached --check
git commit -m '立体ボクセル炎の実装結果を記録する'
git status --short --branch
git diff --check
```

`progress.md`、`output/`、秘密情報、意図しない既存差分をcommitへ含めない。

- [ ] **Step 5: pre-push security checkを実行する**

`pre-push-security-check` Skillを読み、stage済み差分だけでなく
`origin/main..HEAD` 全体を対象にsecret、credential、private key、巨大binary、
意図しない生成物を検査する。検出があればpushを止め、該当commitを安全に修正する。

- [ ] **Step 6: ユーザー承認済みのmain pushを行いremote一致を確認する**

```bash
git push origin main
git ls-remote origin refs/heads/main
git rev-parse HEAD
git rev-list --left-right --count origin/main...HEAD
```

Expected: remote SHAとlocal HEADが一致し、ahead/behindが `0 0`。

---

## Completion Gate

- [ ] `FIRE-VFX-001`〜`FIRE-VFX-008` の実装先と検証結果が追跡できる。
- [ ] 固定poolは18 slot、火勢1/2/3のactive数は6/12/18、火勢0は0。
- [ ] 赤・橙・黄白の3 batch以外に炎draw callを追加していない。
- [ ] 複数の炎の舌が非同期に動き、火の粉が上昇・縮小・循環する。
- [ ] 通常炎の移動量0.18以内、scale変化±18%以内をunitで確認した。
- [ ] `FIRE_HAZARD_BOX`、2500ms消火、放水距離6、照準、帰庫復帰が維持される。
- [ ] 全unit、production build、canonical full E2Eがfreshに成功する。
- [ ] `contractFailures: []`、browser error 0/0/0、既存27 proofを維持する。
- [ ] Desktop 1280×720とMobile landscape 844×390の画像を原寸目視した。
- [ ] `受け入れ条件`、`非対象`、`リスクと対策`、`性能目標`が設計書に残る。
- [ ] `origin/main..HEAD` のsecurity check後にpushし、remote/local SHAとahead/behind 0/0を確認する。

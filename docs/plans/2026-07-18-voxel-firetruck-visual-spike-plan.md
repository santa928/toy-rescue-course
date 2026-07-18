# 純ボクセル消防車デザイン・スパイク Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存ゲームへ影響を与えず、純ボクセル消防車1台を回転・ズームして確認できる独立した React Three Fiber 展示ページを作る。

**Architecture:** 消防車を整数グリッド座標とパレットIDのデータとして定義し、pure helper で検証・境界計算・色別グループ化した後、色ごとの `InstancedMesh` で描画する。`vehicle-lab.html` を既存 `index.html` とは別の Vite エントリにし、Docker 化した Playwright で3種類の横向き viewport と4方向の外観を検証する。

**Tech Stack:** React 19、TypeScript 5.9、Vite 7、React Three Fiber 9、Three.js 0.181、Drei 10、Vitest 4、Playwright 1.59、Docker Compose。

**Design Source:** `docs/design/2026-07-18-voxel-firetruck-visual-spike-design.md` のREQ-001〜REQ-015、世界観辞書、受け入れ条件を維持する。

## Global Constraints

- 既存の `src/App.tsx`、`src/scene/ToyRescueScene.tsx`、`src/scene/VehicleModel.tsx` は変更しない。
- 消防車は同じ基準グリッドに揃えた立方体だけで構成し、角丸形状、円柱、文字、ロゴを使わない。
- 赤い車体、白いライン、黒い窓とタイヤ、銀色の梯子、青い警光灯を使う。
- 消防車は800ボクセル以下、車両本体は10 draw call以下にする。
- Desktopは実測60fps、タブレット・Mobileは実測30fps以上を目標にする。
- PC 1280×720、タブレット横 1024×768、スマホ横 844×390を検証する。
- 開発環境、テスト、型チェック、ビルド、PlaywrightはすべてDocker内で実行する。
- 追加・実質改修する関数、クラス、コンポーネントには簡潔なJSDocを付ける。
- コミットメッセージは日本語にする。
- 運転、物理、放水、サイレン、箱庭、ミッション、ゲームHUDは実装しない。

---

## ファイル構成

- Create `vehicle-lab.html`: 独立した消防車展示ページのHTMLエントリ。
- Modify `vite.config.ts`: `index.html` と `vehicle-lab.html` を複数エントリとしてビルドする。
- Create `src/vehicle-lab/main.tsx`: 展示ページ用Reactルート。
- Create `src/vehicle-lab/VehicleLabApp.tsx`: 画面構成、固定方向ボタン、エラー境界、テスト用window API。
- Create `src/vehicle-lab/styles.css`: Canvasと案内UIを安全に分離するレスポンシブレイアウト。
- Create `src/vehicle-lab/model/voxelModel.ts`: ボクセル検証、境界計算、色別グループ化。
- Create `src/vehicle-lab/model/fireTruckVoxels.ts`: 消防車の座標データとパレット。
- Create `src/vehicle-lab/model/voxelRenderPlan.ts`: 描画バッチとinstance位置を生成するpure module。
- Create `src/vehicle-lab/scene/VoxelFireTruck.tsx`: 色別 `InstancedMesh` 描画。
- Create `src/vehicle-lab/scene/VehicleShowroom.tsx`: カメラ、ライト、展示台、OrbitControls。
- Modify `src/global.d.ts`: 展示ページ検証用window APIの型。
- Create `src/test/voxelModel.test.ts`: 汎用ボクセルロジックのテスト。
- Create `src/test/fireTruckVoxels.test.ts`: 消防車データの外形・上限・象徴パーツのテスト。
- Create `src/test/voxelRenderPlan.test.ts`: 描画バッチ数と中央配置のテスト。
- Create `Dockerfile.e2e`: Playwright検証専用コンテナ。
- Modify `.dockerignore`: 検証生成物とVisual Companion一時ファイルをbuild contextから除外する。
- Modify `docker-compose.yml`: `e2e` profileを追加。
- Create `scripts/verify-vehicle-lab.mjs`: 3 viewport × 4方向のスクリーンショットと数値検証。
- Create `README.md`: Docker起動、展示ページ、検証コマンド、操作方法。

---

### Task 1: ボクセルモデルの検証と境界計算

**Files:**
- Create: `src/vehicle-lab/model/voxelModel.ts`
- Test: `src/test/voxelModel.test.ts`

**Interfaces:**
- Consumes: なし。
- Produces: `VoxelCell<PaletteId>`、`VoxelBounds`、`assertValidVoxelModel()`、`calculateVoxelBounds()`、`groupVoxelsByPalette()`、`calculateModelOffset()`。

- [ ] **Step 1: 失敗するテストを書く**

`src/test/voxelModel.test.ts` を次の内容で作成する。

```ts
import { describe, expect, it } from 'vitest';
import {
  assertValidVoxelModel,
  calculateModelOffset,
  calculateVoxelBounds,
  groupVoxelsByPalette,
  type VoxelCell,
} from '../vehicle-lab/model/voxelModel';

type TestPalette = 'red' | 'blue';

const validCells: readonly VoxelCell<TestPalette>[] = [
  { x: -2, y: 0, z: -1, paletteId: 'red' },
  { x: 2, y: 3, z: 4, paletteId: 'blue' },
  { x: 0, y: 1, z: 2, paletteId: 'red' },
];

describe('voxelModel', () => {
  it('整数座標、既知パレット、重複なしのモデルを受理する', () => {
    expect(() => assertValidVoxelModel(validCells, ['red', 'blue'])).not.toThrow();
  });

  it('重複座標を拒否する', () => {
    const duplicated: readonly VoxelCell<TestPalette>[] = [
      { x: 0, y: 0, z: 0, paletteId: 'red' },
      { x: 0, y: 0, z: 0, paletteId: 'blue' },
    ];

    expect(() => assertValidVoxelModel(duplicated, ['red', 'blue'])).toThrow(
      'Duplicate voxel coordinate: 0,0,0',
    );
  });

  it('非整数座標と未知パレットを拒否する', () => {
    expect(() =>
      assertValidVoxelModel([{ x: 0.5, y: 0, z: 0, paletteId: 'red' }], ['red', 'blue']),
    ).toThrow('Voxel coordinates must be finite integers');

    expect(() =>
      assertValidVoxelModel(
        [{ x: 0, y: 0, z: 0, paletteId: 'green' as TestPalette }],
        ['red', 'blue'],
      ),
    ).toThrow('Unknown voxel palette id: green');
  });

  it('境界、サイズ、中心を計算する', () => {
    expect(calculateVoxelBounds(validCells)).toEqual({
      min: { x: -2, y: 0, z: -1 },
      max: { x: 2, y: 3, z: 4 },
      size: { x: 5, y: 4, z: 6 },
      center: { x: 0, y: 1.5, z: 1.5 },
    });
  });

  it('色別グループと地面基準の中央オフセットを返す', () => {
    const groups = groupVoxelsByPalette(validCells, ['red', 'blue']);
    const bounds = calculateVoxelBounds(validCells);

    expect(groups.get('red')).toHaveLength(2);
    expect(groups.get('blue')).toHaveLength(1);
    expect(calculateModelOffset(bounds, 0.25)).toEqual([-0, -0, -0.375]);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run:

```bash
docker compose run --rm web npm test -- src/test/voxelModel.test.ts
```

Expected: FAIL。`../vehicle-lab/model/voxelModel` が存在しない旨が表示される。

- [ ] **Step 3: 最小実装を書く**

`src/vehicle-lab/model/voxelModel.ts` を次の内容で作成する。

```ts
export interface VoxelCoordinate {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface VoxelCell<PaletteId extends string = string> extends VoxelCoordinate {
  readonly paletteId: PaletteId;
}

export interface VoxelBounds {
  readonly min: VoxelCoordinate;
  readonly max: VoxelCoordinate;
  readonly size: VoxelCoordinate;
  readonly center: VoxelCoordinate;
}

export const DEFAULT_MAX_VOXELS = 800;

/** ボクセル座標を重複検査用の安定した文字列へ変換する。 */
function coordinateKey(cell: VoxelCoordinate): string {
  return `${cell.x},${cell.y},${cell.z}`;
}

/** ボクセル定義の座標、パレット、重複、セル数を検証する。 */
export function assertValidVoxelModel<PaletteId extends string>(
  cells: readonly VoxelCell<PaletteId>[],
  paletteIds: readonly PaletteId[],
  maxVoxels = DEFAULT_MAX_VOXELS,
): void {
  if (cells.length === 0) {
    throw new Error('Voxel model must contain at least one cell');
  }
  if (cells.length > maxVoxels) {
    throw new Error(`Voxel model exceeds limit: ${cells.length}/${maxVoxels}`);
  }

  const knownPaletteIds = new Set<string>(paletteIds);
  const occupiedCoordinates = new Set<string>();

  for (const cell of cells) {
    if (![cell.x, cell.y, cell.z].every((value) => Number.isFinite(value) && Number.isInteger(value))) {
      throw new Error('Voxel coordinates must be finite integers');
    }
    if (!knownPaletteIds.has(cell.paletteId)) {
      throw new Error(`Unknown voxel palette id: ${cell.paletteId}`);
    }

    const key = coordinateKey(cell);
    if (occupiedCoordinates.has(key)) {
      throw new Error(`Duplicate voxel coordinate: ${key}`);
    }
    occupiedCoordinates.add(key);
  }
}

/** 空でないボクセル集合の外接境界、サイズ、中心を返す。 */
export function calculateVoxelBounds<PaletteId extends string>(
  cells: readonly VoxelCell<PaletteId>[],
): VoxelBounds {
  if (cells.length === 0) {
    throw new Error('Cannot calculate bounds for an empty voxel model');
  }

  const xs = cells.map((cell) => cell.x);
  const ys = cells.map((cell) => cell.y);
  const zs = cells.map((cell) => cell.z);
  const min = { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) } as const;
  const max = { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) } as const;

  return {
    min,
    max,
    size: {
      x: max.x - min.x + 1,
      y: max.y - min.y + 1,
      z: max.z - min.z + 1,
    },
    center: {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    },
  };
}

/** ボクセルをパレット順で色別バッチへまとめ、未使用色は除外する。 */
export function groupVoxelsByPalette<PaletteId extends string>(
  cells: readonly VoxelCell<PaletteId>[],
  paletteIds: readonly PaletteId[],
): ReadonlyMap<PaletteId, readonly VoxelCell<PaletteId>[]> {
  const mutableGroups = new Map<PaletteId, VoxelCell<PaletteId>[]>(
    paletteIds.map((paletteId) => [paletteId, []]),
  );

  for (const cell of cells) {
    mutableGroups.get(cell.paletteId)?.push(cell);
  }

  return new Map(
    [...mutableGroups.entries()].filter(([, paletteCells]) => paletteCells.length > 0),
  );
}

/** モデルをX/Z中央かつ地面Y=0へ配置するワールドオフセットを返す。 */
export function calculateModelOffset(
  bounds: VoxelBounds,
  voxelSize: number,
): readonly [number, number, number] {
  return [
    -bounds.center.x * voxelSize,
    -bounds.min.y * voxelSize,
    -bounds.center.z * voxelSize,
  ];
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run:

```bash
docker compose run --rm web npm test -- src/test/voxelModel.test.ts
```

Expected: 5 tests PASS。

- [ ] **Step 5: コミットする**

```bash
git add src/vehicle-lab/model/voxelModel.ts src/test/voxelModel.test.ts
git commit -m "ボクセルモデルの検証処理を追加"
```

---

### Task 2: 純ボクセル消防車の座標データ

**Files:**
- Create: `src/vehicle-lab/model/fireTruckVoxels.ts`
- Test: `src/test/fireTruckVoxels.test.ts`

**Interfaces:**
- Consumes: `VoxelCell`、`assertValidVoxelModel()`、`calculateVoxelBounds()`。
- Produces: `FireTruckPaletteId`、`FIRE_TRUCK_PALETTE`、`FIRE_TRUCK_PALETTE_IDS`、`FIRE_TRUCK_VOXELS`。

- [ ] **Step 1: 消防車の外形を固定する失敗テストを書く**

`src/test/fireTruckVoxels.test.ts` を次の内容で作成する。

```ts
import { describe, expect, it } from 'vitest';
import {
  FIRE_TRUCK_PALETTE_IDS,
  FIRE_TRUCK_VOXELS,
} from '../vehicle-lab/model/fireTruckVoxels';
import {
  assertValidVoxelModel,
  calculateVoxelBounds,
  groupVoxelsByPalette,
} from '../vehicle-lab/model/voxelModel';

function paletteAt(x: number, y: number, z: number): string | undefined {
  return FIRE_TRUCK_VOXELS.find((cell) => cell.x === x && cell.y === y && cell.z === z)?.paletteId;
}

describe('FIRE_TRUCK_VOXELS', () => {
  it('有効かつ800セル以下の消防車である', () => {
    expect(() => assertValidVoxelModel(FIRE_TRUCK_VOXELS, FIRE_TRUCK_PALETTE_IDS)).not.toThrow();
    expect(FIRE_TRUCK_VOXELS.length).toBeGreaterThan(500);
    expect(FIRE_TRUCK_VOXELS.length).toBeLessThanOrEqual(800);
  });

  it('幼児玩具らしい短く太い外形を持つ', () => {
    expect(calculateVoxelBounds(FIRE_TRUCK_VOXELS)).toEqual({
      min: { x: -6, y: 0, z: -7 },
      max: { x: 5, y: 7, z: 6 },
      size: { x: 12, y: 8, z: 14 },
      center: { x: -0.5, y: 3.5, z: -0.5 },
    });
  });

  it('正面窓、タイヤ、梯子、警光灯を持つ', () => {
    expect(paletteAt(0, 4, -6)).toBe('black');
    expect(paletteAt(-6, 0, -4)).toBe('black');
    expect(paletteAt(-3, 7, 5)).toBe('silver');
    expect(paletteAt(-3, 7, -5)).toBe('blue');
  });

  it('車両本体の色別バッチ数が10以下である', () => {
    const groups = groupVoxelsByPalette(FIRE_TRUCK_VOXELS, FIRE_TRUCK_PALETTE_IDS);
    expect(groups.size).toBeLessThanOrEqual(10);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run:

```bash
docker compose run --rm web npm test -- src/test/fireTruckVoxels.test.ts
```

Expected: FAIL。`fireTruckVoxels` が存在しない旨が表示される。

- [ ] **Step 3: 消防車データを生成する実装を書く**

`src/vehicle-lab/model/fireTruckVoxels.ts` を次の内容で作成する。

```ts
import type { VoxelCell } from './voxelModel';

export const FIRE_TRUCK_PALETTE = {
  red: { color: '#d92d24', roughness: 0.72 },
  white: { color: '#f3eee3', roughness: 0.78 },
  black: { color: '#171b22', roughness: 0.82 },
  silver: { color: '#aab1b9', roughness: 0.58 },
  blue: { color: '#1769ff', roughness: 0.42, emissive: '#0d47c7', emissiveIntensity: 0.35 },
  amber: { color: '#ffad19', roughness: 0.58, emissive: '#a95800', emissiveIntensity: 0.15 },
  darkGray: { color: '#4a515a', roughness: 0.7 },
} as const;

export type FireTruckPaletteId = keyof typeof FIRE_TRUCK_PALETTE;

export const FIRE_TRUCK_PALETTE_IDS = Object.keys(
  FIRE_TRUCK_PALETTE,
) as readonly FireTruckPaletteId[];

type MutableVoxelMap = Map<string, VoxelCell<FireTruckPaletteId>>;

/** 指定座標へボクセルを置き、既存セルがあれば色を上書きする。 */
function setVoxel(
  voxels: MutableVoxelMap,
  x: number,
  y: number,
  z: number,
  paletteId: FireTruckPaletteId,
): void {
  voxels.set(`${x},${y},${z}`, { x, y, z, paletteId });
}

/** 軸平行な直方体を同色ボクセルで埋める。 */
function fillBox(
  voxels: MutableVoxelMap,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  paletteId: FireTruckPaletteId,
): void {
  for (let x = min[0]; x <= max[0]; x += 1) {
    for (let y = min[1]; y <= max[1]; y += 1) {
      for (let z = min[2]; z <= max[2]; z += 1) {
        setVoxel(voxels, x, y, z, paletteId);
      }
    }
  }
}

/** 軸平行な直方体の外周だけを同色ボクセルで作る。 */
function shellBox(
  voxels: MutableVoxelMap,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  paletteId: FireTruckPaletteId,
): void {
  for (let x = min[0]; x <= max[0]; x += 1) {
    for (let y = min[1]; y <= max[1]; y += 1) {
      for (let z = min[2]; z <= max[2]; z += 1) {
        const onBoundary =
          x === min[0] || x === max[0] ||
          y === min[1] || y === max[1] ||
          z === min[2] || z === max[2];
        if (onBoundary) {
          setVoxel(voxels, x, y, z, paletteId);
        }
      }
    }
  }
}

/** 3×3の角を落とした純ボクセルタイヤを車体側面へ置く。 */
function addWheel(voxels: MutableVoxelMap, x: number, zCenter: number): void {
  const wheelPattern = [
    [-1, 0],
    [0, -1],
    [0, 0],
    [0, 1],
    [1, 0],
  ] as const;

  for (const [dy, dz] of wheelPattern) {
    setVoxel(voxels, x, 1 + dy, zCenter + dz, 'black');
  }
  setVoxel(voxels, x, 1, zCenter, 'darkGray');
}

/** 選定した純ボクセル案の消防車データを決定的に生成する。 */
function buildFireTruckVoxels(): readonly VoxelCell<FireTruckPaletteId>[] {
  const voxels: MutableVoxelMap = new Map();

  fillBox(voxels, [-5, 1, -6], [4, 1, 6], 'darkGray');
  shellBox(voxels, [-5, 2, -6], [4, 6, -2], 'red');
  shellBox(voxels, [-5, 2, -1], [4, 6, 6], 'red');

  fillBox(voxels, [-3, 4, -6], [2, 5, -6], 'black');
  fillBox(voxels, [-5, 4, -5], [-5, 5, -3], 'black');
  fillBox(voxels, [4, 4, -5], [4, 5, -3], 'black');

  fillBox(voxels, [-5, 3, -6], [-5, 3, 6], 'white');
  fillBox(voxels, [4, 3, -6], [4, 3, 6], 'white');
  fillBox(voxels, [-5, 3, 1], [-5, 5, 4], 'silver');
  fillBox(voxels, [4, 3, 1], [4, 5, 4], 'silver');

  fillBox(voxels, [-5, 1, -7], [4, 1, -7], 'white');
  fillBox(voxels, [-2, 2, -7], [1, 2, -7], 'darkGray');
  setVoxel(voxels, -4, 2, -7, 'amber');
  setVoxel(voxels, 3, 2, -7, 'amber');

  for (const x of [-6, 5]) {
    addWheel(voxels, x, -4);
    addWheel(voxels, x, 4);
  }

  for (let z = -1; z <= 6; z += 1) {
    setVoxel(voxels, -3, 7, z, 'silver');
    setVoxel(voxels, 3, 7, z, 'silver');
  }
  for (const z of [-1, 1, 3, 5]) {
    fillBox(voxels, [-3, 7, z], [3, 7, z], 'silver');
  }
  fillBox(voxels, [-2, 7, -5], [-2, 7, -5], 'blue');
  fillBox(voxels, [1, 7, -5], [1, 7, -5], 'blue');
  fillBox(voxels, [-3, 7, -5], [-3, 7, -5], 'blue');
  fillBox(voxels, [2, 7, -5], [2, 7, -5], 'blue');

  return [...voxels.values()].sort(
    (left, right) => left.y - right.y || left.z - right.z || left.x - right.x,
  );
}

export const FIRE_TRUCK_VOXELS = buildFireTruckVoxels();
```

- [ ] **Step 4: データテストを実行する**

Run:

```bash
docker compose run --rm web npm test -- src/test/fireTruckVoxels.test.ts
```

Expected: 4 tests PASS。消防車は640セル、境界は12×8×14、色別バッチは7である。

- [ ] **Step 5: Task 1とTask 2のテストをまとめて実行する**

Run:

```bash
docker compose run --rm web npm test -- src/test/voxelModel.test.ts src/test/fireTruckVoxels.test.ts
```

Expected: 9 tests PASS。

- [ ] **Step 6: コミットする**

```bash
git add src/vehicle-lab/model/fireTruckVoxels.ts src/test/fireTruckVoxels.test.ts
git commit -m "純ボクセル消防車のモデルデータを追加"
```

---

### Task 3: 色別instance描画プランと消防車コンポーネント

**Files:**
- Create: `src/vehicle-lab/model/voxelRenderPlan.ts`
- Create: `src/vehicle-lab/scene/VoxelFireTruck.tsx`
- Test: `src/test/voxelRenderPlan.test.ts`

**Interfaces:**
- Consumes: `VoxelCell`、`VoxelBounds`、`calculateModelOffset()`、`groupVoxelsByPalette()`、消防車パレットとセル。
- Produces: `VoxelRenderPlan<PaletteId>`、`createVoxelRenderPlan()`、`FIRE_TRUCK_RENDER_PLAN`、`VoxelFireTruck`。

- [ ] **Step 1: 描画バッチの失敗テストを書く**

`src/test/voxelRenderPlan.test.ts` を次の内容で作成する。

```ts
import { describe, expect, it } from 'vitest';
import {
  FIRE_TRUCK_PALETTE_IDS,
  FIRE_TRUCK_VOXELS,
} from '../vehicle-lab/model/fireTruckVoxels';
import { calculateVoxelBounds } from '../vehicle-lab/model/voxelModel';
import { createVoxelRenderPlan } from '../vehicle-lab/model/voxelRenderPlan';

describe('createVoxelRenderPlan', () => {
  it('消防車を色別10バッチ以下へまとめる', () => {
    const plan = createVoxelRenderPlan(
      FIRE_TRUCK_VOXELS,
      FIRE_TRUCK_PALETTE_IDS,
      calculateVoxelBounds(FIRE_TRUCK_VOXELS),
      0.24,
    );

    expect(plan.voxelCount).toBe(FIRE_TRUCK_VOXELS.length);
    expect(plan.drawCalls).toBe(plan.batches.length);
    expect(plan.drawCalls).toBeLessThanOrEqual(10);
    expect(plan.batches.flatMap((batch) => batch.positions)).toHaveLength(FIRE_TRUCK_VOXELS.length);
  });

  it('X/Z中央かつ地面Y=0へ配置する', () => {
    const plan = createVoxelRenderPlan(
      FIRE_TRUCK_VOXELS,
      FIRE_TRUCK_PALETTE_IDS,
      calculateVoxelBounds(FIRE_TRUCK_VOXELS),
      0.24,
    );

    expect(plan.offset).toEqual([0.12, -0, 0.12]);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run:

```bash
docker compose run --rm web npm test -- src/test/voxelRenderPlan.test.ts
```

Expected: FAIL。`voxelRenderPlan` が存在しない旨が表示される。

- [ ] **Step 3: pureな描画プラン生成を実装する**

`src/vehicle-lab/model/voxelRenderPlan.ts` を次の内容で作成する。

```ts
import {
  calculateModelOffset,
  groupVoxelsByPalette,
  type VoxelBounds,
  type VoxelCell,
} from './voxelModel';

export interface VoxelRenderBatch<PaletteId extends string> {
  readonly paletteId: PaletteId;
  readonly positions: readonly (readonly [number, number, number])[];
}

export interface VoxelRenderPlan<PaletteId extends string> {
  readonly batches: readonly VoxelRenderBatch<PaletteId>[];
  readonly drawCalls: number;
  readonly offset: readonly [number, number, number];
  readonly voxelCount: number;
  readonly voxelSize: number;
}

/** 検証済みセルから色別instance位置とモデル中央オフセットを作る。 */
export function createVoxelRenderPlan<PaletteId extends string>(
  cells: readonly VoxelCell<PaletteId>[],
  paletteIds: readonly PaletteId[],
  bounds: VoxelBounds,
  voxelSize: number,
): VoxelRenderPlan<PaletteId> {
  const groups = groupVoxelsByPalette(cells, paletteIds);
  const batches = [...groups.entries()].map(([paletteId, paletteCells]) => ({
    paletteId,
    positions: paletteCells.map((cell) => [
      cell.x * voxelSize,
      cell.y * voxelSize,
      cell.z * voxelSize,
    ] as const),
  }));

  return {
    batches,
    drawCalls: batches.length,
    offset: calculateModelOffset(bounds, voxelSize),
    voxelCount: cells.length,
    voxelSize,
  };
}
```

- [ ] **Step 4: 描画プランのテストを通す**

Run:

```bash
docker compose run --rm web npm test -- src/test/voxelRenderPlan.test.ts
```

Expected: 2 tests PASS。

- [ ] **Step 5: `InstancedMesh` 消防車を実装する**

`src/vehicle-lab/scene/VoxelFireTruck.tsx` を次の内容で作成する。

```tsx
import { useLayoutEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import * as THREE from 'three';
import {
  FIRE_TRUCK_PALETTE,
  FIRE_TRUCK_PALETTE_IDS,
  FIRE_TRUCK_VOXELS,
  type FireTruckPaletteId,
} from '../model/fireTruckVoxels';
import { assertValidVoxelModel, calculateVoxelBounds } from '../model/voxelModel';
import {
  createVoxelRenderPlan,
  type VoxelRenderBatch,
} from '../model/voxelRenderPlan';

const VOXEL_SIZE = 0.24;
const VOXEL_EDGE = VOXEL_SIZE * 0.94;
const VOXEL_GEOMETRY = new THREE.BoxGeometry(VOXEL_EDGE, VOXEL_EDGE, VOXEL_EDGE);

export const FIRE_TRUCK_RENDER_PLAN = createVoxelRenderPlan(
  FIRE_TRUCK_VOXELS,
  FIRE_TRUCK_PALETTE_IDS,
  calculateVoxelBounds(FIRE_TRUCK_VOXELS),
  VOXEL_SIZE,
);

interface VoxelBatchProps {
  readonly batch: VoxelRenderBatch<FireTruckPaletteId>;
}

/** 同色ボクセルを1つのInstancedMeshとして描画する。 */
function VoxelBatch({ batch }: VoxelBatchProps): ReactElement {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const material = FIRE_TRUCK_PALETTE[batch.paletteId];

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }

    const matrix = new THREE.Matrix4();
    batch.positions.forEach(([x, y, z], index) => {
      matrix.makeTranslation(x, y, z);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [batch.positions]);

  return (
    <instancedMesh
      args={[VOXEL_GEOMETRY, undefined, batch.positions.length]}
      castShadow
      dispose={null}
      receiveShadow
      ref={meshRef}
    >
      <meshStandardMaterial
        color={material.color}
        emissive={'emissive' in material ? material.emissive : undefined}
        emissiveIntensity={'emissiveIntensity' in material ? material.emissiveIntensity : 0}
        roughness={material.roughness}
      />
    </instancedMesh>
  );
}

/** 純ボクセル消防車を色別instanceバッチで描画する。 */
export function VoxelFireTruck(): ReactElement {
  assertValidVoxelModel(FIRE_TRUCK_VOXELS, FIRE_TRUCK_PALETTE_IDS);

  return (
    <group position={FIRE_TRUCK_RENDER_PLAN.offset}>
      {FIRE_TRUCK_RENDER_PLAN.batches.map((batch) => (
        <VoxelBatch batch={batch} key={batch.paletteId} />
      ))}
    </group>
  );
}
```

- [ ] **Step 6: テストと型チェック相当のビルドを実行する**

Run:

```bash
docker compose run --rm web npm test -- src/test/voxelRenderPlan.test.ts
docker compose run --rm web npm run build
```

Expected: 2 tests PASS。build SUCCESS。展示ページはまだ存在しないため既存 `index.html` だけが出力される。

- [ ] **Step 7: コミットする**

```bash
git add src/vehicle-lab/model/voxelRenderPlan.ts src/vehicle-lab/scene/VoxelFireTruck.tsx src/test/voxelRenderPlan.test.ts
git commit -m "消防車のインスタンス描画を追加"
```

---

### Task 4: 独立した消防車展示ページ

**Files:**
- Create: `vehicle-lab.html`
- Modify: `vite.config.ts`
- Create: `src/vehicle-lab/main.tsx`
- Create: `src/vehicle-lab/VehicleLabApp.tsx`
- Create: `src/vehicle-lab/styles.css`
- Create: `src/vehicle-lab/scene/VehicleShowroom.tsx`
- Modify: `src/global.d.ts`

**Interfaces:**
- Consumes: `VoxelFireTruck`、`FIRE_TRUCK_RENDER_PLAN`。
- Produces: `/vehicle-lab.html`、`VehicleLabView`、`window.render_vehicle_lab_to_text()`、`window.set_vehicle_lab_view()`。

- [ ] **Step 1: 展示ページのHTMLエントリを作る**

`vehicle-lab.html` を次の内容で作成する。

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#d7b184" />
    <link rel="icon" href="data:," />
    <title>純ボクセル消防車 | Vehicle Lab</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/vehicle-lab/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Viteの複数エントリを設定する**

`vite.config.ts` に `node:path` import と `build.rollupOptions.input` を追加し、全体を次の形にする。

```ts
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['host.docker.internal', 'web'],
  },
  build: {
    rollupOptions: {
      input: {
        game: resolve(process.cwd(), 'index.html'),
        vehicleLab: resolve(process.cwd(), 'vehicle-lab.html'),
      },
    },
  },
  test: {
    environment: 'node',
    globals: true,
  },
});
```

- [ ] **Step 3: 展示シーンを実装する**

`src/vehicle-lab/scene/VehicleShowroom.tsx` を次の内容で作成する。

```tsx
import { useEffect, useRef } from 'react';
import type { ComponentRef, ReactElement } from 'react';
import { OrbitControls, OrthographicCamera } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { VoxelFireTruck } from './VoxelFireTruck';

export type VehicleLabView = 'perspective' | 'front' | 'left' | 'back' | 'right';

interface VehicleShowroomProps {
  readonly autoRotate: boolean;
  readonly onFreeOrbit: () => void;
  readonly view: VehicleLabView;
}

const CAMERA_POSITIONS: Record<VehicleLabView, readonly [number, number, number]> = {
  perspective: [6.5, 4.8, 8],
  front: [0, 2.4, -10],
  left: [-10, 2.4, 0],
  back: [0, 2.4, 10],
  right: [10, 2.4, 0],
};

/** 固定方向ボタンとOrbitControlsを同じカメラへ同期する。 */
function CameraRig({ autoRotate, onFreeOrbit, view }: VehicleShowroomProps): ReactElement {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    if (view === 'perspective') {
      return;
    }
    const [x, y, z] = CAMERA_POSITIONS[view];
    camera.position.set(x, y, z);
    camera.lookAt(0, 0.85, 0);
    controlsRef.current?.target.set(0, 0.85, 0);
    controlsRef.current?.update();
  }, [camera, view]);

  return (
    <OrbitControls
      autoRotate={autoRotate}
      autoRotateSpeed={0.8}
      enablePan={false}
      maxZoom={110}
      minZoom={45}
      onStart={onFreeOrbit}
      ref={controlsRef}
      target={[0, 0.85, 0]}
    />
  );
}

/** rendererの実測draw callをテスト用telemetryへ記録する。 */
function RendererMetrics(): null {
  useFrame(({ camera, gl }) => {
    const telemetry = window.__vehicleLabTelemetry;
    if (!telemetry) {
      return;
    }
    window.__vehicleLabTelemetry = {
      ...telemetry,
      cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
      cameraZoom: 'zoom' in camera ? camera.zoom : 1,
      renderedFrames: telemetry.renderedFrames + 1,
      rendererCalls: gl.info.render.calls,
    };
  });
  return null;
}

/** 純ボクセル消防車、展示台、照明、カメラ操作を構成する。 */
export function VehicleShowroom({ autoRotate, onFreeOrbit, view }: VehicleShowroomProps): ReactElement {
  return (
    <>
      <color attach="background" args={['#eee9e2']} />
      <OrthographicCamera makeDefault position={[6.5, 4.8, 8]} zoom={72} />
      <CameraRig autoRotate={autoRotate} onFreeOrbit={onFreeOrbit} view={view} />
      <RendererMetrics />

      <ambientLight intensity={1.35} />
      <directionalLight castShadow intensity={2.1} position={[5, 8, 6]} shadow-mapSize={[1024, 1024]} />
      <directionalLight color="#b8d7ff" intensity={0.65} position={[-5, 3, -4]} />

      <group position={[0, 0.18, 0]}>
        <VoxelFireTruck />
      </group>

      <mesh receiveShadow position={[0, 0, 0]}>
        <boxGeometry args={[5.6, 0.34, 4.4]} />
        <meshStandardMaterial color="#b77b48" roughness={0.86} />
      </mesh>
      <mesh receiveShadow position={[0, -0.24, 0]}>
        <boxGeometry args={[200, 0.15, 200]} />
        <meshStandardMaterial color="#d8d1c8" roughness={0.95} />
      </mesh>
    </>
  );
}
```

- [ ] **Step 4: Reactアプリ、エラー境界、方向ボタン、window APIを実装する**

`src/vehicle-lab/VehicleLabApp.tsx` を次の内容で作成する。

```tsx
import { Component, useCallback, useEffect, useState } from 'react';
import type { ErrorInfo, ReactElement, ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { FIRE_TRUCK_RENDER_PLAN } from './scene/VoxelFireTruck';
import {
  VehicleShowroom,
  type VehicleLabView,
} from './scene/VehicleShowroom';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly hasError: boolean;
}

const FIXED_VIEWS: readonly { readonly id: Exclude<VehicleLabView, 'perspective'>; readonly label: string }[] = [
  { id: 'front', label: '正面' },
  { id: 'left', label: '左' },
  { id: 'back', label: '背面' },
  { id: 'right', label: '右' },
];

/** Canvas内の例外を幼児向け画面へ技術情報を漏らさず表示する。 */
class VehicleLabErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Vehicle Lab failed to render', error, errorInfo);
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return <div className="vehicle-lab-error">消防車を表示できませんでした。ページを開き直してください。</div>;
    }
    return this.props.children;
  }
}

/** 消防車の展示Canvas、説明、固定方向操作を構成する。 */
export function VehicleLabApp(): ReactElement {
  const [autoRotate, setAutoRotate] = useState(true);
  const [view, setView] = useState<VehicleLabView>('perspective');
  const handleFreeOrbit = useCallback(() => {
    setAutoRotate(false);
    setView('perspective');
  }, []);

  const selectFixedView = useCallback((nextView: Exclude<VehicleLabView, 'perspective'>) => {
    setAutoRotate(false);
    setView(nextView);
  }, []);

  useEffect(() => {
    window.__vehicleLabTelemetry = {
      cameraPosition: [6.5, 4.8, 8],
      cameraZoom: 72,
      renderedFrames: 0,
      rendererCalls: 0,
      vehicleDrawCalls: FIRE_TRUCK_RENDER_PLAN.drawCalls,
      view,
      voxelCount: FIRE_TRUCK_RENDER_PLAN.voxelCount,
    };
    window.render_vehicle_lab_to_text = () => JSON.stringify(window.__vehicleLabTelemetry);
    window.set_vehicle_lab_view = (nextView: VehicleLabView) => {
      setAutoRotate(false);
      setView(nextView);
    };

    return () => {
      delete window.__vehicleLabTelemetry;
      delete window.render_vehicle_lab_to_text;
      delete window.set_vehicle_lab_view;
    };
  }, [view]);

  return (
    <main className="vehicle-lab-shell">
      <header className="vehicle-lab-header">
        <div>
          <span className="vehicle-lab-kicker">VEHICLE LAB</span>
          <h1>純ボクセル消防車</h1>
        </div>
        <p>ドラッグで回転・ピンチまたはホイールで拡大</p>
      </header>

      <section className="vehicle-lab-canvas" aria-label="純ボクセル消防車の3D展示">
        <VehicleLabErrorBoundary>
          <Canvas
            dpr={[1, 1.75]}
            fallback={<div className="vehicle-lab-error">このブラウザでは3D表示を利用できません。</div>}
            gl={{ antialias: true, powerPreference: 'high-performance' }}
            shadows
          >
            <VehicleShowroom autoRotate={autoRotate} onFreeOrbit={handleFreeOrbit} view={view} />
          </Canvas>
        </VehicleLabErrorBoundary>
      </section>

      <footer className="vehicle-lab-footer">
        <div className="vehicle-view-buttons" aria-label="消防車を見る方向">
          {FIXED_VIEWS.map(({ id, label }) => (
            <button
              aria-pressed={view === id}
              className={view === id ? 'is-active' : undefined}
              key={id}
              onClick={() => selectFixedView(id)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <span>{FIRE_TRUCK_RENDER_PLAN.voxelCount} voxels</span>
      </footer>
    </main>
  );
}
```

- [ ] **Step 5: ReactエントリとレスポンシブCSSを書く**

`src/vehicle-lab/main.tsx` を次の内容で作成する。

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { VehicleLabApp } from './VehicleLabApp';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VehicleLabApp />
  </StrictMode>,
);
```

`src/vehicle-lab/styles.css` を次の内容で作成する。

```css
:root {
  color: #221d19;
  background: #d7b184;
  font-family: "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", system-ui, sans-serif;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
}

button {
  font: inherit;
}

.vehicle-lab-shell {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: 100%;
  height: 100%;
  background: #d7b184;
}

.vehicle-lab-header,
.vehicle-lab-footer {
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-inline:
    max(18px, env(safe-area-inset-left))
    max(18px, env(safe-area-inset-right));
  background: rgb(255 250 242 / 92%);
  backdrop-filter: blur(12px);
}

.vehicle-lab-header {
  min-height: 76px;
  padding-block: max(10px, env(safe-area-inset-top)) 10px;
  border-bottom: 1px solid rgb(77 52 35 / 14%);
}

.vehicle-lab-header h1,
.vehicle-lab-header p {
  margin: 0;
}

.vehicle-lab-header h1 {
  font-size: clamp(20px, 2.6vw, 30px);
}

.vehicle-lab-header p {
  color: #67584d;
  font-size: clamp(12px, 1.5vw, 15px);
  font-weight: 700;
}

.vehicle-lab-kicker {
  display: block;
  color: #b22c23;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: .16em;
}

.vehicle-lab-canvas {
  position: relative;
  min-width: 0;
  min-height: 0;
}

.vehicle-lab-canvas canvas {
  display: block;
  touch-action: none;
}

.vehicle-lab-footer {
  min-height: 64px;
  padding-block: 9px max(9px, env(safe-area-inset-bottom));
  border-top: 1px solid rgb(77 52 35 / 14%);
  color: #67584d;
  font-size: 12px;
  font-weight: 800;
}

.vehicle-view-buttons {
  display: flex;
  gap: 8px;
}

.vehicle-view-buttons button {
  min-width: 56px;
  min-height: 40px;
  border: 1px solid #d8c8b7;
  border-radius: 8px;
  background: #fffaf2;
  color: #332a24;
  cursor: pointer;
  font-weight: 900;
}

.vehicle-view-buttons button.is-active {
  border-color: #b22c23;
  background: #b22c23;
  color: #fff;
}

.vehicle-lab-error {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  padding: 24px;
  background: #fff3e8;
  color: #8a241e;
  font-weight: 900;
  text-align: center;
}

@media (max-height: 500px) {
  .vehicle-lab-header {
    min-height: 56px;
    padding-block: 6px;
  }

  .vehicle-lab-header p {
    max-width: 45vw;
    text-align: right;
  }

  .vehicle-lab-footer {
    min-height: 52px;
    padding-block: 6px;
  }

  .vehicle-view-buttons button {
    min-width: 52px;
    min-height: 36px;
  }
}
```

- [ ] **Step 6: window APIの型を追加する**

`src/global.d.ts` の `Window` interface へ次を追加する。

```ts
    render_vehicle_lab_to_text?: () => string;
    set_vehicle_lab_view?: (
      view: import('./vehicle-lab/scene/VehicleShowroom').VehicleLabView,
    ) => void;
    __vehicleLabTelemetry?: {
      cameraPosition: readonly [number, number, number];
      cameraZoom: number;
      renderedFrames: number;
      rendererCalls: number;
      vehicleDrawCalls: number;
      view: import('./vehicle-lab/scene/VehicleShowroom').VehicleLabView;
      voxelCount: number;
    };
```

- [ ] **Step 7: 全テストと複数エントリbuildを実行する**

Run:

```bash
docker compose run --rm web npm test
docker compose run --rm web npm run build
```

Expected: 全テストPASS。`dist/index.html` と `dist/vehicle-lab.html` が生成される。

- [ ] **Step 8: コミットする**

```bash
git add vehicle-lab.html vite.config.ts src/vehicle-lab/main.tsx src/vehicle-lab/VehicleLabApp.tsx src/vehicle-lab/styles.css src/vehicle-lab/scene/VehicleShowroom.tsx src/global.d.ts
git commit -m "消防車の独立展示ページを追加"
```

---

### Task 5: Docker化したブラウザ検証とREADME

**Files:**
- Create: `Dockerfile.e2e`
- Modify: `.dockerignore`
- Modify: `docker-compose.yml`
- Create: `scripts/verify-vehicle-lab.mjs`
- Create: `README.md`

**Interfaces:**
- Consumes: `/vehicle-lab.html`、`window.render_vehicle_lab_to_text()`、`window.set_vehicle_lab_view()`。
- Produces: `docker compose --profile e2e run --rm --build e2e`、`output/vehicle-lab/results.json`、12枚の方向別スクリーンショット。

- [ ] **Step 1: Playwright専用Dockerfileを作る**

`Dockerfile.e2e` を次の内容で作成する。

```dockerfile
FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

CMD ["node", "scripts/verify-vehicle-lab.mjs"]
```

- [ ] **Step 2: Docker build contextから生成物を除外する**

`.dockerignore` を次の内容へ更新する。

```text
node_modules
dist
output
.git
.playwright-cli
.superpowers
.DS_Store
npm-debug.log
```

- [ ] **Step 3: Composeへe2e profileを追加する**

`docker-compose.yml` の `services` に次を追加し、`volumes` に `e2e_node_modules` を追加する。

```yaml
  e2e:
    profiles: ["e2e"]
    build:
      context: .
      dockerfile: Dockerfile.e2e
    working_dir: /app
    depends_on:
      - web
    environment:
      VEHICLE_LAB_BASE_URL: http://web:5173
    volumes:
      - .:/app
      - e2e_node_modules:/app/node_modules
    command: node scripts/verify-vehicle-lab.mjs
```

```yaml
volumes:
  node_modules:
  e2e_node_modules:
```

- [ ] **Step 4: 3 viewport × 4方向の検証スクリプトを書く**

`scripts/verify-vehicle-lab.mjs` を次の内容で作成する。

```js
import fs from 'node:fs';
import { chromium } from 'playwright';

const baseUrl = process.env.VEHICLE_LAB_BASE_URL ?? 'http://web:5173';
const outputDirectory = 'output/vehicle-lab';
const targets = [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'mobile-landscape', width: 844, height: 390 },
];
const views = ['front', 'left', 'back', 'right'];

/** Vite開発サーバーが応答するまで最大30秒待つ。 */
async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/vehicle-lab.html`);
      if (response.ok) {
        return;
      }
    } catch {
      // 次の短いポーリングで再試行する。
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vehicle Lab server did not become ready: ${baseUrl}`);
}

/** R3Fへ操作結果が反映されるまで2フレーム待つ。 */
async function waitForTwoFrames(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

/** Vehicle Labが公開した実測値を取得する。 */
async function readTelemetry(page) {
  return JSON.parse(await page.evaluate(() => window.render_vehicle_lab_to_text()));
}

/** 2秒間のR3F描画フレーム増分から実効fpsを計算する。 */
async function measureRenderFps(page) {
  const before = await page.evaluate(() => ({
    capturedAt: performance.now(),
    renderedFrames: JSON.parse(window.render_vehicle_lab_to_text()).renderedFrames,
  }));
  await page.waitForTimeout(2_000);
  const after = await page.evaluate(() => ({
    capturedAt: performance.now(),
    renderedFrames: JSON.parse(window.render_vehicle_lab_to_text()).renderedFrames,
  }));
  const elapsedSeconds = (after.capturedAt - before.capturedAt) / 1_000;
  return (after.renderedFrames - before.renderedFrames) / elapsedSeconds;
}

/** 自動回転を止め、指定した固定方向へカメラを戻す。 */
async function setFixedView(page, view) {
  await page.evaluate((nextView) => window.set_vehicle_lab_view(nextView), view);
  await page.waitForFunction(
    (expectedView) => JSON.parse(window.render_vehicle_lab_to_text()).view === expectedView,
    view,
  );
  await waitForTwoFrames(page);
}

/** カメラ位置またはzoomが操作前から変化するまで待つ。 */
async function waitForCameraChange(page, before, property) {
  await page.waitForFunction(
    ({ previous, targetProperty }) => {
      const current = JSON.parse(window.render_vehicle_lab_to_text());
      if (targetProperty === 'cameraZoom') {
        return Math.abs(current.cameraZoom - previous.cameraZoom) > 0.01;
      }
      return current.cameraPosition.some(
        (value, index) => Math.abs(value - previous.cameraPosition[index]) > 0.01,
      );
    },
    { previous: before, targetProperty: property },
  );
}

/** デスクトップのドラッグ回転とホイールzoomを実測する。 */
async function verifyMouseControls(page) {
  await setFixedView(page, 'front');
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('Vehicle Lab canvas has no bounding box');
  }

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const beforeOrbit = await readTelemetry(page);
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + Math.min(100, box.width * 0.15), centerY + 32, { steps: 8 });
  await page.mouse.up();
  await waitForCameraChange(page, beforeOrbit, 'cameraPosition');

  const beforeZoom = await readTelemetry(page);
  await page.mouse.wheel(0, -500);
  await waitForCameraChange(page, beforeZoom, 'cameraZoom');
}

/** タッチ端末の1本指回転と2本指ピンチzoomを実測する。 */
async function verifyTouchControls(page) {
  await setFixedView(page, 'front');
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('Vehicle Lab canvas has no bounding box');
  }

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const client = await page.context().newCDPSession(page);

  const beforeOrbit = await readTelemetry(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: centerX, y: centerY }],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: centerX + Math.min(90, box.width * 0.14), y: centerY + 28 }],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await waitForCameraChange(page, beforeOrbit, 'cameraPosition');

  const beforeZoom = await readTelemetry(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: centerX - 30, y: centerY },
      { x: centerX + 30, y: centerY },
    ],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: centerX - 75, y: centerY },
      { x: centerX + 75, y: centerY },
    ],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await waitForCameraChange(page, beforeZoom, 'cameraZoom');
  await client.detach();
}

/** 代表viewportでレイアウト、操作、モデル統計、4方向画像を記録する。 */
async function verifyVehicleLab() {
  fs.mkdirSync(outputDirectory, { recursive: true });
  await waitForServer();

  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    for (const target of targets) {
      const page = await browser.newPage({
        hasTouch: target.name !== 'desktop',
        viewport: { height: target.height, width: target.width },
      });
      const errors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') {
          errors.push(message.text());
        }
      });
      page.on('pageerror', (error) => errors.push(String(error)));

      await page.goto(`${baseUrl}/vehicle-lab.html?verify=${Date.now()}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => typeof window.render_vehicle_lab_to_text === 'function');

      const layout = await page.evaluate(() => {
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const selectors = ['.vehicle-lab-header', '.vehicle-lab-canvas', '.vehicle-lab-footer'];
        const boxes = selectors.map((selector) => {
          const element = document.querySelector(selector);
          if (!element) {
            throw new Error(`Missing layout element: ${selector}`);
          }
          const rect = element.getBoundingClientRect();
          return {
            selector,
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            within:
              rect.left >= 0 && rect.top >= 0 &&
              rect.right <= viewport.width && rect.bottom <= viewport.height,
          };
        });
        const buttonGroup = document.querySelector('.vehicle-view-buttons');
        if (!buttonGroup) {
          throw new Error('Missing .vehicle-view-buttons');
        }
        const groupRect = buttonGroup.getBoundingClientRect();
        const buttons = [...buttonGroup.querySelectorAll('button')].map((button) => {
          const rect = button.getBoundingClientRect();
          return {
            label: button.textContent,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            withinParent:
              rect.left >= groupRect.left && rect.top >= groupRect.top &&
              rect.right <= groupRect.right && rect.bottom <= groupRect.bottom,
          };
        });
        return { viewport, boxes, buttons };
      });

      if (layout.boxes.some((box) => !box.within || box.width <= 0 || box.height <= 0)) {
        throw new Error(`Layout overflow at ${target.name}: ${JSON.stringify(layout)}`);
      }
      const [headerBox, canvasBox, footerBox] = layout.boxes;
      if (headerBox.bottom > canvasBox.top || canvasBox.bottom > footerBox.top) {
        throw new Error(`HUD overlaps canvas at ${target.name}: ${JSON.stringify(layout.boxes)}`);
      }
      if (layout.buttons.length !== 4 || layout.buttons.some((button) => !button.withinParent)) {
        throw new Error(`Direction buttons overflow at ${target.name}: ${JSON.stringify(layout.buttons)}`);
      }

      const telemetry = await readTelemetry(page);
      const loadedResources = await page.evaluate(() =>
        performance.getEntriesByType('resource').map((entry) => entry.name),
      );
      if (telemetry.voxelCount > 800) {
        throw new Error(`Voxel limit exceeded: ${telemetry.voxelCount}`);
      }
      if (telemetry.vehicleDrawCalls > 10) {
        throw new Error(`Vehicle draw call limit exceeded: ${telemetry.vehicleDrawCalls}`);
      }
      if (loadedResources.some((resourceUrl) => /rapier/i.test(resourceUrl))) {
        throw new Error(`Vehicle Lab loaded Rapier: ${loadedResources.join(' | ')}`);
      }

      const measuredFps = await measureRenderFps(page);
      const requiredFps = target.name === 'desktop' ? 60 : 30;
      if (Math.round(measuredFps) < requiredFps) {
        throw new Error(
          `Frame rate below target at ${target.name}: ${measuredFps.toFixed(1)} < ${requiredFps}`,
        );
      }

      if (target.name === 'desktop') {
        await verifyMouseControls(page);
      } else {
        await verifyTouchControls(page);
      }

      const screenshots = [];
      for (const view of views) {
        await setFixedView(page, view);
        const path = `${outputDirectory}/${target.name}-${view}.png`;
        await page.screenshot({ path, fullPage: false });
        screenshots.push(path);
      }

      results.push({
        target,
        controlsVerified: target.name === 'desktop' ? ['mouse-orbit', 'wheel-zoom'] : ['touch-orbit', 'pinch-zoom'],
        errors,
        layout,
        loadedResources,
        measuredFps,
        telemetry,
        screenshots,
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  const runtimeErrors = results.flatMap((result) => result.errors);
  fs.writeFileSync(`${outputDirectory}/results.json`, JSON.stringify(results, null, 2));
  if (runtimeErrors.length > 0) {
    throw new Error(`Browser errors detected: ${runtimeErrors.join(' | ')}`);
  }
}

await verifyVehicleLab();
```

- [ ] **Step 5: READMEへDocker起動・操作・検証方法を書く**

`README.md` を次の内容で作成する。

````markdown
# おもちゃレスキューコース

React Three FiberとThree.jsで作る、働く車のおもちゃ箱ゲームです。現在は既存ゲームに加え、本開発前のデザイン確認用として純ボクセル消防車のVehicle Labを提供します。

## 起動

ホスト環境へ依存をインストールせず、Docker Composeで起動します。

```bash
docker compose up --build web
```

- 既存ゲーム: <http://localhost:5180/>
- 純ボクセル消防車: <http://localhost:5180/vehicle-lab.html>

## Vehicle Labの操作

- マウスドラッグ／1本指ドラッグ: 消防車を回り込んで見る
- マウスホイール／ピンチ: 拡大・縮小
- 正面・左・背面・右ボタン: 固定方向へ切り替える

## 検証

```bash
docker compose run --rm web npm test
docker compose run --rm web npm run build
docker compose --profile e2e run --rm --build e2e
```

ブラウザ検証結果は `output/vehicle-lab/` に生成されます。
````

- [ ] **Step 6: Docker内で全自動検証を実行する**

Run:

```bash
docker compose run --rm web npm test
docker compose run --rm web npm run build
docker compose --profile e2e run --rm --build e2e
```

Expected:

- Vitestの全テストPASS。
- TypeScript/Vite build SUCCESS。
- `output/vehicle-lab/results.json` が生成される。
- `desktop-*`、`tablet-landscape-*`、`mobile-landscape-*` のPNGが各4枚生成される。
- `results.json` の `voxelCount <= 800`、`vehicleDrawCalls <= 10`。
- `results.json` にDesktop 60fps、タブレット・Mobile 30fps以上の実測値が記録される。
- Desktopのドラッグ／ホイール、タブレット・Mobileの1本指ドラッグ／ピンチでカメラ実測値が変化する。
- ヘッダー、Canvas、フッターが重ならず、4方向ボタンが親コンテナ境界内に収まる。
- runtime errorが0件。

- [ ] **Step 7: 生成画像を目視確認する**

次の12枚を `view_image` で開き、消防車の前後左右、欠損、はみ出し、ヘッダー・フッターとの重なりを確認する。

```text
output/vehicle-lab/desktop-front.png
output/vehicle-lab/desktop-left.png
output/vehicle-lab/desktop-back.png
output/vehicle-lab/desktop-right.png
output/vehicle-lab/tablet-landscape-front.png
output/vehicle-lab/tablet-landscape-left.png
output/vehicle-lab/tablet-landscape-back.png
output/vehicle-lab/tablet-landscape-right.png
output/vehicle-lab/mobile-landscape-front.png
output/vehicle-lab/mobile-landscape-left.png
output/vehicle-lab/mobile-landscape-back.png
output/vehicle-lab/mobile-landscape-right.png
```

Expected: すべての画像で車体全体がCanvas内に収まり、梯子、警光灯、窓、タイヤ、白ラインが確認できる。方向ボタンが親フッター境界内に収まる。

- [ ] **Step 8: 参照残りと既存ゲームのスモークを確認する**

Run:

```bash
rg -n "@react-three/rapier|RapierRigidBody|Physics" src/vehicle-lab
docker compose up --build -d web
docker compose exec web npm run build
docker compose down
```

Expected: `rg` は一致なし。`index.html` と `vehicle-lab.html` の両方がbuildされ、既存ゲームのソース参照エラーがない。ブラウザ検証の `loadedResources` にRapier由来のURLがない。

- [ ] **Step 9: 最終コミットを作る**

```bash
git add .dockerignore Dockerfile.e2e docker-compose.yml scripts/verify-vehicle-lab.mjs README.md
git commit -m "消防車展示ページのDocker検証を追加"
```

---

## 完了チェック

- [ ] `git status --short` に意図しない変更がない。
- [ ] 既存ゲームの3ファイルが変更されていない。
- [ ] 全Vitestが成功する。
- [ ] 複数HTMLエントリのbuildが成功する。
- [ ] 3 viewport × 4方向の画像を実際に目視した。
- [ ] マウスとタッチの回転・zoomをカメラ実測値で確認した。
- [ ] HUDとCanvasの非重複、方向ボタンの親境界内配置を数値で確認した。
- [ ] Desktop 60fps、タブレット・Mobile 30fps以上を記録した。
- [ ] 消防車は800ボクセル以下、車両本体は10 draw call以下である。
- [ ] Vehicle Labのimportとロード済みresourceにRapierが含まれない。
- [ ] ユーザーへVehicle LabのURLを提示し、箱庭本開発へ入る前に消防車デザインの承認を得る。

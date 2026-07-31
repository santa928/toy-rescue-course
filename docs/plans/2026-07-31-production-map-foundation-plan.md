# 72×72本番ボクセル箱庭基盤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現在の36×36消防車ゲームを、中央車庫ハブと4地区を持つ72×72の本番箱庭へ拡張し、消火・帰庫再開・積み木破壊を維持する。

**Architecture:** 静的な`ProductionWorldMapDefinition`を唯一の座標源とし、描画、Rapier collider、ゲームプレイ座標、telemetry、E2Eが同じ定義を参照する。72×72全域は常時描画し、反復直方体は色別`InstancedMesh`、static colliderは単一fixed bodyへ集約する。runtime、入力、固定方向カメラ、水・炎・破壊poolは変更しない。

**Tech Stack:** React 19、TypeScript 5.9、React Three Fiber 9、Three.js 0.181、React Three Rapier 2.2、Vitest 4、Playwright 1.59、Docker Compose

## Global Constraints

- npm、Vite、Vitest、PlaywrightはすべてDockerコンテナ内で実行する。
- 新しいnpm dependencyを追加しない。
- world boundsは`X[-36, 36]`、`Z[-36, 36]`とする。
- 車庫は`[0, 0.8, 6]`、公園は`[0, 0, -24]`、積み木広場は`[-24, 0.18, 6]`へ置く。
- 火災代表位置は`[26, 1.2, -18]`、見える炎の照準位置は`[26.9, 1.45, -16.1]`とする。
- 中央車庫から消火・破壊の既存遊びまで20〜35秒を目安にする。
- 消火判定は水平7unit・前方約60度・45/55初期接線・照準点0.55unit手前を維持する。
- 車両、入力、固定方向カメラ、HUD、水、炎、破片の既存public契約とpool数を変更しない。
- 2台目、追加ミッション、色プール、色シャワー、音、セーブ、chunk streamingは実装しない。
- 毎frameのReact state更新、配列生成、Three.js object生成を追加しない。
- 新規または実質改修する関数・型付きmoduleへ日本語docstringを付ける。
- 各Taskはテストを先に書き、Dockerで期待どおりのREDを確認してからproduction codeを変更する。
- Desktop 1280×720は物理GPU 60fps、tablet 1024×768とmobile 844×390は30fps以上を目標にする。
- Docker SwiftShaderのfpsを物理GPU性能認証に使わない。

---

## Source-of-truth layout

実装では次の表をそのまま型付き定義へ符号化する。Task間で座標を再定義しない。

### Districts

| id | label | minX | maxX | minZ | maxZ |
| --- | --- | ---: | ---: | ---: | ---: |
| `hub` | ちゅうおうしゃこ | -10 | 10 | -10 | 10 |
| `park` | こうえん | -12 | 12 | -34 | -14 |
| `fire` | かさいげんば | 14 | 34 | -20 | 6 |
| `blocks` | つみきひろば | -34 | -14 | -10 | 16 |
| `south` | じゆうそうこう | -12 | 12 | 14 | 34 |

地区矩形の間を道路が接続するため、矩形外でもworld内なら`outside`ではなく`road`を返す。
world外または非有限座標だけを`outside`とする。

### Roads

| id | position | scale | connects |
| --- | --- | --- | --- |
| `road-hub-east-west` | `[0, 0.08, 0]` | `[68, 0.18, 5]` | `blocks,hub,fire` |
| `road-hub-north-south` | `[0, 0.08, 0]` | `[5, 0.18, 68]` | `park,hub,south` |
| `road-park-north` | `[0, 0.08, -32]` | `[24, 0.18, 4]` | `park` |
| `road-park-west` | `[-10, 0.08, -24]` | `[4, 0.18, 16]` | `park` |
| `road-park-east` | `[10, 0.08, -24]` | `[4, 0.18, 16]` | `park` |
| `road-fire-east` | `[32, 0.08, -7]` | `[4, 0.18, 26]` | `fire` |
| `road-fire-north` | `[24, 0.08, -20]` | `[16, 0.18, 4]` | `fire` |
| `road-blocks-west` | `[-32, 0.08, 3]` | `[4, 0.18, 26]` | `blocks` |
| `road-blocks-south` | `[-24, 0.08, 16]` | `[16, 0.18, 4]` | `blocks` |
| `road-south-bottom` | `[0, 0.08, 32]` | `[24, 0.18, 4]` | `south` |
| `road-south-west` | `[-10, 0.08, 24]` | `[4, 0.18, 16]` | `south` |
| `road-south-east` | `[10, 0.08, 24]` | `[4, 0.18, 16]` | `south` |

道路線は各道路の長軸方向へ置き、高さ`0.19`、太さ`0.05`、短軸`0.22`とする。
交差点内で重なる線は、中央交差点の前後1.5unitを空けた2本へ分割する。

### Gameplay anchors

| id | position / box |
| --- | --- |
| `garage` | `[0, 0.8, 6]` |
| `park` | `[0, 0, -24]` |
| `block-plaza` | position `[-24, 0.18, 6]`, scale `[14, 0.34, 16]` |
| `plaza-red` | `[-26.7, 0.75, 9.5]` |
| `plaza-yellow` | `[-21.5, 0.75, 0]` |
| `plaza-blue` | `[-21.3, 0.75, 4.6]` |
| `plaza-green` | `[-26.7, 0.75, 2.5]` |
| `fire` | `[26, 1.2, -18]` |
| `fire-spray-target` | `[26.9, 1.45, -16.1]` |

### Shared visual and solid boxes

| id | position | scale | color | solid |
| --- | --- | --- | --- | --- |
| `park-ground` | `[0, 0.18, -24]` | `[20, 0.34, 16]` | `#78a94f` | no |
| `park-pond` | `[2, 0.4, -24]` | `[6, 0.18, 4]` | `#67c7df` | no |
| `tree-trunk-1` | `[-7, 1.25, -28]` | `[0.7, 2.2, 0.7]` | `#86552f` | yes |
| `tree-trunk-2` | `[-7, 1.25, -20]` | `[0.7, 2.2, 0.7]` | `#86552f` | yes |
| `tree-trunk-3` | `[7, 1.25, -20]` | `[0.7, 2.2, 0.7]` | `#86552f` | yes |
| `tree-crown-1` | `[-7, 2.85, -28]` | `[2.2, 1.4, 2.2]` | `#3f7f3a` | no |
| `tree-crown-2` | `[-7, 2.85, -20]` | `[2.2, 1.4, 2.2]` | `#3f7f3a` | no |
| `tree-crown-3` | `[7, 2.85, -20]` | `[2.2, 1.4, 2.2]` | `#3f7f3a` | no |
| `playground-plank` | `[3, 0.75, -26]` | `[3.4, 0.28, 0.7]` | `#e24b3f` | yes |
| `playground-support` | `[3, 0.45, -26]` | `[0.36, 0.8, 0.36]` | `#f2c94c` | yes |
| `garage-back-wall` | `[0, 1.8, 9.2]` | `[8.8, 3.4, 0.8]` | `#f1efe6` | yes |
| `garage-left-wall` | `[-4, 1.8, 7.2]` | `[0.8, 3.4, 4.8]` | `#f1efe6` | yes |
| `garage-right-wall` | `[4, 1.8, 7.2]` | `[0.8, 3.4, 4.8]` | `#f1efe6` | yes |
| `garage-roof` | `[0, 3.65, 7.2]` | `[8.8, 0.5, 5.2]` | `#c83e34` | no |
| `garage-header` | `[0, 3.35, 4.7]` | `[8.8, 0.45, 0.35]` | `#c83e34` | no |
| `fire-building-body` | `[23.5, 1.8, -16.5]` | `[6, 3.4, 5]` | `#a86f3f` | yes |
| `fire-building-roof` | `[23.5, 3.75, -16.5]` | `[6.8, 0.5, 5.8]` | `#6f4327` | no |
| `fire-window-1` | `[22.2, 1.9, -19.05]` | `[1.5, 1.5, 0.18]` | `#7ed1e6` | no |
| `fire-window-2` | `[24.8, 1.9, -19.05]` | `[1.5, 1.5, 0.18]` | `#7ed1e6` | no |
| `block-plaza-ground` | `[-24, 0.18, 6]` | `[14, 0.34, 16]` | `#e1c78c` | no |
| `hub-gate-post` | `[-6, 1.1, 0]` | `[0.7, 2, 0.7]` | `#c83e34` | yes |
| `south-sign-post-west` | `[-7, 1.1, 24]` | `[0.7, 2, 0.7]` | `#86552f` | yes |
| `south-sign-post-east` | `[7, 1.1, 28]` | `[0.7, 2, 0.7]` | `#86552f` | yes |
| `south-sign-board-west` | `[-7, 2.15, 24]` | `[3, 1, 0.4]` | `#f2c94c` | no |
| `south-sign-board-east` | `[7, 2.15, 28]` | `[3, 1, 0.4]` | `#e24b3f` | no |

solidは12個である。floor colliderと動的fire hazardはこの数へ含めない。

---

### Task 1: 型付き本番マップ定義と検証

**Files:**
- Create: `src/voxel-game/scene/productionWorldMap.ts`
- Create: `src/test/productionWorldMap.test.ts`

**Interfaces:**
- Produces: `WorldDistrictId`, `ResolvedWorldDistrictId`, `WorldBounds2D`, `WorldBoxDefinition`, `WorldRoadDefinition`, `ProductionWorldMapDefinition`
- Produces: `PRODUCTION_WORLD_MAP`, `resolveWorldDistrict(position)`, `validateProductionWorldMap(map)`
- Consumes: なし。React、Three.js、Rapierへ依存しないpure module。

- [ ] **Step 1: failing testでmap型と主要契約を固定する**

```ts
import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_WORLD_MAP,
  resolveWorldDistrict,
  validateProductionWorldMap,
} from '../voxel-game/scene/productionWorldMap';

describe('PRODUCTION_WORLD_MAP', () => {
  it('72×72の境界と中央ハブ＋4地区を公開する', () => {
    expect(PRODUCTION_WORLD_MAP.bounds).toEqual({
      maxX: 36, maxZ: 36, minX: -36, minZ: -36,
    });
    expect(PRODUCTION_WORLD_MAP.districts.map(({ id }) => id)).toEqual([
      'hub', 'park', 'fire', 'blocks', 'south',
    ]);
  });

  it('道路12本が中央ハブから4地区を接続する', () => {
    expect(PRODUCTION_WORLD_MAP.roads).toHaveLength(12);
    expect(new Set(PRODUCTION_WORLD_MAP.roads.flatMap(({ connects }) => connects))).toEqual(
      new Set(['hub', 'park', 'fire', 'blocks', 'south']),
    );
    expect(PRODUCTION_WORLD_MAP.roads.every(({ scale }) => (
      Math.max(scale[0], scale[2]) >= 16 && Math.min(scale[0], scale[2]) >= 4
    ))).toBe(true);
  });

  it('visualとsolidを同じbox定義で共有する', () => {
    expect(PRODUCTION_WORLD_MAP.visualBoxes).toHaveLength(25);
    expect(PRODUCTION_WORLD_MAP.visualBoxes.filter(({ solid }) => solid)).toHaveLength(12);
    expect(PRODUCTION_WORLD_MAP.visualBoxes.every(({ id }) => id.length > 0)).toBe(true);
  });

  it('地区、道路、boxのIDと数値契約を検証する', () => {
    expect(validateProductionWorldMap(PRODUCTION_WORLD_MAP)).toEqual([]);
    const duplicate = {
      ...PRODUCTION_WORLD_MAP,
      roads: [...PRODUCTION_WORLD_MAP.roads, PRODUCTION_WORLD_MAP.roads[0]],
    };
    expect(validateProductionWorldMap(duplicate)).toContain('duplicate id: road-hub-east-west');
  });

  it('地区と全boxをworld境界内へ収める', () => {
    expect(PRODUCTION_WORLD_MAP.districts.every(({ bounds }) => (
      bounds.minX >= -36 && bounds.maxX <= 36
      && bounds.minZ >= -36 && bounds.maxZ <= 36
    ))).toBe(true);
    expect(PRODUCTION_WORLD_MAP.visualBoxes.every(({ position, scale }) => (
      position[0] - scale[0] / 2 >= -36
      && position[0] + scale[0] / 2 <= 36
      && position[2] - scale[2] / 2 >= -36
      && position[2] + scale[2] / 2 <= 36
    ))).toBe(true);
  });

  it.each([
    [[0, 0.8, 6], 'hub'],
    [[0, 0, -24], 'park'],
    [[26, 1.2, -18], 'fire'],
    [[-24, 0.18, 6], 'blocks'],
    [[0, 0, 24], 'south'],
    [[12, 0, 0], 'road'],
    [[40, 0, 0], 'outside'],
    [[Number.NaN, 0, 0], 'outside'],
  ] as const)('%jを%s地区として解決する', (position, expected) => {
    expect(resolveWorldDistrict(position)).toBe(expected);
  });
});
```

- [ ] **Step 2: DockerでREDを確認する**

Run:

```bash
docker compose run --rm web npm test -- src/test/productionWorldMap.test.ts
```

Expected: `productionWorldMap`の未解決importでFAIL。

- [ ] **Step 3: pureな型とvalidatorを実装する**

```ts
export type WorldDistrictId = 'hub' | 'park' | 'fire' | 'blocks' | 'south';
export type ResolvedWorldDistrictId = WorldDistrictId | 'road' | 'outside';
export type WorldPoint = readonly [number, number, number];

export interface WorldBounds2D {
  readonly maxX: number;
  readonly maxZ: number;
  readonly minX: number;
  readonly minZ: number;
}

export interface WorldDistrictDefinition {
  readonly bounds: WorldBounds2D;
  readonly id: WorldDistrictId;
  readonly label: string;
}

export interface WorldBoxDefinition {
  readonly color: string;
  readonly id: string;
  readonly position: WorldPoint;
  readonly rotation?: WorldPoint;
  readonly scale: WorldPoint;
  readonly solid: boolean;
}

export interface WorldRoadDefinition {
  readonly connects: readonly WorldDistrictId[];
  readonly id: string;
  readonly position: WorldPoint;
  readonly scale: WorldPoint;
}

export interface ProductionWorldMapDefinition {
  readonly bounds: WorldBounds2D;
  readonly districts: readonly WorldDistrictDefinition[];
  readonly roads: readonly WorldRoadDefinition[];
  readonly visualBoxes: readonly WorldBoxDefinition[];
}
```

`PRODUCTION_WORLD_MAP`へSource-of-truth layoutのdistrict、road、visual/solid表を正確に入力する。
配列順は表の順を維持し、`as const satisfies ProductionWorldMapDefinition`で型を固定する。

`validateProductionWorldMap()`は次の順でエラー文字列を返す。

```ts
export function validateProductionWorldMap(
  map: ProductionWorldMapDefinition,
): readonly string[] {
  const errors: string[] = [];
  const ids = [
    ...map.districts.map(({ id }) => id),
    ...map.roads.map(({ id }) => id),
    ...map.visualBoxes.map(({ id }) => id),
  ];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`duplicate id: ${id}`);
    seen.add(id);
  }
  for (const box of [...map.roads, ...map.visualBoxes]) {
    if (!box.position.every(Number.isFinite)) errors.push(`non-finite position: ${box.id}`);
    if (!box.scale.every((value) => Number.isFinite(value) && value > 0)) {
      errors.push(`invalid scale: ${box.id}`);
    }
    if (
      box.position[0] - box.scale[0] / 2 < map.bounds.minX
      || box.position[0] + box.scale[0] / 2 > map.bounds.maxX
      || box.position[2] - box.scale[2] / 2 < map.bounds.minZ
      || box.position[2] + box.scale[2] / 2 > map.bounds.maxZ
    ) {
      errors.push(`outside world bounds: ${box.id}`);
    }
  }
  return errors;
}
```

`resolveWorldDistrict()`はworld外/非有限→`outside`、district矩形内→そのID、
いずれかの道路矩形内→`road`、それ以外のworld内→`road`の順で返す。

- [ ] **Step 4: focused testをGREENにする**

Run:

```bash
docker compose run --rm web npm test -- src/test/productionWorldMap.test.ts
```

Expected: 1 file / 6 tests PASS。

- [ ] **Step 5: 全unitとbuildを確認する**

Run:

```bash
docker compose run --rm web npm test
docker compose run --rm web npm run build
```

Expected: 既存154 tests＋新規6 tests PASS、3 HTML entry build PASS。既知の500kB超chunk warning以外の新規warning/errorなし。

- [ ] **Step 6: 日本語コミット**

```bash
git add src/voxel-game/scene/productionWorldMap.ts src/test/productionWorldMap.test.ts
git commit -m "本番マップの型付き定義を追加する"
```

---

### Task 2: ゲームプレイ座標とVFXを本番地区へ移す

**Files:**
- Modify: `src/voxel-game/scene/worldLayout.ts`
- Modify: `src/voxel-game/scene/WaterAndFire.tsx`
- Modify: `src/test/worldLayout.test.ts`
- Modify: `src/test/waterAndFire.test.ts`
- Modify: `src/test/breakableBlockPlaza.test.ts`

**Interfaces:**
- Consumes: `PRODUCTION_WORLD_MAP`, `resolveWorldDistrict()` from Task 1
- Produces: 既存export `WORLD_BOUNDS`, `GARAGE_POSITION`, `FIRE_POSITION`, `FIRE_SPRAY_TARGET_POSITION`, `PARK_CENTER`, `BLOCK_PLAZA`, `BREAKABLE_BLOCKS`
- Produces: `WORLD_DISTRICTS`, `resolveVehicleDistrict(position)`
- Maintains: `ROUTE_BOXES`, `FIRE_HAZARD_BOX`, `FIRE_LAYER_POSITIONS`, `CELEBRATION_STAR_CENTERS`

- [ ] **Step 1: world layoutの期待値を先に72×72へ変更する**

`src/test/worldLayout.test.ts`の既存36×36 testを次へ置換する。

```ts
it('72×72本番境界内へ中央ハブと既存遊びを置く', () => {
  expect(WORLD_BOUNDS).toEqual({ maxX: 36, maxZ: 36, minX: -36, minZ: -36 });
  expect(GARAGE_POSITION).toEqual([0, 0.8, 6]);
  expect(PARK_CENTER).toEqual([0, 0, -24]);
  expect(BLOCK_PLAZA).toEqual({
    position: [-24, 0.18, 6],
    scale: [14, 0.34, 16],
  });
  expect(FIRE_POSITION).toEqual([26, 1.2, -18]);
  expect(FIRE_SPRAY_TARGET_POSITION).toEqual([26.9, 1.45, -16.1]);
  expect(BREAKABLE_BLOCKS.map(({ position }) => position)).toEqual([
    [-26.7, 0.75, 9.5],
    [-21.5, 0.75, 0],
    [-21.3, 0.75, 4.6],
    [-26.7, 0.75, 2.5],
  ]);
});

it('車両位置を本番地区へ解決する', () => {
  expect(resolveVehicleDistrict(GARAGE_POSITION)).toBe('hub');
  expect(resolveVehicleDistrict(PARK_CENTER)).toBe('park');
  expect(resolveVehicleDistrict(FIRE_POSITION)).toBe('fire');
  expect(resolveVehicleDistrict(BLOCK_PLAZA.position)).toBe('blocks');
  expect(resolveVehicleDistrict([0, 0, 24])).toBe('south');
  expect(resolveVehicleDistrict([12, 0, 0])).toBe('road');
});
```

既存の帰庫半径3、積み木ID一意、block間clearance testは座標だけ新しい値へ合わせて維持する。

- [ ] **Step 2: Water/Fireの移設契約を先にtestへ書く**

`src/test/waterAndFire.test.ts`で次を期待する。

```ts
  it('本番火災地区へhazardと3層の炎を同じ相対形状で移す', () => {
  expect(FIRE_HAZARD_BOX).toEqual({
    position: [26.9, 0.9, -16.1],
    scale: [1.2, 1.8, 1.2],
  });
  expect(FIRE_LAYER_POSITIONS).toEqual([
    [26.9, 0.75, -16.1],
    [26.95, 1.5, -16.02],
    [26.9, 2.15, -16.1],
  ]);
});

it('中央車庫から東の火災地区へ12個の非solid道しるべを置く', () => {
  expect(ROUTE_BOXES.map(({ position }) => position)).toEqual([
    [0, 0.26, 3], [0, 0.26, 0], [4, 0.26, 0], [8, 0.26, 0],
    [12, 0.26, 0], [16, 0.26, 0], [20, 0.26, 0], [24, 0.26, 0],
    [28, 0.26, 0], [30, 0.26, -4], [30, 0.26, -8], [28, 0.26, -13],
  ]);
  expect(ROUTE_BOXES.every(({ scale }) => scale[1] <= 0.14)).toBe(true);
});
```

既存の寛容な照準integration fixtureは次の新座標へ変更する。

```ts
const forgivingVehicle = {
  forward: [0, 0, -1],
  mass: 1.4,
  position: [29.5, 0.8, -10.2],
  resetCount: 0,
  speed: 0,
} as const;
const outsideVehicle = {
  ...forgivingVehicle,
  position: [29.5, 0.8, -9],
} as const;
const behindVehicle = {
  ...forgivingVehicle,
  forward: [0, 0, 1],
} as const;
```

成功星は次の絶対座標へ移し、6組×5cubeを維持する。

```ts
expect(CELEBRATION_STAR_CENTERS).toEqual([
  [24.8, 1, -11],
  [22.5, 1.2, -11.4],
  [31, 1, -11.8],
  [24, 1.8, -12.2],
  [31.25, 3, -15],
  [28.8, 1.7, -13],
]);
```

- [ ] **Step 3: DockerでREDを確認する**

Run:

```bash
docker compose run --rm web npm test -- src/test/worldLayout.test.ts src/test/waterAndFire.test.ts src/test/breakableBlockPlaza.test.ts
```

Expected: 旧座標、旧境界、旧道しるべでassertion FAIL。

- [ ] **Step 4: worldLayoutをmap定義の互換exportへ変更する**

```ts
import {
  PRODUCTION_WORLD_MAP,
  resolveWorldDistrict,
  type ResolvedWorldDistrictId,
} from './productionWorldMap';

export const WORLD_BOUNDS = PRODUCTION_WORLD_MAP.bounds;
export const GARAGE_POSITION = [0, 0.8, 6] as const;
export const GARAGE_RESTART_RADIUS = 3;
export const FIRE_POSITION = [26, 1.2, -18] as const;
export const FIRE_SPRAY_TARGET_POSITION = [26.9, 1.45, -16.1] as const;
export const PARK_CENTER = [0, 0, -24] as const;
export const BLOCK_PLAZA = {
  position: [-24, 0.18, 6] as const,
  scale: [14, 0.34, 16] as const,
} as const;

/** 車両world座標を本番地区IDへ解決する。 */
export function resolveVehicleDistrict(
  position: readonly [number, number, number],
): ResolvedWorldDistrictId {
  return resolveWorldDistrict(position);
}
```

`BREAKABLE_BLOCKS`はGameplay anchors表の4座標へ変更し、色・ID・順序は変えない。
`isInsideGarageRestartArea()`の実装は変更せず、新しい`GARAGE_POSITION`を使わせる。

- [ ] **Step 5: WaterAndFireの固定配置だけを移す**

`ROUTE_POSITIONS`、`FIRE_HAZARD_BOX`、`FIRE_LAYER_POSITIONS`、
`CELEBRATION_STAR_CENTERS`をStep 2の期待値へ変更する。
水流計算、fire VFX slot、消火時間、fire collider lifecycleは変更しない。

- [ ] **Step 6: focused testをGREENにする**

Run:

```bash
docker compose run --rm web npm test -- src/test/worldLayout.test.ts src/test/waterAndFire.test.ts src/test/breakableBlockPlaza.test.ts
```

Expected: focused tests PASS。

- [ ] **Step 7: 全unitとbuildを確認する**

Run:

```bash
docker compose run --rm web npm test
docker compose run --rm web npm run build
```

Expected: 全testと3 entry build PASS。E2Eは旧経路のためまだ実行しない。

- [ ] **Step 8: 日本語コミット**

```bash
git add src/voxel-game/scene/worldLayout.ts src/voxel-game/scene/WaterAndFire.tsx \
  src/test/worldLayout.test.ts src/test/waterAndFire.test.ts src/test/breakableBlockPlaza.test.ts
git commit -m "本番地区へゲームプレイ座標を移す"
```

---

### Task 3: 72×72の描画と共有solid物理を接続する

**Files:**
- Modify: `src/voxel-game/scene/VoxelWorld.tsx`
- Modify: `src/voxel-game/scene/worldCollisionLayout.ts`
- Modify: `src/voxel-game/scene/VoxelGameScene.tsx`
- Modify: `src/test/worldCollisionLayout.test.ts`
- Create: `src/test/productionWorldRender.test.ts`

**Interfaces:**
- Consumes: `PRODUCTION_WORLD_MAP.visualBoxes`, `.roads`, `.bounds`
- Produces: `WORLD_SOLID_BOXES` as the 12 shared `solid:true` boxes
- Maintains: `BoxDefinition`, `scaleToHalfExtents()`, `WorldSolidColliders`, `VoxelWorld`

- [ ] **Step 1: 共有solidとrenderer構成のfailing testを書く**

`src/test/worldCollisionLayout.test.ts`の旧9 collider期待を次へ変更する。

```ts
it('本番mapのsolid:trueだけを12個のstatic colliderとして公開する', () => {
  expect(WORLD_SOLID_BOXES.map(({ id }) => id)).toEqual([
    'tree-trunk-1',
    'tree-trunk-2',
    'tree-trunk-3',
    'playground-plank',
    'playground-support',
    'garage-back-wall',
    'garage-left-wall',
    'garage-right-wall',
    'fire-building-body',
    'hub-gate-post',
    'south-sign-post-west',
    'south-sign-post-east',
  ]);
  expect(WORLD_SOLID_BOXES).toEqual(
    PRODUCTION_WORLD_MAP.visualBoxes.filter(({ solid }) => solid),
  );
});
```

`src/test/productionWorldRender.test.ts`を追加する。

```ts
import { Children, isValidElement } from 'react';
import { describe, expect, it } from 'vitest';
import { VoxelWorld, WorldSolidColliders } from '../voxel-game/scene/VoxelWorld';
import { PRODUCTION_WORLD_MAP } from '../voxel-game/scene/productionWorldMap';

describe('production world render', () => {
  it('72×72 floor、道路、visual batch、solid layerを各1回だけ接続する', () => {
    const world = VoxelWorld();
    expect(world.type).toBe('group');
    const children = Children.toArray(world.props.children);
    expect(children.filter(
      (child) => isValidElement(child) && child.type === WorldSolidColliders,
    )).toHaveLength(1);
    expect(PRODUCTION_WORLD_MAP.roads).toHaveLength(12);
    expect(PRODUCTION_WORLD_MAP.visualBoxes).toHaveLength(25);
  });
});
```

- [ ] **Step 2: ground colliderのfailing integration testを書く**

`src/test/worldCollisionLayout.test.ts`へ追加する。

```ts
it('72×72 groundを±36境界と同じhalf extentsで構成する', () => {
  expect(WORLD_GROUND_BOX).toEqual({
    position: [0, -0.2, 0],
    scale: [72, 0.4, 72],
  });
  expect(scaleToHalfExtents(WORLD_GROUND_BOX.scale)).toEqual([36, 0.2, 36]);
});
```

既存の車庫clearance testは、北向きの正面開口へ合わせて退出中心を
`[0, GARAGE_POSITION[1], 2.7]`へ変更する。初期位置と3壁が非重複であり、
退出中心が左右壁のZ外形から0より大きく離れることを維持する。

- [ ] **Step 3: DockerでREDを確認する**

Run:

```bash
docker compose run --rm web npm test -- src/test/worldCollisionLayout.test.ts src/test/productionWorldRender.test.ts
```

Expected: 旧9 collider、36×36 floor、未定義`WORLD_GROUND_BOX`でFAIL。

- [ ] **Step 4: collision layoutをmap定義のfilterへ変更する**

`worldCollisionLayout.ts`は型の重複定義を止め、Task 1の型を再exportする。

```ts
import { PRODUCTION_WORLD_MAP, type WorldBoxDefinition } from './productionWorldMap';

export type BoxDefinition = Omit<WorldBoxDefinition, 'color' | 'solid'>;
export const WORLD_SOLID_BOXES = PRODUCTION_WORLD_MAP.visualBoxes.filter(({ solid }) => solid);
export const WORLD_GROUND_BOX = {
  position: [0, -0.2, 0] as const,
  scale: [72, 0.4, 72] as const,
};
```

`TREE_TRUNKS`、`FIRE_BUILDING_BODY`、`GARAGE_WALLS`、`PLAYGROUND_PLANK`、
`PLAYGROUND_SUPPORT`は`WORLD_SOLID_BOXES`からIDで導出する互換exportとして維持する。
ID欠落を`undefined`へ落とさず、module初期化時に明示errorを投げる`requireSolidBox(id)`を使う。

```ts
/** 一意なsolid定義をIDで取得し、欠落時は起動を停止する。 */
function requireSolidBox(id: string): WorldBoxDefinition {
  const box = WORLD_SOLID_BOXES.find((candidate) => candidate.id === id);
  if (!box) throw new Error(`Missing production world solid: ${id}`);
  return box;
}
```

- [ ] **Step 5: VoxelWorldを色別batchへ置き換える**

`VoxelWorld.tsx`では旧`ROAD_SEGMENTS`、`ROAD_LINES`、各地区の直書きmeshを削除し、
次のpure group helperを追加する。

```ts
/** boxをmaterial色ごとの安定したbatchへまとめる。 */
export function groupWorldBoxesByColor(
  boxes: readonly WorldBoxDefinition[],
): readonly { readonly boxes: readonly WorldBoxDefinition[]; readonly color: string }[] {
  const groups = new Map<string, WorldBoxDefinition[]>();
  for (const box of boxes) {
    const group = groups.get(box.color) ?? [];
    group.push(box);
    groups.set(box.color, group);
  }
  return [...groups.entries()].map(([color, groupedBoxes]) => ({
    boxes: groupedBoxes,
    color,
  }));
}
```

render treeは次へ統一する。

```tsx
<group>
  <mesh position={WORLD_GROUND_BOX.position}>
    <boxGeometry args={WORLD_GROUND_BOX.scale} />
    <meshLambertMaterial color="#d7b07a" />
  </mesh>
  <InstancedBoxes boxes={PRODUCTION_WORLD_MAP.roads} color="#3f4248" />
  <InstancedBoxes boxes={ROAD_MARKING_BOXES} color="#f0c94a" />
  {groupWorldBoxesByColor(PRODUCTION_WORLD_MAP.visualBoxes).map(({ boxes, color }) => (
    <InstancedBoxes boxes={boxes} color={color} key={color} />
  ))}
  <WorldSolidColliders />
</group>
```

`ROAD_MARKING_BOXES`はSource-of-truthの道路長軸を使ってmodule初期化時に1回作る。
中央交差点だけは東西線と南北線をそれぞれ2本に分け、交差点中央3unitを空ける。

- [ ] **Step 6: VoxelGameSceneのground colliderを共有定義へ接続する**

```tsx
<RigidBody colliders={false} type="fixed">
  <CuboidCollider
    args={scaleToHalfExtents(WORLD_GROUND_BOX.scale)}
    position={WORLD_GROUND_BOX.position}
  />
</RigidBody>
```

36×36の`args={[18, 0.2, 18]}`直書きを削除する。

- [ ] **Step 7: focused testをGREENにする**

Run:

```bash
docker compose run --rm web npm test -- src/test/productionWorldMap.test.ts \
  src/test/worldCollisionLayout.test.ts src/test/productionWorldRender.test.ts
```

Expected: focused tests PASS。`WORLD_SOLID_BOXES`12、ground half extents 36を確認。

- [ ] **Step 8: 全unitとbuildを確認する**

Run:

```bash
docker compose run --rm web npm test
docker compose run --rm web npm run build
```

Expected: 全testと3 entry build PASS。既知chunk warning以外の新規warning/errorなし。

- [ ] **Step 9: 日本語コミット**

```bash
git add src/voxel-game/scene/productionWorldMap.ts src/voxel-game/scene/VoxelWorld.tsx \
  src/voxel-game/scene/worldCollisionLayout.ts src/voxel-game/scene/VoxelGameScene.tsx \
  src/test/productionWorldMap.test.ts src/test/worldCollisionLayout.test.ts \
  src/test/productionWorldRender.test.ts
git commit -m "72×72箱庭の描画と物理を接続する"
```

---

### Task 4: 地区telemetryと本番マップE2Eを追加する

**Files:**
- Modify: `src/global.d.ts`
- Modify: `src/voxel-game/VoxelGameApp.tsx`
- Modify: `src/test/voxelGameRenderTelemetry.test.ts`
- Modify: `scripts/verify-voxel-game.mjs`
- Modify: `scripts/verify-voxel-game-task6.mjs`
- Modify: `scripts/verify-voxel-game-task7.mjs`

**Interfaces:**
- Consumes: `resolveVehicleDistrict()`, `PRODUCTION_WORLD_MAP`
- Produces: `VoxelGameTextState.world`
- Produces: `buildWorldTelemetry(vehiclePosition)`
- Produces E2E focus: `VOXEL_GAME_FOCUS=production-map`

- [ ] **Step 1: pure telemetryのfailing testを書く**

`src/test/voxelGameRenderTelemetry.test.ts`へ追加する。

```ts
import { buildWorldTelemetry } from '../voxel-game/VoxelGameApp';

it('現在地区、目的地区、bounds、地区一覧を公開する', () => {
  expect(buildWorldTelemetry([0, 0.8, 6])).toEqual({
    bounds: { maxX: 36, maxZ: 36, minX: -36, minZ: -36 },
    currentDistrict: 'hub',
    destinationDistrict: 'fire',
    districts: [
      { id: 'hub', label: 'ちゅうおうしゃこ' },
      { id: 'park', label: 'こうえん' },
      { id: 'fire', label: 'かさいげんば' },
      { id: 'blocks', label: 'つみきひろば' },
      { id: 'south', label: 'じゆうそうこう' },
    ],
  });
});
```

- [ ] **Step 2: Dockerでtelemetry REDを確認する**

Run:

```bash
docker compose run --rm web npm test -- src/test/voxelGameRenderTelemetry.test.ts
```

Expected: `buildWorldTelemetry`未定義でFAIL。

- [ ] **Step 3: text-stateへworld契約を追加する**

`src/global.d.ts`へ次を追加する。

```ts
readonly world: {
  readonly bounds: import('./voxel-game/scene/productionWorldMap').WorldBounds2D;
  readonly currentDistrict:
    import('./voxel-game/scene/productionWorldMap').ResolvedWorldDistrictId;
  readonly destinationDistrict: 'fire';
  readonly districts: readonly {
    readonly id: import('./voxel-game/scene/productionWorldMap').WorldDistrictId;
    readonly label: string;
  }[];
};
```

既存`coordinateSystem` literalは中央化後の意味へ合わせて次へ変更する。

```ts
readonly coordinateSystem: 'origin=world-center, +x=east, +y=up, +z=south';
```

`VoxelGameApp.tsx`へpure helperを追加する。

```ts
/** 車両位置と静的map定義からE2E向けの簡潔なworld状態を返す。 */
export function buildWorldTelemetry(
  vehiclePosition: readonly [number, number, number],
): VoxelGameTextState['world'] {
  return {
    bounds: PRODUCTION_WORLD_MAP.bounds,
    currentDistrict: resolveVehicleDistrict(vehiclePosition),
    destinationDistrict: 'fire',
    districts: PRODUCTION_WORLD_MAP.districts.map(({ id, label }) => ({ id, label })),
  };
}
```

`render_game_to_text()`のpayloadへ`world: buildWorldTelemetry(vehicle.position)`を追加し、
既存`worldBounds`は互換のため残す。`visualLayout`へ次を追加する。

```ts
worldSolids: WORLD_SOLID_BOXES.map(({ id, position, rotation, scale }) => ({
  id, position, rotation, scale,
})),
```

payloadの`coordinateSystem`も
`origin=world-center, +x=east, +y=up, +z=south`へ変更する。

- [ ] **Step 4: telemetry testをGREENにする**

Run:

```bash
docker compose run --rm web npm test -- src/test/voxelGameRenderTelemetry.test.ts
```

Expected: focused tests PASS。

- [ ] **Step 5: canonical E2Eへproduction-map focusを先に追加してREDを確認する**

`supportedFocusModes`へ`production-map`を追加し、`verifyProductionMap()`を次の契約で作る。

```js
async function verifyProductionMap(browser, errors) {
  const { context, page } = await openViewportPage(
    browser,
    { hasTouch: false, height: 720, name: 'production-map', width: 1_280 },
    errors,
  );
  try {
    const initial = await readGameState(page);
    assert.deepEqual(initial.world.bounds, {
      maxX: 36, maxZ: 36, minX: -36, minZ: -36,
    });
    assert.equal(initial.world.currentDistrict, 'hub');
    assert.equal(initial.world.destinationDistrict, 'fire');
    assert.equal(initial.visualLayout.worldSolids.length, 12);
    return { initial: initial.world };
  } finally {
    await context.close();
  }
}
```

focus branchは`output/voxel-game/focus/production-map/production-map.json`と次の5画像を生成する。

- `desktop-production-hub.png`
- `desktop-production-park.png`
- `desktop-production-fire.png`
- `desktop-production-blocks.png`
- `desktop-production-south.png`

Run:

```bash
docker compose --profile e2e run --rm --build \
  -e VOXEL_GAME_FOCUS=production-map voxel-game-e2e
```

Expected: E2Eが旧経路または不足画像でFAILし、map拡張がまだブラウザ契約を満たさないことを確認。

- [ ] **Step 6: E2Eの座標重複をtelemetry参照へ置き換える**

`scripts/verify-voxel-game.mjs`の次を削除する。

- 固定`FIRE_SPRAY_TARGET_POSITION`
- 固定`COLLISION_OBSTACLES`
- 固定`FIRE_HAZARD_BOX`
- 車庫`z=14/16.3/17.8`
- 火災`x=15.7/z=-9.1`
- 積み木広場の旧経路

代わりに`readGameState()`から次を取得する。

```js
const garage = state.landmarks.garage;
const fire = state.landmarks.fire;
const target = state.landmarks.fireSprayTarget;
const blocks = state.landmarks.breakableBlocks;
const solids = state.visualLayout.worldSolids;
```

`landmarks.fireSprayTarget`を`VoxelGameTextState`と`VoxelGameApp`へ追加する。
車庫退出は`z <= 3`、火災接近は東幹線`x >= 28`から北へ`z <= -13`、
帰庫は中央幹線を西へ`x <= 2`、南へ`z >= 6`の順に変更する。
積み木地区は中央幹線を西へ`x <= -20`として各block座標へ接近する。

`verifyProductionMap()`は実入力でhub→park→hub→south→hubを走り、
各到着時の`world.currentDistrict`を順に`park/hub/south/hub`と確認する。
fireとblocksは既存mission/break scenarioの実走結果を再利用する。
各地区への走行開始から到着までのwall-clock秒を結果へ保存し、最適な自動走行でも
35秒を超えないことをassertする。20秒の下限は幼児操作の目安なので自動走行では
強制せず、道路距離と目視密度を記録する。

- [ ] **Step 7: legacy Task 6/7 E2Eを新telemetryへ追従させる**

`verify-voxel-game-task6.mjs`は固定`BLOCK_PLAZA_BOUNDS`を削除し、
`state.landmarks.blockPlaza`のposition/scaleから境界を計算する。
garage exitとblock approachはStep 6の新経路へ更新する。

`verify-voxel-game-task7.mjs`は完成版keyへ`world`を追加し、
`coordinateSystem === 'origin=world-center, +x=east, +y=up, +z=south'`、
HUD境界、fullscreen、visibility lifecycleを維持する。
Task 7は地区移動を行わないため、初期`world.currentDistrict === 'hub'`だけを追加確認する。

- [ ] **Step 8: focused E2EをGREENにする**

Run:

```bash
docker compose --profile e2e run --rm --build \
  -e VOXEL_GAME_FOCUS=production-map voxel-game-e2e
docker compose --profile e2e run --rm --build \
  -e VOXEL_GAME_FOCUS=nonbreak voxel-game-e2e
docker compose --profile e2e run --rm --build \
  -e VOXEL_GAME_FOCUS=collision voxel-game-e2e
```

Expected:

- production-map: 5地区画像、world telemetry、各地区35秒以内、errors 0。
- nonbreak: PC/touch消火、帰庫再開、3 viewport、water timeline PASS。
- collision: 代表solid、fire lifecycle、route marker pass-through PASS。

- [ ] **Step 9: focused画像4枚を目視する**

`view_image`で4枚をoriginal detailで開き、次を確認する。

- 車庫ハブから東西南北の道路が読める。
- 公園、火災建物、積み木広場が道路と接続している。
- 広い空白が画面の過半を占めない。
- 車両、ランドマーク、HUDが欠けない。
- 見た目上のsolidと通過可能装飾が世界観辞書に合う。

- [ ] **Step 10: 全unitとbuildを確認する**

Run:

```bash
docker compose run --rm web npm test
docker compose run --rm web npm run build
```

Expected: 全testと3 entry build PASS。

- [ ] **Step 11: 日本語コミット**

```bash
git add src/global.d.ts src/voxel-game/VoxelGameApp.tsx \
  src/test/voxelGameRenderTelemetry.test.ts scripts/verify-voxel-game.mjs \
  scripts/verify-voxel-game-task6.mjs scripts/verify-voxel-game-task7.mjs
git commit -m "本番マップのtelemetryと実走検証を追加する"
```

---

### Task 5: フルrelease検証、文書、最終レビュー

**Files:**
- Modify: `README.md`
- Modify: `progress.md`（git管理外の作業記録）
- Modify: `docs/design/2026-07-31-production-map-foundation-design.md`（実装結果追記が必要な場合のみ）
- Test artifacts: `output/voxel-game/`

**Interfaces:**
- Consumes: Task 1〜4の完成状態
- Produces: fresh unit/build/E2E evidence、28枚以上の代表画像、completed manifest

- [ ] **Step 1: READMEのfailing documentation checkを行う**

Run:

```bash
rg -n -- '72×72|中央車庫|北の公園|東の火災|西の積み木|南の自由走行' README.md
```

Expected: 必要な本番マップ説明が不足し、0件または一部だけ検出。

- [ ] **Step 2: READMEを現在の操作可能性へ合わせる**

「ゲームの操作」直前へ次を追加する。

```markdown
## 本番箱庭

72×72相当の机上箱庭を、中央の消防車庫、北の公園、東の火災現場、
西の積み木広場、南の自由走行地区で構成しています。中央の道路から
各地区へ寄り道でき、消防車の消火と積み木破壊を同じ1枚続きの世界で遊べます。
```

「箱庭の物理対象」へ南地区の標識postとhub gate postをsolidとして追加する。
2台目、追加ミッション、色プールが現在遊べるような文言は追加しない。

- [ ] **Step 3: fresh full E2Eを実行する**

Run:

```bash
docker compose --profile e2e run --rm --build voxel-game-e2e
```

Expected:

- `output/voxel-game/run-manifest.json`: `status: completed`, `mode: full`
- console/page/request errors: `0/0/0`
- contract failures: `0`
- PC keyboardとmobile touchで消火→freeRoam→実走帰庫→再開
- 全4色block破壊・pool identity・安全復元
- 12 static solid共有契約、fire hazard lifecycle、route marker非solid
- production-mapのhub/park/fire/blocks画像
- Desktop/tablet/mobileのHUD境界、Canvas、fullscreen、visibility cleanup

- [ ] **Step 4: Vehicle Lab回帰を実行する**

Run:

```bash
docker compose --profile e2e run --rm --build e2e
```

Expected: Vehicle Lab 3 viewport、固定4方向、自由視点、zoom、console/page/request errors 0。

- [ ] **Step 5: unitとPages base buildをfresh実行する**

Run:

```bash
docker compose run --rm web npm test
docker compose run --rm web npm run build -- --base=/toy-rescue-course/
```

Expected:

- 全unit PASS。
- `index.html`、`voxel-game.html`、`vehicle-lab.html`を生成。
- asset URLが`/toy-rescue-course/assets/`を使う。
- 既知500kB超chunk warning以外の新規warning/errorなし。

- [ ] **Step 6: 全代表画像を目視する**

最低限、次を`view_image`でoriginal detail確認する。

- `desktop-production-hub.png`
- `desktop-production-park.png`
- `desktop-production-fire.png`
- `desktop-production-blocks.png`
- `desktop-production-south.png`
- `desktop-driving.png`
- `desktop-water-fire.png`
- `desktop-block-broken.png`
- `desktop-complete.png`
- `tablet-landscape-driving.png`
- `tablet-landscape-water-fire.png`
- `mobile-landscape-driving.png`
- `mobile-landscape-water-fire.png`

各画像で車両全体、道路接続、地区密度、目的地、HUD、炎、水、破片、星、
重なり、はみ出し、意図しない空白を確認する。

- [ ] **Step 7: manifestと成果物数を数値確認する**

Run:

```bash
jq '{status, mode, error}' output/voxel-game/run-manifest.json
jq '{errorCounts, contractFailures, environmentConcerns}' output/voxel-game/results.json
find output/voxel-game -maxdepth 1 -name '*.png' | wc -l
```

Expected: completed/full、error null、errors 0/0/0、contract failures空配列、PNG 33枚以上。

- [ ] **Step 8: 物理GPU性能を再認証する**

Docker外のnpm/nodeは使わず、既存の物理GPU対応ブラウザ検証経路で同じ3 viewportを測る。
認証結果はrenderer名、renderer class、平均fps、threshold、certifiedを記録する。
物理GPUが利用できない場合はSwiftShader値を参考として残し、未認証を明記する。

- [ ] **Step 9: progress.mdへ実装結果と残件を追記する**

追記項目:

- Original prompt continuation: モックを増やさずAの72×72本番マップ基盤を実装。
- Task 1〜4のcommit SHA。
- unit/build/E2Eのfresh結果。
- 代表画像の目視結果。
- rendererと物理GPU認証結果。
- 既知の500kB超chunk warning。
- 次候補: 2台目の働く車＋車種別ミッション。

- [ ] **Step 10: 参照残りと差分を自己レビューする**

Run:

```bash
rg -n -- 'maxX: 18|maxZ: 18|minX: -18|minZ: -18|36×36|12\\.9, 1\\.45, -9\\.1|\\[0, 0\\.8, 14\\]' \
  src scripts README.md
git diff --check
git status -sb
```

Expected: 旧座標の意図しない参照0件。テストfixtureや履歴説明に残す場合は行ごとに理由を確認する。

- [ ] **Step 11: 最終日本語コミット**

```bash
git add README.md docs/design/2026-07-31-production-map-foundation-design.md
git commit -m "72×72本番箱庭の検証結果を記録する"
```

`docs/design`に実装結果追記が不要でREADMEだけの場合はREADMEのみstageする。
`progress.md`と`output/`はgit管理しない。

- [ ] **Step 12: 完了前検証**

次のすべてがfreshに成立するまで完了扱いにしない。

- unit PASS
- Pages base production build PASS
- Voxel Game full E2E completed/full
- Vehicle Lab E2E PASS
- 代表12画像以上を目視
- console/page/request errors 0/0/0
- contract failures 0
- local worktree clean
- 物理GPU性能認証、または環境上の未認証を明記

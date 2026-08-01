# ブルドーザー車種縦切り Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 中央車庫で消防車とブルドーザーを乗り換え、既存の消火・積み木破壊を維持しながら、ブルドーザーで3個のがれきを片付ける車種別仕事を完成させる。

**Architecture:** 車両の表示・物理・primary action・仕事を型付きregistryへ集約し、既存`VoxelGameRuntime`を消防／共有積み木runtimeとして温存する。ブルドーザー仕事は独立runtimeと固定slot VFXへ分離し、`VehicleMissionCoordinator`が選択車両と共通仕事snapshotだけを束ねる。React stateは車種・phase・離散進捗に限定し、毎frameの車両・接触・VFXはrefと`InstancedMesh`で処理する。

**Tech Stack:** React 19、TypeScript 5.9、React Three Fiber 9、Three.js 0.181、React Three Rapier 2.2、Vitest 4、Playwright 1.59、Docker Compose

## Global Constraints

- npm、Vite、Vitest、PlaywrightはすべてDockerコンテナ内で実行する。
- `main`へ直接実装し、各Taskを日本語メッセージで独立commitして`origin/main`へpushする。
- 新しいnpm dependencyと外部3D／画像アセットを追加しない。
- 消防車の質量`1.4`、移動応答`7.5`、停止応答`4.8`、yaw clamp`5.2`、collider half extentsを変更しない。
- ブルドーザーは800 voxel以下、7 vehicle draw call以下にする。
- 工事がれき本体は3 draw call以下、破片poolも3 draw call以下にする。
- 乗り換えは車庫内かつ速度`0.35`以下だけ許可する。
- がれき除去はブルドーザー、primary action押下、速度`0.6`以上、前面ブレード接触の全条件を必要とする。
- がれきは3個、成功演出は`1,800ms`、帰庫後に同じ仕事を再配置する。
- ゲームオーバー、制限時間、評価、通貨、解除、保存、写実的土煙、精密サスペンションを追加しない。
- 既存の放水補助、火の強度、消火`2,500ms`、積み木impact threshold`4`、復元`5,000ms`を維持する。
- Spaceとタッチ右ボタンは同じ`primaryAction`へ正規化し、`spray`互換fieldを残さない。
- 通常積み木は両車で壊せ、乗り換えではresetしない。
- 毎frameのReact state更新、geometry／material／大きな配列生成を追加しない。
- 新規または実質改修する関数・class・moduleへ日本語docstringを付ける。
- UIは仕事表示を上中央、全画面を右上、車両セレクターを左上、stickを左下、primary actionを右下へanchoringする。
- 1280×720、1024×768、844×390でDOM矩形、safe area、スクリーンショットを検証する。
- physical GPUで中央値55fps以上、p10 45fps以上を目標とし、Docker SwiftShaderのfpsを性能認証に使わない。
- push前はstaged diffと`origin/main..HEAD`を機密パターンでscanし、push後はremote SHAとahead/behind `0/0`を確認する。

---

## File map

| File | Responsibility |
| --- | --- |
| `src/voxel-game/domain/vehicleDefinitions.ts` | 車両ID、表示、物理、collider、仕事、切替条件の唯一の静的定義。 |
| `src/voxel-game/domain/VehicleMissionCoordinator.ts` | 選択車両、消防runtime、工事runtime、共通仕事snapshotを束ねる。 |
| `src/voxel-game/domain/BulldozerMissionRuntime.ts` | がれき3個の冪等進捗、成功、自由走行、帰庫再開。 |
| `src/vehicle-lab/model/bulldozerVoxels.ts` | Three.js非依存のブルドーザーvoxel model。 |
| `src/vehicle-lab/scene/VoxelBulldozer.tsx` | palette別`InstancedMesh`描画とframe内のブレード上下。 |
| `src/voxel-game/scene/bulldozerVfx.ts` | がれき、route、破片poolのpure frame plan。 |
| `src/voxel-game/scene/BulldozerDebrisMission.tsx` | 実描画、ブレード接触、runtime通知、actual telemetry。 |
| `src/voxel-game/scene/productionWorldMap.ts` | 工事landmarkと一意性・地区内・非重複validation。 |
| `src/voxel-game/scene/VehicleController.tsx` | registryからmodel／物理を選ぶ共通controller。 |
| `src/voxel-game/scene/VoxelGameScene.tsx` | 選択仕事のscene componentとclockを接続する。 |
| `src/voxel-game/VoxelGameApp.tsx` | coordinator、vehicle state、text telemetry、reset hookを接続する。 |
| `src/voxel-game/ui/VoxelGameHud.tsx` | 車種別仕事、車両selector、primary action、fullscreen、stick。 |
| `src/voxel-game/ui/hudLayout.ts` | 実測DOM矩形間の安全余白を判定するpure helper。 |
| `scripts/verify-voxel-game-vehicles.mjs` | 2車種縦切り専用の短いPC/touch/3 viewport E2E。 |

---

### Task 1: 車両registry契約

**Files:**
- Create: `src/voxel-game/domain/vehicleDefinitions.ts`
- Create: `src/test/vehicleDefinitions.test.ts`

**Interfaces:**
- Produces: `VehicleId = 'fire-truck' | 'bulldozer'`
- Produces: `VehicleDefinition`, `VEHICLE_DEFINITIONS`, `getVehicleDefinition(id)`, `canSwitchVehicle(context)`
- Consumes: `MissionPhase`はまだ使わず、静的な`missionId`だけを定義する。

- [ ] **Step 1: registryと切替条件のfailing testを書く**

```ts
import { describe, expect, it } from 'vitest';
import {
  VEHICLE_DEFINITIONS,
  canSwitchVehicle,
  getVehicleDefinition,
  validateVehicleDefinitions,
} from '../voxel-game/domain/vehicleDefinitions';

describe('vehicle definitions', () => {
  it('消防車とブルドーザーを一意に公開する', () => {
    expect(VEHICLE_DEFINITIONS.map(({ id }) => id)).toEqual(['fire-truck', 'bulldozer']);
    expect(getVehicleDefinition('invalid')).toBe(VEHICLE_DEFINITIONS[0]);
    expect(validateVehicleDefinitions(VEHICLE_DEFINITIONS)).toEqual([]);
  });

  it.each([
    [true, 0, true],
    [true, 0.35, true],
    [true, 0.351, false],
    [false, 0, false],
    [true, Number.NaN, false],
  ] as const)('atGarage=%s speed=%s => %s', (atGarage, speed, expected) => {
    expect(canSwitchVehicle({ atGarage, speed })).toBe(expected);
  });

  it('消防車の既存物理値を固定する', () => {
    expect(getVehicleDefinition('fire-truck').physics).toMatchObject({
      mass: 1.4, movingResponse: 7.5, idleResponse: 4.8, yawClamp: 5.2,
    });
  });
});
```

- [ ] **Step 2: DockerでREDを確認する**

Run: `docker compose run --rm web npm test -- src/test/vehicleDefinitions.test.ts`

Expected: `vehicleDefinitions` import不在でFAILする。

- [ ] **Step 3: 型と値を実装する**

```ts
export type VehicleId = 'fire-truck' | 'bulldozer';
export type VehicleMissionId = 'fire-rescue' | 'debris-clearance';

export interface VehicleDefinition {
  readonly action: { readonly ariaLabel: string; readonly label: string };
  readonly collider: { readonly offset: WorldPoint; readonly halfExtents: WorldPoint };
  readonly id: VehicleId;
  readonly label: string;
  readonly missionId: VehicleMissionId;
  readonly physics: {
    readonly idleResponse: number;
    readonly mass: number;
    readonly movingResponse: number;
    readonly yawClamp: number;
  };
  readonly visualBounds: { readonly offset: WorldPoint; readonly scale: WorldPoint };
}

export const VEHICLE_DEFINITIONS = [
  {
    id: 'fire-truck', label: 'しょうぼうしゃ', missionId: 'fire-rescue',
    action: { ariaLabel: '水を出す', label: 'みず' },
    physics: { idleResponse: 4.8, mass: 1.4, movingResponse: 7.5, yawClamp: 5.2 },
    collider: { halfExtents: [1.45, 0.95, 1.7], offset: [0, 0.95, 0] },
    visualBounds: { offset: [0, 0.84, 0], scale: [2.88, 1.92, 3.36] },
  },
  {
    id: 'bulldozer', label: 'ブルドーザー', missionId: 'debris-clearance',
    action: { ariaLabel: 'ブレードを動かす', label: 'ブレード' },
    physics: { idleResponse: 4.4, mass: 1.9, movingResponse: 6.8, yawClamp: 4.8 },
    collider: { halfExtents: [1.68, 0.95, 1.56], offset: [0, 0.9, 0] },
    visualBounds: { offset: [0, 0.78, 0], scale: [3.36, 1.92, 3.12] },
  },
] as const satisfies readonly VehicleDefinition[];
```

- [ ] **Step 4: focused testとbuildを確認する**

Run: `docker compose run --rm web npm test -- src/test/vehicleDefinitions.test.ts`

Run: `docker compose run --rm web npm run build`

Expected: test PASS、既存入力consumerを変更していない状態でbuild exit 0。

- [ ] **Step 5: commit・security scan・pushする**

```bash
git add src/voxel-game/domain/vehicleDefinitions.ts src/test/vehicleDefinitions.test.ts
git commit -m "働く車の型付き定義を追加する"
git push origin main
```

---

### Task 2: 純ボクセルのブルドーザー車体

**Files:**
- Create: `src/vehicle-lab/model/bulldozerVoxels.ts`
- Create: `src/vehicle-lab/scene/VoxelBulldozer.tsx`
- Create: `src/test/bulldozerVoxels.test.ts`

**Interfaces:**
- Consumes: `VoxelCell`, `assertValidVoxelModel`, `calculateVoxelBounds`, `createVoxelRenderPlan`、`RefObject<boolean>`
- Produces: `BULLDOZER_VOXELS`, `BULLDOZER_RENDER_PLAN`, `BULLDOZER_PALETTE`, `VoxelBulldozer`
- Produces: `VoxelBulldozerProps.actionActiveRef?: RefObject<boolean>`。showroomでは省略できる。

- [ ] **Step 1: 造形bounds・上限・特徴のfailing testを書く**

```ts
describe('BULLDOZER_VOXELS', () => {
  it('800 voxel・7 batch以内で黄色い車体、左右履帯、前面ブレードを持つ', () => {
    expect(BULLDOZER_VOXELS.length).toBeLessThanOrEqual(800);
    expect(BULLDOZER_RENDER_PLAN.batches.length).toBeLessThanOrEqual(7);
    expect(BULLDOZER_PALETTE_IDS).toEqual(expect.arrayContaining([
      'yellow', 'track', 'blade', 'window', 'beacon',
    ]));
    const bounds = calculateVoxelBounds(BULLDOZER_VOXELS);
    expect(bounds.size.x).toBeGreaterThan(bounds.size.z * 0.9);
  });

  it('左右の履帯cell数が同じでmodel座標を重複しない', () => {
    const tracks = BULLDOZER_VOXELS.filter(({ paletteId }) => paletteId === 'track');
    expect(tracks.filter(({ x }) => x < 0)).toHaveLength(tracks.filter(({ x }) => x > 0).length);
    expect(new Set(BULLDOZER_VOXELS.map(({ x, y, z }) => `${x}:${y}:${z}`)).size)
      .toBe(BULLDOZER_VOXELS.length);
  });
});
```

- [ ] **Step 2: DockerでREDを確認する**

Run: `docker compose run --rm web npm test -- src/test/bulldozerVoxels.test.ts`

Expected: model import不在でFAILする。

- [ ] **Step 3: modelとpalette batch rendererを実装する**

12×8×13以内のgridを使い、次の領域をloopで生成する。

```ts
const TRACK_X = [-5, -4, 4, 5] as const;
addBox(cells, 'track', { x: [-5, -4], y: [0, 2], z: [-4, 4] });
addBox(cells, 'track', { x: [4, 5], y: [0, 2], z: [-4, 4] });
addBox(cells, 'yellow', { x: [-3, 3], y: [2, 4], z: [-3, 4] });
addBox(cells, 'window', { x: [-2, 2], y: [5, 6], z: [1, 3] });
addBox(cells, 'blade', { x: [-6, 6], y: [0, 2], z: [-6, -5] });
```

`VoxelBulldozer`はpaletteごとに1つの`instancedMesh`を描き、blade paletteだけを`group ref`配下へ置く。
`useFrame`で`actionActiveRef?.current`を読み、blade groupのYを`0`と`-0.12`の間でdampする。
入力commandの`primaryAction`移行は全consumerを同時に変えるTask 7で行う。

- [ ] **Step 4: focused testとbuildを通す**

Run: `docker compose run --rm web npm test -- src/test/bulldozerVoxels.test.ts src/test/voxelRenderPlan.test.ts`

Run: `docker compose run --rm web npm run build`

Expected: test PASS、TypeScript／Vite build exit 0。

- [ ] **Step 5: commit・scan・pushする**

```bash
git add src/vehicle-lab/model/bulldozerVoxels.ts src/vehicle-lab/scene/VoxelBulldozer.tsx \
  src/test/bulldozerVoxels.test.ts
git commit -m "玩具のブルドーザー車体を追加する"
git push origin main
```

---

### Task 3: 工事現場landmarkとmap validation

**Files:**
- Modify: `src/voxel-game/scene/productionWorldMap.ts`
- Modify: `src/voxel-game/scene/worldLayout.ts`
- Modify: `src/test/productionWorldMap.test.ts`
- Modify: `src/test/worldLayout.test.ts`

**Interfaces:**
- Produces: `BulldozerDebrisLandmarkDefinition`
- Produces: `PRODUCTION_WORLD_MAP.landmarks.bulldozerDebris`、`bulldozerRouteMarkers`
- Produces: `BULLDOZER_DEBRIS`, `BULLDOZER_ROUTE_MARKER_POSITIONS`

- [ ] **Step 1: 3個の一意landmarkと共有参照のfailing testを書く**

```ts
it('西地区へ3個の非重複がれきと道しるべを公開する', () => {
  const { bulldozerDebris, bulldozerRouteMarkers } = PRODUCTION_WORLD_MAP.landmarks;
  expect(bulldozerDebris.map(({ id }) => id)).toEqual([
    'debris-timber', 'debris-stone', 'debris-crate',
  ]);
  expect(new Set(bulldozerDebris.map(({ id }) => id)).size).toBe(3);
  expect(bulldozerDebris.every(({ position }) => resolveWorldDistrict(position) === 'blocks')).toBe(true);
  expect(bulldozerRouteMarkers.length).toBeGreaterThanOrEqual(6);
  expect(BULLDOZER_DEBRIS).toBe(bulldozerDebris);
});
```

validator testへ、world外、通常積み木から3unit未満、がれき同士2.5unit未満、重複IDをそれぞれ追加し、
具体的なerror stringを期待する。

- [ ] **Step 2: DockerでREDを確認する**

Run: `docker compose run --rm web npm test -- src/test/productionWorldMap.test.ts src/test/worldLayout.test.ts`

Expected: 新landmark不在でFAILする。

- [ ] **Step 3: map定義とvalidatorを実装する**

```ts
bulldozerDebris: [
  { id: 'debris-timber', palette: 'timber', position: [-29.5, 0.8, 12.5], radius: 1.15 },
  { id: 'debris-stone', palette: 'stone', position: [-24, 0.8, 13], radius: 1.15 },
  { id: 'debris-crate', palette: 'crate', position: [-18.2, 0.8, 12], radius: 1.15 },
],
bulldozerRouteMarkers: [
  [-3, 0.26, 0], [-7, 0.26, 0], [-11, 0.26, 0],
  [-15, 0.26, 0], [-19, 0.26, 2], [-22, 0.26, 6], [-24, 0.26, 9],
],
```

validatorは各がれきが`blocks`地区内、world内、通常積み木から3unit以上、がれき同士2.5unit以上かを
XZ距離で検証する。route markerは有限値とworld内だけを検証する。

- [ ] **Step 4: focused testと既存map testを通す**

Run: `docker compose run --rm web npm test -- src/test/productionWorldMap.test.ts src/test/worldLayout.test.ts src/test/worldCollisionLayout.test.ts src/test/productionWorldRender.test.ts`

Expected: 新旧map契約がすべてPASS。

- [ ] **Step 5: commit・scan・pushする**

```bash
git add src/voxel-game/scene/productionWorldMap.ts src/voxel-game/scene/worldLayout.ts \
  src/test/productionWorldMap.test.ts src/test/worldLayout.test.ts
git commit -m "工事現場のがれき配置を定義する"
git push origin main
```

---

### Task 4: ブルドーザーruntimeと車種別仕事coordinator

**Files:**
- Create: `src/voxel-game/domain/BulldozerMissionRuntime.ts`
- Create: `src/voxel-game/domain/VehicleMissionCoordinator.ts`
- Create: `src/test/bulldozerMissionRuntime.test.ts`
- Create: `src/test/vehicleMissionCoordinator.test.ts`

**Interfaces:**
- Consumes: `VehicleId`, `VehicleMissionId`, `MissionPhase`, `VoxelGameRuntime`
- Produces: `BulldozerMissionSnapshot`, `BulldozerMissionRuntime.registerDebrisClear(id)`
- Produces: `VehicleMissionSnapshot`, `VehicleMissionCoordinator.selectVehicle(id, context)`
- Produces: coordinatorの`fireRuntime`を共有積み木runtimeとして公開する。

- [ ] **Step 1: runtime遷移と切替gateのfailing testを書く**

```ts
it('3個を一度ずつ片付けて成功、自由走行、帰庫再開へ進む', () => {
  const runtime = new BulldozerMissionRuntime(['a', 'b', 'c']);
  runtime.setAtGarage(false);
  expect(runtime.registerDebrisClear('a')).toBe(true);
  expect(runtime.registerDebrisClear('a')).toBe(false);
  runtime.registerDebrisClear('b');
  runtime.registerDebrisClear('c');
  expect(runtime.getSnapshot()).toMatchObject({ phase: 'celebrating', clearedCount: 3 });
  runtime.advance(1_800);
  expect(runtime.getSnapshot().phase).toBe('freeRoam');
  runtime.setAtGarage(true);
  runtime.advance(1);
  expect(runtime.getSnapshot()).toMatchObject({ phase: 'assigned', clearedCount: 0 });
});

it('車庫内停止時だけ車種を切り替えて対象仕事をresetする', () => {
  const coordinator = new VehicleMissionCoordinator(BREAKABLE_IDS, DEBRIS_IDS);
  expect(coordinator.selectVehicle('bulldozer', { atGarage: true, speed: 0 })).toBe(true);
  expect(coordinator.getSnapshot().selectedVehicleId).toBe('bulldozer');
  expect(coordinator.selectVehicle('fire-truck', { atGarage: false, speed: 0 })).toBe(false);
});
```

- [ ] **Step 2: DockerでREDを確認する**

Run: `docker compose run --rm web npm test -- src/test/bulldozerMissionRuntime.test.ts src/test/vehicleMissionCoordinator.test.ts`

Expected: class import不在でFAILする。

- [ ] **Step 3: runtimeとcoordinatorを実装する**

```ts
export interface VehicleMissionSnapshot {
  readonly destinationDistrict: 'fire' | 'blocks';
  readonly id: VehicleMissionId;
  readonly objectiveLabel: string;
  readonly phase: MissionPhase;
  readonly progress: { readonly current: number; readonly target: number };
  readonly routeVisible: boolean;
  readonly vehicleId: VehicleId;
}

export interface VehicleMissionCoordinatorSnapshot {
  readonly bulldozer: BulldozerMissionSnapshot;
  readonly fire: VoxelGameSnapshot;
  readonly mission: VehicleMissionSnapshot;
  readonly selectedVehicleId: VehicleId;
}
```

`BulldozerMissionRuntime`は`Set<string>`で処理済みIDを保持し、未知／重複IDは`false`を返す。
coordinatorは既存`VoxelGameRuntime`をconstructorで1回だけ生成し、車種切替時は選択先missionだけをresetする。
`advance(milliseconds)`は共有積み木timerのためfire runtimeを常時進め、工事runtimeは選択中だけ進める。

- [ ] **Step 4: focused testと消防runtime回帰を通す**

Run: `docker compose run --rm web npm test -- src/test/bulldozerMissionRuntime.test.ts src/test/vehicleMissionCoordinator.test.ts src/test/voxelGameRuntime.test.ts`

Expected: 新規testと既存消防／積み木runtime testがPASS。

- [ ] **Step 5: commit・scan・pushする**

```bash
git add src/voxel-game/domain/BulldozerMissionRuntime.ts \
  src/voxel-game/domain/VehicleMissionCoordinator.ts \
  src/test/bulldozerMissionRuntime.test.ts src/test/vehicleMissionCoordinator.test.ts
git commit -m "車種別ミッションの実行基盤を追加する"
git push origin main
```

---

### Task 5: がれき・route・破片poolと接触判定

**Files:**
- Create: `src/voxel-game/scene/bulldozerVfx.ts`
- Create: `src/voxel-game/scene/BulldozerDebrisMission.tsx`
- Create: `src/test/bulldozerVfx.test.ts`
- Create: `src/test/bulldozerDebrisMission.test.ts`

**Interfaces:**
- Consumes: `BULLDOZER_DEBRIS`, `BULLDOZER_ROUTE_MARKER_POSITIONS`, `VehicleTelemetryRef`, `DriveCommand`
- Produces: `shouldClearDebris(contact)`, `createBulldozerVfxFrame(snapshot, elapsed)`
- Produces: `BulldozerMissionTelemetry`と`BulldozerMissionTelemetryRef`
- Produces: `BulldozerDebrisMission`。runtime登録は1 frame最大1件。

- [ ] **Step 1: 全gateと固定poolのfailing testを書く**

```ts
const validContact = {
  bladeCenter: [-28, 0.7, 12] as const,
  debrisPosition: [-28, 0.8, 12] as const,
  primaryAction: true,
  speed: 0.6,
  vehicleId: 'bulldozer' as const,
};

it('ブルドーザーの作動中ブレード接触だけを除去として扱う', () => {
  expect(shouldClearDebris(validContact)).toBe(true);
  expect(shouldClearDebris({ ...validContact, vehicleId: 'fire-truck' })).toBe(false);
  expect(shouldClearDebris({ ...validContact, primaryAction: false })).toBe(false);
  expect(shouldClearDebris({ ...validContact, speed: 0.599 })).toBe(false);
  expect(shouldClearDebris({ ...validContact, bladeCenter: [-20, 0.7, 12] })).toBe(false);
});

it('3個のがれきと固定破片slotだけを返す', () => {
  const frame = createBulldozerVfxFrame(INITIAL_SNAPSHOT, 0);
  expect(frame.debris).toHaveLength(3);
  expect(frame.chips).toHaveLength(BULLDOZER_CHIP_POOL_SIZE);
  expect(frame.routeMarkers).toHaveLength(BULLDOZER_ROUTE_MARKER_POSITIONS.length);
});
```

- [ ] **Step 2: DockerでREDを確認する**

Run: `docker compose run --rm web npm test -- src/test/bulldozerVfx.test.ts src/test/bulldozerDebrisMission.test.ts`

Expected: helper／component不在でFAIL。

- [ ] **Step 3: pure frame helperとInstancedMeshを実装する**

`BULLDOZER_CHIP_POOL_SIZE = 18`とし、1がれき6slotを固定割当する。slotは非active時に
position `[0, -40, 0]`、scale `0`を返す。componentはpalette別にがれき最大3 mesh、chip最大3 mesh、
route 1 meshをmountし、matrixとtelemetry tupleをmount時に確保してin-place更新する。

ブレード中心は次で求める。

```ts
export function getBladeCenter(telemetry: VehicleTelemetry): WorldPoint {
  return [
    telemetry.position[0] + telemetry.forward[0] * 1.75,
    telemetry.position[1] + 0.35,
    telemetry.position[2] + telemetry.forward[2] * 1.75,
  ];
}
```

- [ ] **Step 4: focused testとallocation制約を確認する**

Run: `docker compose run --rm web npm test -- src/test/bulldozerVfx.test.ts src/test/bulldozerDebrisMission.test.ts`

Run: `rg -n "useState|new THREE|\.map\(" src/voxel-game/scene/BulldozerDebrisMission.tsx`

Expected: `useState`なし。`new THREE`と配列生成はmoduleまたはmount初期化だけで、`useFrame`内にない。

- [ ] **Step 5: commit・scan・pushする**

```bash
git add src/voxel-game/scene/bulldozerVfx.ts src/voxel-game/scene/BulldozerDebrisMission.tsx \
  src/test/bulldozerVfx.test.ts src/test/bulldozerDebrisMission.test.ts
git commit -m "がれき片付けのボクセル演出を追加する"
git push origin main
```

---

### Task 6: registry駆動の共通controller

**Files:**
- Modify: `src/voxel-game/scene/VehicleController.tsx`
- Modify: `src/voxel-game/scene/VoxelGameScene.tsx`
- Modify: `src/voxel-game/VoxelGameApp.tsx`
- Modify: `src/test/waterAndFire.test.ts`（VehicleTelemetry fixtureの車種ID同期）
- Modify: `src/test/voxelGameRenderTelemetry.test.ts`

**Interfaces:**
- Consumes: `VehicleDefinition`, `VehicleId`, `VoxelBulldozer`
- Produces: `VehicleTelemetry.id`と`VehicleControllerProps.vehicleId`
- Produces: Appが未統合の中間commitでは`vehicleId='fire-truck'`を明示し、既存scene挙動を保つ。

- [ ] **Step 1: 車種別physics/modelのfailing testを書く**

```ts
it('telemetryへ車種IDを含める', () => {
  expect(createInitialVehicleTelemetry('bulldozer')).toMatchObject({
    id: 'bulldozer', mass: 1.9, speed: 0,
  });
});

```

render testではcontrollerが`vehicleId='bulldozer'`時に`VoxelBulldozer`、
`vehicleId='fire-truck'`時に`VoxelFireTruck`を各1つ選ぶrender plan helperを検証する。

- [ ] **Step 2: DockerでREDを確認する**

Run: `docker compose run --rm web npm test -- src/test/voxelGameRenderTelemetry.test.ts`

Expected: `VehicleTelemetry.id`とscene props不在でFAIL。

- [ ] **Step 3: controllerとsceneをregistry駆動へ変更する**

`VehicleController`は`const definition = getVehicleDefinition(vehicleId)`を1回解決し、
response、yaw clamp、mass、colliderを定義から読む。model分岐は1か所だけにする。

```tsx
<CuboidCollider
  args={[...definition.collider.halfExtents]}
  mass={definition.physics.mass}
  position={definition.collider.offset}
/>
<group rotation={[0, Math.PI, 0]}>
  {vehicleId === 'fire-truck'
    ? <VoxelFireTruck />
    : <VoxelBulldozer actionActiveRef={actionActiveRef} />}
</group>
```

controller内の`actionActiveRef.current`は既存`commandRef.current.spray`から毎frame同期する。
この中間commitではAppとsceneから固定`'fire-truck'`を渡して公開挙動を変えず、Task 7で入力名と
coordinator／専用visualを同時に統合する。

- [ ] **Step 4: focused test、full unit、buildを通す**

Run: `docker compose run --rm web npm test -- src/test/voxelGameRenderTelemetry.test.ts src/test/screenRelativeMovement.test.ts`

Run: `docker compose run --rm web npm test`

Run: `docker compose run --rm web npm run build`

Expected: 全unit PASS、build exit 0。

- [ ] **Step 5: commit・scan・pushする**

```bash
git add src/voxel-game/scene/VehicleController.tsx src/voxel-game/scene/VoxelGameScene.tsx \
  src/test/waterAndFire.test.ts src/test/voxelGameRenderTelemetry.test.ts \
  src/voxel-game/VoxelGameApp.tsx
git commit -m "車両controllerを車種定義へ接続する"
git push origin main
```

---

### Task 7: App・HUD・telemetry・アクセシビリティ統合

**Files:**
- Create: `src/voxel-game/ui/hudLayout.ts`
- Create: `src/test/hudLayout.test.ts`
- Modify: `src/voxel-game/VoxelGameApp.tsx`
- Modify: `src/voxel-game/input/controlState.ts`
- Modify: `src/voxel-game/input/useVoxelGameControls.ts`
- Modify: `src/voxel-game/scene/VoxelGameScene.tsx`
- Modify: `src/voxel-game/scene/WaterAndFire.tsx`
- Modify: `src/voxel-game/ui/VoxelGameHud.tsx`
- Modify: `src/voxel-game/styles.css`
- Modify: `src/global.d.ts`
- Modify: `src/test/fullscreenControls.test.ts`
- Modify: `src/test/voxelGameControls.test.ts`
- Modify: `src/test/waterAndFire.test.ts`
- Modify: `src/test/voxelGameRenderTelemetry.test.ts`

**Interfaces:**
- Consumes: `VehicleMissionCoordinatorSnapshot`, `VehicleDefinition`, `canSwitchVehicle`
- Produces: `VoxelGameHudProps.vehicleId`、`mission`、`canSwitchVehicle`、`onSelectVehicle`
- Produces: `DriveCommand.primaryAction`、`VoxelGameControls.setPrimaryAction()`、`primaryActionPressed`
- Produces: text stateの`vehicle.id`、`mission.id/progress/destinationDistrict`、`vehicleSelection`、工事visual actual。
- Produces: `isHudLayoutSafe(rectangles, minimumGap)`。

- [ ] **Step 1: HUD文言、切替UI、矩形helperのfailing testを書く**

```ts
it('仕事snapshotを幼児向け文言へそのまま表示する', () => {
  expect(getMissionLabel({
    id: 'debris-clearance', phase: 'active', progress: { current: 1, target: 3 },
  })).toBe('がれき あと2こ');
});

it('矩形間が8px未満ならunsafeを返す', () => {
  expect(isHudLayoutSafe({
    mission: { left: 300, right: 500, top: 12, bottom: 52 },
    selector: { left: 12, right: 292, top: 12, bottom: 88 },
    fullscreen: { left: 760, right: 832, top: 12, bottom: 52 },
  }, 8)).toBe(true);
});
```

component testは2つのbutton、選択中`aria-pressed=true`、車庫外ではselector非表示、
ブルドーザー時の`aria-label='ブレードを動かす'`を検証する。

- [ ] **Step 2: DockerでREDを確認する**

Run: `docker compose run --rm web npm test -- src/test/hudLayout.test.ts src/test/voxelGameRenderTelemetry.test.ts`

Expected: helperと新telemetry field不在でFAIL。

- [ ] **Step 3: App stateとHUDを実装する**

最初に`DigitalAction`の`'spray'`を`'primaryAction'`、`DriveCommand.spray`を
`DriveCommand.primaryAction`、hookの`setSpray/sprayPressed`を
`setPrimaryAction/primaryActionPressed`へ一括置換する。Spaceとタッチ右ボタンを同じ状態へ接続し、
`WaterAndFire`は消防車選択中だけprimary actionを放水signalへ変換する。

sceneはcoordinator、選択車種、工事telemetryを受け取り、clockでcoordinatorを進める。
`WaterAndFire`と`BulldozerDebrisMission`はmountを維持しつつ`enabled` propで選択車種だけを作動させ、
非選択仕事は入力・進捗・route・VFXを停止する。controllerの`actionActiveRef`も同時に
`commandRef.current.primaryAction`へ切り替える。

`VoxelGameApp`はcoordinatorを`useRef`で1回生成し、購読で`selectedVehicleId`とmissionの
離散signatureだけをstateへ反映する。`handleSelectVehicle`はevent時点のtelemetryから再度
`atGarage`とspeedを判定し、成功時だけcontrols reset、controller reset、scene vehicle key更新を行う。

```tsx
<nav aria-label="のりものをえらぶ" className="vehicle-selector">
  {VEHICLE_DEFINITIONS.map((vehicle) => (
    <button
      aria-pressed={vehicle.id === selectedVehicleId}
      key={vehicle.id}
      onClick={() => onSelectVehicle(vehicle.id)}
      type="button"
    >
      {vehicle.label}
    </button>
  ))}
</nav>
```

HUD rootの固定`aria-label="消防車の操作パネル"`は`"働く車の操作パネル"`へ変える。
primary buttonのclassは汎用`primary-action-button`へ移し、消防は青、工事は黄橙のmodifierを付ける。

- [ ] **Step 4: text telemetryとwindow test hookを同期する**

`render_game_to_text()`へ次を必ず含める。

```ts
vehicleSelection: {
  available: canSwitchVehicle({ atGarage, speed: vehicle.speed }),
  options: VEHICLE_DEFINITIONS.map(({ id, label }) => ({ id, label })),
  selectedVehicleId,
},
mission: coordinatorSnapshot.mission,
landmarks: {
  ...existingLandmarks,
  bulldozerDebris: BULLDOZER_DEBRIS,
},
```

`window.select_voxel_game_vehicle(id)`をE2E用に公開しても、内部で同じ切替gateを通す。
cleanupでhookを削除する。

- [ ] **Step 5: focused test、full unit、buildを通す**

Run: `docker compose run --rm web npm test -- src/test/hudLayout.test.ts src/test/voxelGameControls.test.ts src/test/waterAndFire.test.ts src/test/voxelGameRenderTelemetry.test.ts src/test/fullscreenControls.test.ts`

Run: `docker compose run --rm web npm test`

Run: `docker compose run --rm web npm run build`

Expected: 全unit PASS、build exit 0、文言と操作可否に矛盾なし。

- [ ] **Step 6: commit・scan・pushする**

```bash
git add src/voxel-game/ui/hudLayout.ts src/test/hudLayout.test.ts \
  src/voxel-game/VoxelGameApp.tsx src/voxel-game/ui/VoxelGameHud.tsx \
  src/voxel-game/input/controlState.ts src/voxel-game/input/useVoxelGameControls.ts \
  src/voxel-game/scene/VoxelGameScene.tsx src/voxel-game/scene/WaterAndFire.tsx \
  src/voxel-game/styles.css src/global.d.ts src/test/fullscreenControls.test.ts \
  src/test/voxelGameControls.test.ts src/test/waterAndFire.test.ts \
  src/test/voxelGameRenderTelemetry.test.ts
git commit -m "車庫の乗り換えUIと車種別HUDを追加する"
git push origin main
```

---

### Task 8: PC・touch・3 viewport E2Eと本番受け入れ

**Files:**
- Create: `scripts/verify-voxel-game-vehicles.mjs`
- Modify: `docker-compose.yml`
- Modify: `README.md`
- Modify: `progress.md`（git管理外の作業ログだけを追記）

**Interfaces:**
- Consumes: `render_game_to_text()`、`advanceTime()`、`select_voxel_game_vehicle()`、実DOM button。
- Produces: `output/voxel-game-vehicles/manifest.json`、3 viewport screenshot、E2E pass/fail。
- Produces: Compose service `voxel-game-vehicles-e2e`。

- [ ] **Step 1: 専用E2E scriptをREDで作る**

scriptは少なくとも次をassertする。

```js
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 720, touch: false },
  { name: 'tablet', width: 1024, height: 768, touch: true },
  { name: 'mobile-landscape', width: 844, height: 390, touch: true },
];

assert(initial.vehicle.id === 'fire-truck', 'initial vehicle must be fire-truck');
assert(initial.vehicleSelection.available, 'selector must be available at stopped garage');
await page.getByRole('button', { name: 'ブルドーザー' }).click();
assert((await readGameState(page)).vehicle.id === 'bulldozer', 'switch failed');
```

PCはkeyboard、touch 2 viewportはDOM pointerで、車庫退出、3がれき除去、成功、自由走行を完遂する。
各viewportでselector／mission／fullscreenの`getBoundingClientRect()`を読み、8px以上、画面内、
844×390 selector右端42%以下を数値assertする。車庫外切替が拒否されることも確認する。

- [ ] **Step 2: Compose serviceを追加し、実装前のREDを確認する**

```yaml
  voxel-game-vehicles-e2e:
    profiles: ["e2e"]
    build:
      context: .
      dockerfile: Dockerfile.e2e
    working_dir: /app
    environment:
      VOXEL_GAME_BASE_URL: http://127.0.0.1:5173
    volumes:
      - ./output:/app/output
    command: ["sh", "-lc", "npm run dev -- --host 127.0.0.1 > /tmp/vehicles.log 2>&1 & server_pid=$!; trap 'kill $server_pid 2>/dev/null || true' EXIT; node scripts/verify-voxel-game-vehicles.mjs"]
```

Run: `docker compose --profile e2e run --rm voxel-game-vehicles-e2e`

Expected: 未完成scenarioの具体的assertでFAILする。server／browser起動失敗ではない。

- [ ] **Step 3: E2EをGREENへし、画像を目視する**

Run: `docker compose --profile e2e run --rm voxel-game-vehicles-e2e`

Expected: 3 viewport、keyboard、touch、切替拒否、消防回帰、console error 0がPASSする。

E2E後に次の3画像を必ず目視する。

- `output/voxel-game-vehicles/desktop-bulldozer.png`
- `output/voxel-game-vehicles/tablet-bulldozer.png`
- `output/voxel-game-vehicles/mobile-landscape-bulldozer.png`

確認項目は、黄色い車体／黒い履帯／灰色bladeの識別、がれき3塊、仕事文言、selector、
下部操作、はみ出し、主要対象との重なり、旧消防車の火が非選択時に仕事として誤表示されないこと。

- [ ] **Step 4: 全回帰、build、physical GPUをfreshに確認する**

Run: `docker compose run --rm web npm test`

Run: `docker compose run --rm web npm run build`

Run: `docker compose --profile e2e run --rm voxel-game-e2e`

physical GPUは既存のlocal browser手順で1280×720を10秒以上計測し、manifestへ
`medianFps >= 55`、`p10Fps >= 45`、renderer calls、vehicle draw callsを記録する。

- [ ] **Step 5: READMEと作業ログを同期する**

READMEの操作を「Space／右ボタン＝車種別アクション」へ更新し、車庫内停止時の乗り換え、
消防と工事の仕事、ゲームオーバーなしを追記する。`progress.md`へunit／build／E2E／目視／性能の
実測値と残課題を追記する。

- [ ] **Step 6: 参照残り・成果物・差分を最終確認する**

Run: `rg -n "command\.spray|controls\.spray|setSpray|sprayPressed" src scripts README.md`

Run: `git diff --check`

Run: `git status --short`

Expected: 旧入力名0件、diff check 0、意図したsource／test／README／Composeだけが変更される。

- [ ] **Step 7: commit・全範囲scan・push・公開確認を行う**

```bash
git add scripts/verify-voxel-game-vehicles.mjs docker-compose.yml README.md
git commit -m "二車種の本番プレイを検証する"
git push origin main
```

push後は`git ls-remote origin refs/heads/main`とlocal HEAD一致、ahead/behind `0/0`、
GitHub Actions success、Pages deployment success、公開URLの`render_game_to_text()`が同じSHA相当の
二車種契約を返すことを確認する。`progress.md`と`output/`はcommitしない。

---

## Plan self-review result

- Spec coverage: REQ-001〜REQ-031のうち本spec対象はTask 1〜8へ対応済み。色替え、他3車種、音、複数仕事、追加mapは非対象として次specへ残す。
- Type consistency: `VehicleId`、`VehicleMissionSnapshot`、`DriveCommand.primaryAction`、`VehicleTelemetry.id`、`BulldozerMissionTelemetry`を最初のproducing taskから後続taskへ同名で接続する。
- Placeholder scan: 未確定の仮置き語なし。各RED／GREEN／検証／commit／push commandを具体化した。
- Regression coverage: 消防runtime、放水、通常積み木、入力、fullscreen、map、camera、PC/touchを既存testと完成E2Eで維持する。
- Final checklist: 受け入れ条件、非対象、リスク、性能目標は設計書とGlobal Constraintsに残っている。

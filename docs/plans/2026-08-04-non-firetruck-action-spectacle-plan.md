# 消防車以外の玩具アクション強化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ブルドーザー、ショベルカー、救急車、パトカーを、対象外でも押した瞬間から楽しく、対象付近では仕事の作用と完了が車種固有に伝わる玩具アクションへ強化する。

**Architecture:** `DriveCommand.primaryAction`を入力に、車両周囲の自由VFXを単一固定pool rendererへ集約する。車体部品と既存target VFXは車種別pure helperで動かし、mission runtime、Rapier body、cameraへは書き込まない。

**Tech Stack:** React 19、TypeScript 5.9、React Three Fiber 9、Three.js 0.181、Rapier 2、Vitest 4、Playwright 1.59、Docker Compose、GitHub Actions／Pages。

## Global Constraints

- 消防車の放水、炎、消火判定は変更しない。
- 既存の距離、速度、hold duration、仕事数、帰庫再開契約を変更しない。
- camera shake、全画面flash、動的RigidBody粒子を追加しない。
- 高輝度切替は2Hz以下とし、押下ごとのtouch振動を追加しない。
- 毎frame React state更新と可変配列／Three object生成を追加しない。
- 車両周囲VFXは最大48 fixed slot、追加1 draw callとする。
- 各車両modelは7 draw call以下、sceneは最大34 calls以下とする。
- game entry 350kB、通常chunk 600kB、Three 750kB、Rapier 2.25MB以内とする。
- npm、Vitest、Vite、PlaywrightはすべてDockerコンテナ内で実行する。
- コミットメッセージは日本語とし、push前に`origin/main..HEAD`をsecret scanする。

---

## File Structure

- Create `src/voxel-game/scene/actionVfx/vehicleActionVfx.ts`: fixed frame、press edge、cycle、4車種strategyを持つpure VFX計算。
- Create `src/voxel-game/scene/actionVfx/VehicleActionVfx.tsx`: 単一vertex-color `InstancedMesh`へframeを転送するrenderer。
- Create `src/test/vehicleActionVfx.test.ts`: 4車種の自由action、pool、無効入力、切替を固定するunit test。
- Modify `src/voxel-game/scene/VoxelGameScene.tsx`: 非消防車だけ共通rendererを接続する。
- Modify `src/voxel-game/VoxelGameApp.tsx`: active count、cycle、press countをtext telemetryへ公開する。
- Modify `src/vehicle-lab/scene/VoxelBulldozer.tsx`: blade slamと車体visual squat。
- Modify `src/voxel-game/scene/bulldozerVfx.ts`: 接触中亀裂、破片、完了ring。
- Modify `src/voxel-game/scene/BulldozerDebrisMission.tsx`: active contactとprogressをVFXへ渡す。
- Modify `src/test/bulldozerVoxels.test.ts`, `src/test/bulldozerVfx.test.ts`: ブルドーザー演出契約。
- Modify `src/vehicle-lab/scene/VoxelExcavator.tsx`: arm／bucketの4相掘削cycle。
- Modify `src/voxel-game/scene/actionTargetVfx.ts`: soilの作用中吸引と完了噴水。
- Modify `src/voxel-game/scene/ActionTargetMission.tsx`: target kind別progressをframeへ渡す。
- Modify `src/test/excavatorVoxels.test.ts`, `src/test/actionTargetVfx.test.ts`: ショベル演出契約。
- Modify `src/vehicle-lab/scene/VoxelAmbulance.tsx`: 赤十字／灯火のpress burstとhold pulse。
- Modify `src/voxel-game/scene/actionTargetVfx.ts`: patientの作用ringとheart／cross completion。
- Modify `src/test/ambulanceVoxels.test.ts`, `src/test/actionTargetVfx.test.ts`: 救急演出契約。
- Modify `src/vehicle-lab/scene/VoxelPolice.tsx`: beacon、beam、trailと2Hz以下のcycle。
- Modify `src/voxel-game/scene/actionTargetVfx.ts`: checkpointのgate chaseと完了arch。
- Modify `src/test/policeVoxels.test.ts`, `src/test/actionTargetVfx.test.ts`: パトカー演出契約。
- Modify `src/voxel-game/audio/toyAudioMix.ts`: action開始attackとtarget作用中のmix。
- Modify `src/voxel-game/audio/ToyAudioDirector.ts`: edge／target stateをaudio engineへ渡す。
- Modify `src/voxel-game/audio/WebAudioToyEngine.ts`: attack envelopeを既存nodeで鳴らす。
- Modify `src/voxel-game/audio/useToyAudioFeedback.ts`: target action telemetryをaudio directorへ接続する。
- Modify `src/test/toyAudioMix.test.ts`, `src/test/toyAudioDirector.test.ts`: 音オフ維持と車種別attack。
- Modify `src/voxel-game/ui/VoxelGameHud.tsx`, `src/voxel-game/styles.css`: 非消防車action buttonのpress ringとicon bounce。
- Modify `src/test/hudLayout.test.ts`: button内部境界と非消防車data属性。
- Create `scripts/verify-voxel-game-actions.mjs`: 4車種×3 viewportの自由action、target作用、完了を実走する。
- Modify `docker-compose.yml`: `voxel-game-actions-e2e`を追加する。
- Modify `README.md`: 4車種の新アクションと検証コマンドを記載する。

---

### Task 1: 共通の押下即応VFXとHUD feedback

**Files:**
- Create: `src/voxel-game/scene/actionVfx/vehicleActionVfx.ts`
- Create: `src/voxel-game/scene/actionVfx/VehicleActionVfx.tsx`
- Create: `src/test/vehicleActionVfx.test.ts`
- Modify: `src/voxel-game/scene/VoxelGameScene.tsx`
- Modify: `src/voxel-game/VoxelGameApp.tsx`
- Modify: `src/voxel-game/ui/VoxelGameHud.tsx`
- Modify: `src/voxel-game/styles.css`
- Modify: `src/test/hudLayout.test.ts`

**Interfaces:**
- Consumes: `VehicleId`、`DriveCommand.primaryAction`、`VehicleTelemetry.position/forward/speed`。
- Produces: `createVehicleActionVfxFrame()`、`updateVehicleActionVfxFrame(frame, input)`、`VehicleActionVfxTelemetry`。

- [ ] **Step 1: fixed frameと4車種識別の失敗testを書く**

```ts
it.each(['bulldozer', 'excavator', 'ambulance', 'police'] as const)(
  '%sは押下直後に固有paletteと1個以上のvoxelを返す',
  (vehicleId) => {
    const frame = createVehicleActionVfxFrame();
    updateVehicleActionVfxFrame(frame, {
      actionActive: true,
      deltaSeconds: 1 / 60,
      elapsedSeconds: 0.02,
      forward: [0, 0, 1],
      position: [4, 0, 8],
      speed: 0,
      vehicleId,
    });
    expect(frame.activeCount).toBeGreaterThan(0);
    expect(new Set(frame.voxels.filter((voxel) => voxel.active).map((voxel) => voxel.palette)))
      .toContain(vehicleId);
  },
);
```

- [ ] **Step 2: testをDockerで実行してREDを確認する**

Run: `docker compose run --rm web npm test -- src/test/vehicleActionVfx.test.ts`

Expected: moduleまたはexport不存在でFAIL。

- [ ] **Step 3: pure fixed frameを実装する**

```ts
export const VEHICLE_ACTION_VOXEL_POOL_SIZE = 48;
export type SpectacleVehicleId = Exclude<VehicleId, 'fire-truck'>;

export interface VehicleActionVfxInput {
  readonly actionActive: boolean;
  readonly deltaSeconds: number;
  readonly elapsedSeconds: number;
  readonly forward: readonly [number, number, number];
  readonly position: readonly [number, number, number];
  readonly speed: number;
  readonly vehicleId: VehicleId;
}

export interface VehicleActionVfxFrame {
  activeCount: number;
  cycleProgress: number;
  pressCount: number;
  readonly voxels: VehicleActionVoxelTransform[];
  wasActive: boolean;
}
```

`elapsedSeconds`、`deltaSeconds`、位置、forwardをfinite clampし、`fire-truck`、inactive、未知IDでは全slotをzero scaleへ戻す。4車種は方向、palette、cycle durationを別descriptorにする。

- [ ] **Step 4: rendererを1 draw callでsceneへ接続する**

`VehicleActionVfx.tsx`は`BoxGeometry`とvertex color付き`meshLambertMaterial`を1つだけ持ち、`useFrame`でmatrixとcolorをin-place更新する。`VoxelGameScene`は常時1 componentだけを持ち、消防車／inactive時は`mesh.count=0`にする。

- [ ] **Step 5: HUD buttonへ非消防車限定のpress ringを追加する**

`data-spectacle-action={vehicleId !== 'fire-truck'}`を主操作buttonへ付け、`:active`と既存active classでbutton本体を`scale(.92)`、iconを`scale(1.12)`、疑似要素ringを250msで1回広げる。`prefers-reduced-motion: reduce`ではring反復を停止する。

- [ ] **Step 6: telemetryと境界testを追加してGREENを確認する**

`render_game_to_text()`へ`vehicleActionVfx: { activeCubeCount, cycleProgress, pressCount }`を追加する。HUD testはbuttonのbottom/rightが親境界以内である既存helper契約を維持する。

Run: `docker compose run --rm web npm test -- src/test/vehicleActionVfx.test.ts src/test/hudLayout.test.ts`

Expected: PASS、48slot、1 scene call増加、消防車active count 0。

- [ ] **Step 7: budget build、commit、pushを行う**

Run: `docker compose run --rm web npm run build`

```bash
git add src/voxel-game/scene/actionVfx src/voxel-game/scene/VoxelGameScene.tsx src/voxel-game/VoxelGameApp.tsx src/voxel-game/ui/VoxelGameHud.tsx src/voxel-game/styles.css src/test/vehicleActionVfx.test.ts src/test/hudLayout.test.ts
git commit -m "働く車の共通玩具アクションを追加する"
git push origin main
```

---

### Task 2: ブルドーザーのblade衝撃

**Files:**
- Modify: `src/vehicle-lab/scene/VoxelBulldozer.tsx`
- Modify: `src/voxel-game/scene/bulldozerVfx.ts`
- Modify: `src/voxel-game/scene/BulldozerDebrisMission.tsx`
- Modify: `src/test/bulldozerVoxels.test.ts`
- Modify: `src/test/bulldozerVfx.test.ts`
- Modify: `src/test/bulldozerDebrisMission.test.ts`

**Interfaces:**
- Consumes: 既存blade group、debris clear time、contact point、action active。
- Produces: `getBulldozerActionPose()`とcontact progress対応`updateBulldozerVfxFrame()`。

- [ ] **Step 1: bladeの4相poseとtarget effectの失敗testを書く**

```ts
expect(getBulldozerActionPose(true, 0.04)).toMatchObject({ bladeY: expect.any(Number) });
expect(getBulldozerActionPose(true, 0.04).bodyScaleY).toBeLessThan(1);
expect(countActiveChips(updateFrame({ contactProgress: 0.5 }))).toBeGreaterThan(6);
```

- [ ] **Step 2: Docker testでREDを確認する**

Run: `docker compose run --rm web npm test -- src/test/bulldozerVoxels.test.ts src/test/bulldozerVfx.test.ts src/test/bulldozerDebrisMission.test.ts`

- [ ] **Step 3: blade slamとvisual squatを実装する**

`0〜0.12s`でbladeを下げ、`0.12〜0.24s`で小さくbounce、hold中は0.55s周期とする。車体visual childだけをY方向0.96まで縮め、collider／RigidBody rootは変更しない。

- [ ] **Step 4: contact crackと12破片相当の完了burstを実装する**

接触中はblade前面から3方向の短い亀裂cubeを出す。完了時は既存pool batchを維持したままslot容量を増やし、黄灰茶の衝撃ringと前方へ流れる破片を1.1秒以内に隠す。

- [ ] **Step 5:既存判定不変をtestしてGREENを確認する**

minimum speed、contact radius、action active、clear countの既存期待値を変更せず、progress 0では新target effectがinactiveになることを確認する。

Run: `docker compose run --rm web npm test -- src/test/bulldozerVoxels.test.ts src/test/bulldozerVfx.test.ts src/test/bulldozerDebrisMission.test.ts`

- [ ] **Step 6: build、commit、pushを行う**

Run: `docker compose run --rm web npm run build`

```bash
git add src/vehicle-lab/scene/VoxelBulldozer.tsx src/voxel-game/scene/bulldozerVfx.ts src/voxel-game/scene/BulldozerDebrisMission.tsx src/test/bulldozerVoxels.test.ts src/test/bulldozerVfx.test.ts src/test/bulldozerDebrisMission.test.ts
git commit -m "ブルドーザーの衝撃演出を強化する"
git push origin main
```

---

### Task 3: ショベルカーの掘削cycle

**Files:**
- Modify: `src/vehicle-lab/scene/VoxelExcavator.tsx`
- Modify: `src/voxel-game/scene/actionTargetVfx.ts`
- Modify: `src/voxel-game/scene/ActionTargetMission.tsx`
- Modify: `src/test/excavatorVoxels.test.ts`
- Modify: `src/test/actionTargetVfx.test.ts`

**Interfaces:**
- Consumes: `targetKind='soil'`、hold progress、completion time。
- Produces: `getExcavatorActionPose()`、soil固有の吸引／放物線／完了噴水frame。

- [ ] **Step 1: 4相cycleとsoil粒子の失敗testを書く**

```ts
expect(getExcavatorActionPose(true, 0.1).armY).toBeLessThan(0);
expect(getExcavatorActionPose(true, 0.48).bucketRotationX).toBeGreaterThan(0);
expect(getExcavatorActionPose(true, 0.72).armY).toBeGreaterThan(-0.2);
expect(activeSoilParticles({ holdProgress: 0.6 })).toBeGreaterThan(6);
```

- [ ] **Step 2: Docker testでREDを確認する**

Run: `docker compose run --rm web npm test -- src/test/excavatorVoxels.test.ts src/test/actionTargetVfx.test.ts`

- [ ] **Step 3: armとbucketを0.9秒cycleで動かす**

`下げる0〜0.25 → curl 0.25〜0.5 → 持ち上げ0.5〜0.72 → 戻す0.72〜0.9`をpure helperで補間する。既存palette batchを回転groupへ束ね直すだけでdraw callを増やさない。

- [ ] **Step 4: soil target responseと完了噴水を実装する**

hold中は土山からbucket先端へcubeを吸引し、cycle後半で車体横へ放物線移動する。完了時は土山bodyを上段から縮め、茶橙cubeを上へ出して左右へ落とす。全slotは固定pool内で1.1秒以内に非activeへ戻す。

- [ ] **Step 5: 判定不変とGREENを確認する**

700ms、最大速度0.45、3target、完了countを既存期待値のままにする。

Run: `docker compose run --rm web npm test -- src/test/excavatorVoxels.test.ts src/test/actionTargetVfx.test.ts src/test/actionTargetContact.test.ts`

- [ ] **Step 6: build、commit、pushを行う**

Run: `docker compose run --rm web npm run build`

```bash
git add src/vehicle-lab/scene/VoxelExcavator.tsx src/voxel-game/scene/actionTargetVfx.ts src/voxel-game/scene/ActionTargetMission.tsx src/test/excavatorVoxels.test.ts src/test/actionTargetVfx.test.ts
git commit -m "ショベルカーの掘削演出を強化する"
git push origin main
```

---

### Task 4: 救急車の手当てwave

**Files:**
- Modify: `src/vehicle-lab/scene/VoxelAmbulance.tsx`
- Modify: `src/voxel-game/scene/actionTargetVfx.ts`
- Modify: `src/voxel-game/scene/ActionTargetMission.tsx`
- Modify: `src/test/ambulanceVoxels.test.ts`
- Modify: `src/test/actionTargetVfx.test.ts`

**Interfaces:**
- Consumes: `targetKind='patient'`、hold progress、completion time。
- Produces: `getAmbulanceActionPose()`、patient固有のring、heart、cross completion frame。

- [ ] **Step 1: press pulse、2Hz制約、patient粒子の失敗testを書く**

```ts
expect(getAmbulanceActionPose(true, 0.08).crossScale).toBeGreaterThan(1.12);
expect(getAmbulanceActionPose(true, 0.4).beaconPulseHz).toBeLessThanOrEqual(2);
expect(getPatientGlyphKinds({ holdProgress: 0.7 })).toEqual(expect.arrayContaining(['cross', 'heart']));
```

- [ ] **Step 2: Docker testでREDを確認する**

Run: `docker compose run --rm web npm test -- src/test/ambulanceVoxels.test.ts src/test/actionTargetVfx.test.ts`

- [ ] **Step 3: 車体press burstとhold pulseを実装する**

press 0〜0.22秒はcross／灯火を最大1.16まで拡大し、holdは1.0秒周期で1.00〜1.08にする。車体周囲waveはTask 1 fixed poolのred／white strategyを使い、画面全体を覆わない半径3.2以内にする。

- [ ] **Step 4: patient ringとheart／cross completionを実装する**

hold progressで患者周囲のringをY=0.2から1.8へ上げる。完了時は既存0.65秒起き上がりの前半0.12秒だけ0.92倍へ縮め、その後立たせる。頭上glyphは固定cubeでheartとcrossを作り1.3秒で収束させる。

- [ ] **Step 5: 判定不変とGREENを確認する**

1,200ms、最大速度0.35、患者1体、起き上がり終端の既存期待値を維持する。

Run: `docker compose run --rm web npm test -- src/test/ambulanceVoxels.test.ts src/test/actionTargetVfx.test.ts src/test/actionTargetContact.test.ts`

- [ ] **Step 6: build、commit、pushを行う**

Run: `docker compose run --rm web npm run build`

```bash
git add src/vehicle-lab/scene/VoxelAmbulance.tsx src/voxel-game/scene/actionTargetVfx.ts src/voxel-game/scene/ActionTargetMission.tsx src/test/ambulanceVoxels.test.ts src/test/actionTargetVfx.test.ts
git commit -m "救急車の手当て演出を強化する"
git push origin main
```

---

### Task 5: パトカーの赤青巡回effect

**Files:**
- Modify: `src/vehicle-lab/scene/VoxelPolice.tsx`
- Modify: `src/voxel-game/scene/actionTargetVfx.ts`
- Modify: `src/voxel-game/scene/ActionTargetMission.tsx`
- Modify: `src/test/policeVoxels.test.ts`
- Modify: `src/test/actionTargetVfx.test.ts`

**Interfaces:**
- Consumes: `targetKind='checkpoint'`、vehicle speed／forward、hold progress、completion time。
- Produces: `getPoliceActionPose()`、赤青beam／trail、gate chase、completion arch frame。

- [ ] **Step 1: beacon、trail、gate chaseの失敗testを書く**

```ts
expect(getPoliceActionPose(true, 0.1).redScale).not.toBe(getPoliceActionPose(true, 0.1).blueScale);
expect(getPoliceActionPose(true, 0.6).flashHz).toBeLessThanOrEqual(2);
expect(activePoliceTrail({ speed: 2, actionActive: true })).toBeGreaterThan(0);
expect(checkpointAccentOrder({ holdProgress: 0.6 })).toEqual([0, 1]);
```

- [ ] **Step 2: Docker testでREDを確認する**

Run: `docker compose run --rm web npm test -- src/test/policeVoxels.test.ts src/test/actionTargetVfx.test.ts src/test/vehicleActionVfx.test.ts`

- [ ] **Step 3: 車体beacon、beam、trailを実装する**

pressで左右へ赤青ringを1回出し、holdは0.5秒ごとに主色を切り替える。縦beamは高さ2.4以内、trailは速度0.35以上で車体後方6slotだけを使い、停止中は即座に隠す。

- [ ] **Step 4: gate chaseとcompletion archを実装する**

hold progressに応じ、門の3 accentを入口側から中央へ点灯する。完了時は赤青cubeを門の上へ左右対称に弧状配置し、1.0秒で白い完了色へ収束する。

- [ ] **Step 5: 判定不変とGREENを確認する**

minimum speed 0.35、maximum speed 5.5、250ms、3gate、内幅契約を既存testのまま維持する。

Run: `docker compose run --rm web npm test -- src/test/policeVoxels.test.ts src/test/actionTargetVfx.test.ts src/test/actionTargetContact.test.ts src/test/vehicleJobs.test.ts`

- [ ] **Step 6: build、commit、pushを行う**

Run: `docker compose run --rm web npm run build`

```bash
git add src/vehicle-lab/scene/VoxelPolice.tsx src/voxel-game/scene/actionTargetVfx.ts src/voxel-game/scene/ActionTargetMission.tsx src/test/policeVoxels.test.ts src/test/actionTargetVfx.test.ts src/test/vehicleActionVfx.test.ts
git commit -m "パトカーの巡回演出を強化する"
git push origin main
```

---

### Task 6: 車種別audio attack

**Files:**
- Modify: `src/voxel-game/audio/toyAudioMix.ts`
- Modify: `src/voxel-game/audio/ToyAudioDirector.ts`
- Modify: `src/voxel-game/audio/WebAudioToyEngine.ts`
- Modify: `src/voxel-game/audio/useToyAudioFeedback.ts`
- Modify: `src/test/toyAudioMix.test.ts`
- Modify: `src/test/toyAudioDirector.test.ts`

**Interfaces:**
- Consumes: vehicle ID、primary action edge、target action active、既存audio enabled。
- Produces: `actionAttackGain`、`actionAttackFrequency`、`targetActionGain`を含む`ToyAudioMixFrame`。

- [ ] **Step 1: 音オフ、edge、target作用の失敗testを書く**

```ts
expect(createToyAudioMixFrame({ enabled: false, primaryAction: true, ...input }).actionAttackGain).toBe(0);
expect(createToyAudioMixFrame({ actionPressed: true, vehicleId: 'excavator', ...input }).actionAttackGain).toBeGreaterThan(0);
expect(createToyAudioMixFrame({ targetActionActive: true, vehicleId: 'ambulance', ...input }).targetActionGain).toBeGreaterThan(0);
```

- [ ] **Step 2: Docker testでREDを確認する**

Run: `docker compose run --rm web npm test -- src/test/toyAudioMix.test.ts src/test/toyAudioDirector.test.ts`

- [ ] **Step 3: edgeとtarget actionをdirectorへ追加する**

directorが前frameのprimary actionを保持し、false→trueだけを`actionPressed`にする。target actionはmission telemetryのcontact／hold progressが0より大きい場合だけtrueにする。disabledとhidden中はedgeを蓄積しない。

- [ ] **Step 4: 既存nodeで短いattack envelopeを実装する**

外部nodeを毎回生成せず、既存oscillator／gainへ60〜140msのattack-decay値をsmooth設定する。bladeは低音、bucketは上昇2音、careは長3度、sirenは赤青2音として既存action kindを維持する。

- [ ] **Step 5: GREENと既存AudioContext契約を確認する**

Run: `docker compose run --rm web npm test -- src/test/toyAudioMix.test.ts src/test/toyAudioDirector.test.ts src/test/toyAudioEvents.test.ts`

Expected: 音オフgain 0、外部asset request 0、車種別frequencyが重複しない。

- [ ] **Step 6: build、commit、pushを行う**

Run: `docker compose run --rm web npm run build`

```bash
git add src/voxel-game/audio src/test/toyAudioMix.test.ts src/test/toyAudioDirector.test.ts src/test/toyAudioEvents.test.ts
git commit -m "働く車の操作音を強化する"
git push origin main
```

---

### Task 7: 3 viewport実走、性能、公開

**Files:**
- Create: `scripts/verify-voxel-game-actions.mjs`
- Modify: `docker-compose.yml`
- Modify: `README.md`
- Modify: `docs/design/2026-08-04-non-firetruck-action-spectacle-design.md`
- Modify: `docs/plans/2026-08-04-non-firetruck-action-spectacle-plan.md`

**Interfaces:**
- Consumes: `render_game_to_text()`のvehicle action／mission／audio／performance telemetry。
- Produces: `output/voxel-game-actions/run-manifest.json`と4車種×3 viewportの画像証跡。

- [ ] **Step 1: action E2E scriptを作る**

```js
const VIEWPORTS = [
  { height: 720, name: 'desktop', width: 1280 },
  { height: 768, name: 'tablet', width: 1024 },
  { height: 390, name: 'mobile-landscape', width: 844 },
];
const VEHICLES = ['bulldozer', 'excavator', 'ambulance', 'police'];
```

各組合せでgarage選択、対象外press、1cycle hold、現在jobの最終案内区間、target作用、completionを実操作する。`activeCubeCount > 0`、`pressCount`増加、仕事外completion不変、target progress増加、completion増加、browser error 0をassertする。

- [ ] **Step 2: Docker serviceを追加して3 viewportを実行する**

Run: `docker compose --profile e2e run --rm --build voxel-game-actions-e2e`

Expected: 12 scenario complete、48枚以上、console／page／request error 0、manifest status `completed`。

- [ ] **Step 3: 全画像を原寸目視する**

各車種についてDesktopとMobile landscapeのidle／free action／target／completionを最低16枚開く。車体輪郭、役割部品、対象、HUD button、mission札、mini mapが隠れず、下端／右端がviewport内であることを確認する。

- [ ] **Step 4: fresh full gateをDockerで実行する**

Run: `docker compose run --rm web npm test`

Run: `docker compose run --rm web npm run build`

Run: `docker compose --profile e2e run --rm --build voxel-game-e2e`

Run: `docker compose --profile e2e run --rm --build production-smoke-e2e`

Expected: unit failure 0、budget内、canonical manifest complete、3 entrypoint WebGL起動、browser error 0。

- [ ] **Step 5: physical GPU性能を再認証する**

Chrome実機で`/?gpu-cert=actions-<timestamp>`を各車種で開き、4車種ともmedian 55fps以上、p10 45fps以上、scene 34 calls以下を記録する。Docker SwiftShaderのfpsは合否に使わない。

- [ ] **Step 6: READMEと設計実測を更新する**

4車種の自由action、target response、完了演出、Dockerコマンド、画像数、unit数、bundle、draw call、physical GPU値を実測値で記載する。未実行値を推測で書かない。

- [ ] **Step 7: release commit前に全送信範囲を検査する**

Run: `git diff --check origin/main..HEAD`

Run: `git diff -U0 origin/main..HEAD | rg -n -i "(api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password|passwd|private[_-]?key)"`

Run: `git diff -U0 origin/main..HEAD | rg -n -- "-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"`

Expected: suspicious match 0。文書内の一般語が一致した場合は値と文脈を目視分類する。

- [ ] **Step 8: 日本語commit、main push、Pages公開を行う**

```bash
git add scripts/verify-voxel-game-actions.mjs docker-compose.yml README.md docs/design/2026-08-04-non-firetruck-action-spectacle-design.md docs/plans/2026-08-04-non-firetruck-action-spectacle-plan.md
git commit -m "働く車アクションの公開検証を追加する"
git push origin main
```

対象HEADの`Deploy GitHub Pages`を`gh run watch --exit-status`で完了まで監視する。`git ls-remote origin refs/heads/main`とlocal SHAを一致させ、ahead／behind `0/0`を確認する。

- [ ] **Step 9: 公開URLをcache-busting付きで検証する**

Run: `docker compose --profile e2e run --rm --build -e PRODUCTION_BASE_URL=https://santa928.github.io/toy-rescue-course production-smoke-e2e node scripts/verify-production-entrypoints.mjs`

公開rootへ`?action-release=<HEAD>&job-seed=1`を付け、action focus E2Eで4車種のpressとbrowser error 0を確認する。

---

## Self-Review

- Spec coverage: REQ-088〜REQ-096はTask 1〜7に対応し、既存要件は各車種の判定不変testとTask 7 full gateで保護する。
- Placeholder scan: 仮置き語、未確定のfile名、後続へ丸投げするstepは残していない。
- Type consistency: `VehicleActionVfxFrame`、`VehicleActionVfxInput`、`VehicleActionVfxTelemetry`をTask 1で定義し、Task 2〜7はその名前だけを利用する。
- Scope: 新仕事、map、消防車、camera、物理body、post-processingを実装対象から除外した。


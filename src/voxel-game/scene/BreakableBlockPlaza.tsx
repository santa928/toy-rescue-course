import { useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import type { ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  CuboidCollider,
  RigidBody,
  type CollisionEnterPayload,
  type RapierCollider,
  type RapierRigidBody,
} from '@react-three/rapier';
import * as THREE from 'three';
import type { BreakablePhase, VoxelGameSnapshot, VoxelGameRuntime } from '../domain/VoxelGameRuntime';
import {
  CHIP_BURST_SIZE,
  CHIP_LIFETIME_SECONDS,
  CHIP_POOL_SIZE,
  createChipBurstFrame,
  createMainFragmentDefinitions,
  resolveMainFragmentVelocity,
  type ChipBurstFrame,
  type ChipInstanceTransform,
  type MainFragmentDefinition,
} from './breakableVfx';
import type { VehicleTelemetryRef } from './VehicleController';
import { BREAKABLE_BLOCKS } from './worldLayout';

interface LinearVelocity {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface BreakableBlockDefinition {
  readonly color: string;
  readonly id: string;
  readonly position: readonly [number, number, number];
}

export interface BreakableFragmentSlot {
  readonly blockId: string;
  readonly color: string;
  readonly id: string;
  readonly index: number;
  readonly launch: MainFragmentDefinition;
  readonly localPosition: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
}

export interface BreakableBlockTelemetry {
  readonly bodyHandles: readonly number[];
  readonly colliderHandles: readonly number[];
  readonly collisionEnabledFragmentCount: number;
  readonly fragmentVisibleCount: number;
  readonly id: string;
  readonly impactCount: number;
  readonly intactBodyEnabledCount: number;
  readonly intactBodyHandle: number | null;
  readonly intactColliderEnabledCount: number;
  readonly intactColliderHandle: number | null;
  readonly intactEnabledCountAtFragmentActivation: number | null;
  readonly intactVisible: boolean;
  readonly maxImpactSpeed: number;
  readonly maxEventRelativeSpeed: number;
  readonly maxVehiclePreviousStepSpeed: number;
  readonly meshUuids: readonly string[];
  readonly slotIds: readonly string[];
  readonly vehicleImpactCount: number;
}

export interface ActiveBreakableFragmentTelemetry {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
}

export interface BreakableTelemetry {
  readonly activeFragments: readonly ActiveBreakableFragmentTelemetry[];
  readonly activeFragmentCount: number;
  readonly blocks: readonly BreakableBlockTelemetry[];
  readonly bodyHandles: readonly number[];
  readonly colliderHandles: readonly number[];
  readonly collisionEnabledFragmentCount: number;
  readonly chipPoolSlotCount: number;
  readonly chips: readonly {
    readonly active: boolean;
    readonly position: readonly [number, number, number];
    readonly scale: number;
    readonly slot: number;
  }[];
  readonly enabledBodyCount: number;
  readonly meshUuids: readonly string[];
  readonly mountedBodyCount: number;
  readonly mountedColliderCount: number;
  readonly mountedMeshCount: number;
  readonly poolSlotCount: number;
  readonly poolSlotIds: readonly string[];
  readonly rapierSleepingFragmentCount: number;
  readonly sleepingFragmentCount: number;
  readonly uniqueBodyHandleCount: number;
  readonly uniqueColliderHandleCount: number;
  readonly uniqueMeshUuidCount: number;
}

export type BreakableTelemetryRef = React.MutableRefObject<BreakableTelemetry>;

export interface BreakablePoolHandle {
  readActualTelemetry(): BreakableTelemetry;
  syncAfterRuntimeAdvance(): void;
}

export type BreakablePoolHandleRef = React.MutableRefObject<BreakablePoolHandle | null>;

interface BreakableBlockPlazaProps {
  readonly breakablePoolHandleRef: BreakablePoolHandleRef;
  readonly runtime: VoxelGameRuntime;
  readonly telemetryRef: VehicleTelemetryRef;
  readonly breakableTelemetryRef: BreakableTelemetryRef;
}

interface FragmentRuntimeSlot {
  active: boolean;
  body: RapierRigidBody | null;
  collider: RapierCollider | null;
  mesh: THREE.Mesh | null;
}

interface IntactRuntimeSlot {
  body: RapierRigidBody | null;
  collider: RapierCollider | null;
  mesh: THREE.Mesh | null;
}

interface ChipBurstRuntime {
  readonly blockColor: string;
  readonly origin: readonly [number, number, number];
  readonly startedAtSeconds: number;
}

interface FragmentSnapshotBodyRef {
  readonly handle: number;
  isEnabled(): boolean;
  isSleeping(): boolean;
}

interface FragmentSnapshotColliderRef {
  readonly handle: number;
  isEnabled(): boolean;
}

interface FragmentSnapshotMeshRef {
  readonly uuid: string;
  readonly visible: boolean;
}

export interface FragmentSnapshotSlot {
  readonly body: FragmentSnapshotBodyRef | null;
  readonly collider: FragmentSnapshotColliderRef | null;
  readonly mesh: FragmentSnapshotMeshRef | null;
}

export interface ActualFragmentPoolSnapshot {
  readonly activeFragmentCount: number;
  readonly bodyHandles: readonly number[];
  readonly colliderHandles: readonly number[];
  readonly collisionEnabledFragmentCount: number;
  readonly enabledBodyCount: number;
  readonly meshUuids: readonly string[];
  readonly mountedBodyCount: number;
  readonly mountedColliderCount: number;
  readonly mountedMeshCount: number;
  readonly rapierSleepingFragmentCount: number;
  readonly sleepingFragmentCount: number;
  readonly uniqueBodyHandleCount: number;
  readonly uniqueColliderHandleCount: number;
  readonly uniqueMeshUuidCount: number;
  readonly visibleFragmentCount: number;
}

export interface BlockImpactSpeedInput {
  readonly collisionBodyIsVehicle: boolean;
  readonly eventRelativeSpeed: number;
  readonly vehiclePreviousStepSpeed: number;
}

export const BREAKABLE_FRAGMENT_SLOTS_PER_BLOCK = 6;
export const BREAKABLE_FRAGMENT_LIFETIME_MS = 1_200;
const BLOCK_RESPAWN_DURATION_MS = 5_000;
const FRAGMENT_WINDOW_END_REMAINING_MS = BLOCK_RESPAWN_DURATION_MS - BREAKABLE_FRAGMENT_LIFETIME_MS;
const FRAGMENT_WINDOW_EPSILON_MS = 1e-6;
const INACTIVE_FRAGMENT_POSITION = [0, -40, 0] as const;
const ZERO_VELOCITY = { x: 0, y: 0, z: 0 } as const;
const IDENTITY_ROTATION = { w: 1, x: 0, y: 0, z: 0 } as const;

/** block定義ごとに専用6片を割り当て、再生成しない固定pool定義を返す。 */
export function createBreakableFragmentPool(
  blocks: readonly BreakableBlockDefinition[],
): readonly BreakableFragmentSlot[] {
  const definitions = createMainFragmentDefinitions();
  return blocks.flatMap((block) => definitions.map((definition, index) => ({
    blockId: block.id,
    color: block.color,
    id: `${block.id}:fragment-${index}`,
    index,
    launch: definition,
    localPosition: definition.localPosition,
    scale: definition.scale,
  })));
}

/** 複数burstのactive slotだけを合成し、別burstのinactive slotによる上書きを防ぐ。 */
export function combineChipBurstFrames(
  frames: readonly ChipBurstFrame[],
): readonly ChipInstanceTransform[] {
  const instances: ChipInstanceTransform[] = Array.from(
    { length: CHIP_POOL_SIZE },
    (_, slot) => ({
      active: false,
      color: '#000000',
      position: INACTIVE_FRAGMENT_POSITION,
      scale: 0,
      slot,
    }),
  );
  for (const frame of frames) {
    for (const instance of frame.instances) {
      if (instance.active && instance.slot >= 0 && instance.slot < CHIP_POOL_SIZE) {
        instances[instance.slot] = instance;
      }
    }
  }
  return instances;
}

export const BREAKABLE_FRAGMENT_POOL = createBreakableFragmentPool(BREAKABLE_BLOCKS);
export const BREAKABLE_FRAGMENT_POOL_SLOT_IDS = BREAKABLE_FRAGMENT_POOL.map(({ id }) => id);
export const BREAKABLE_FRAGMENT_SLOT_INDICES_BY_BLOCK = BREAKABLE_BLOCKS.map((block) => (
  BREAKABLE_FRAGMENT_POOL.reduce<number[]>((indices, slot, index) => {
    if (slot.blockId === block.id) indices.push(index);
    return indices;
  }, [])
));

/** 実在するRapier/Three参照だけからpool数・状態・identityをsnapshot化する。 */
export function createActualFragmentPoolSnapshot(
  slots: readonly FragmentSnapshotSlot[],
  slotIndices?: readonly number[],
): ActualFragmentPoolSnapshot {
  const bodyHandles: number[] = [];
  const colliderHandles: number[] = [];
  const meshUuids: string[] = [];
  let activeFragmentCount = 0;
  let collisionEnabledFragmentCount = 0;
  let enabledBodyCount = 0;
  let rapierSleepingFragmentCount = 0;
  let sleepingFragmentCount = 0;
  let visibleFragmentCount = 0;
  const length = slotIndices?.length ?? slots.length;

  for (let offset = 0; offset < length; offset += 1) {
    const slot = slots[slotIndices?.[offset] ?? offset];
    if (!slot) continue;
    const bodyEnabled = slot.body?.isEnabled() ?? false;
    const colliderEnabled = slot.collider?.isEnabled() ?? false;
    const meshVisible = slot.mesh?.visible ?? false;
    if (slot.body) {
      bodyHandles.push(slot.body.handle);
      if (bodyEnabled) enabledBodyCount += 1;
      const rapierSleeping = slot.body.isSleeping();
      if (rapierSleeping) rapierSleepingFragmentCount += 1;
      // strictなisSleepingとは別に、より強い停止状態であるdisabledもdormantと数える。
      if (rapierSleeping || !bodyEnabled) sleepingFragmentCount += 1;
    }
    if (slot.collider) {
      colliderHandles.push(slot.collider.handle);
      if (colliderEnabled) collisionEnabledFragmentCount += 1;
    }
    if (slot.mesh) {
      meshUuids.push(slot.mesh.uuid);
      if (meshVisible) visibleFragmentCount += 1;
    }
    if (bodyEnabled && colliderEnabled && meshVisible) activeFragmentCount += 1;
  }

  return {
    activeFragmentCount,
    bodyHandles,
    colliderHandles,
    collisionEnabledFragmentCount,
    enabledBodyCount,
    meshUuids,
    mountedBodyCount: bodyHandles.length,
    mountedColliderCount: colliderHandles.length,
    mountedMeshCount: meshUuids.length,
    rapierSleepingFragmentCount,
    sleepingFragmentCount,
    uniqueBodyHandleCount: new Set(bodyHandles).size,
    uniqueColliderHandleCount: new Set(colliderHandles).size,
    uniqueMeshUuidCount: new Set(meshUuids).size,
    visibleFragmentCount,
  };
}

/** 2つのRapier body線速度の差から衝突時の相対速度の大きさを返す。 */
export function calculateRelativeLinearSpeed(
  targetVelocity: LinearVelocity,
  otherVelocity: LinearVelocity,
): number {
  return Math.hypot(
    targetVelocity.x - otherVelocity.x,
    targetVelocity.y - otherVelocity.y,
    targetVelocity.z - otherVelocity.z,
  );
}

/** after-step eventでは衝突車両の前step速度だけを破壊速度として採用する。 */
export function resolveBlockImpactSpeed({
  collisionBodyIsVehicle,
  vehiclePreviousStepSpeed,
}: BlockImpactSpeedInput): number {
  return collisionBodyIsVehicle ? vehiclePreviousStepSpeed : 0;
}

/** block中心と車両のXZ距離が復元半径3を厳密に超えるか判定する。 */
export function isBlockRespawnAreaClear(
  blockPosition: readonly [number, number, number],
  vehiclePosition: readonly [number, number, number],
): boolean {
  return Math.hypot(
    blockPosition[0] - vehiclePosition[0],
    blockPosition[2] - vehiclePosition[2],
  ) > 3;
}

/** runtimeの5秒復元timerを共通clockとして、破壊後1.2秒未満だけtrueを返す。 */
export function isFragmentWindowActive(
  phase: BreakablePhase,
  respawnRemainingMs: number,
): boolean {
  return phase === 'broken'
    && respawnRemainingMs > FRAGMENT_WINDOW_END_REMAINING_MS + FRAGMENT_WINDOW_EPSILON_MS;
}

/** collision payloadの実RigidBody APIから相対線速度を取得する。 */
function getCollisionRelativeLinearSpeed(payload: CollisionEnterPayload): number {
  const targetVelocity = payload.target.rigidBody?.linvel() ?? ZERO_VELOCITY;
  const otherVelocity = payload.other.rigidBody?.linvel() ?? ZERO_VELOCITY;
  return calculateRelativeLinearSpeed(targetVelocity, otherVelocity);
}

/** Rapier bodyの質量と前step位置が公開vehicle telemetryと一致するか判定する。 */
function isCollisionBodyVehicle(
  body: RapierRigidBody | undefined,
  telemetry: VehicleTelemetryRef['current'],
): boolean {
  if (!body || telemetry.mass <= 0 || Math.abs(body.mass() - telemetry.mass) > 0.01) return false;
  const position = body.translation();
  return Math.hypot(
    position.x - telemetry.position[0],
    position.y - telemetry.position[1],
    position.z - telemetry.position[2],
  ) <= 0.35;
}

/** 固定pool slotを指定block中心で有効化し、決定的な初速を与える。 */
function activateFragment(
  slot: BreakableFragmentSlot,
  runtimeSlot: FragmentRuntimeSlot,
  blockPosition: readonly [number, number, number],
  impactForward: readonly [number, number, number],
): void {
  const body = runtimeSlot.body;
  if (!body) return;
  const velocity = resolveMainFragmentVelocity(slot.launch, impactForward);
  body.setEnabled(true);
  runtimeSlot.collider?.setEnabled(true);
  body.setTranslation({
    x: blockPosition[0] + slot.localPosition[0],
    y: blockPosition[1] + slot.localPosition[1],
    z: blockPosition[2] + slot.localPosition[2],
  }, true);
  body.setRotation(IDENTITY_ROTATION, true);
  body.setLinvel({ x: velocity[0], y: velocity[1], z: velocity[2] }, true);
  body.setAngvel({
    x: velocity[2] * 0.45,
    y: velocity[0] * 0.3,
    z: -velocity[0] * 0.45,
  }, true);
  body.wakeUp();
  if (runtimeSlot.mesh) runtimeSlot.mesh.visible = true;
  runtimeSlot.active = true;
}

/** pool slotを非表示・sleep・衝突無効へ戻して安全に再利用可能にする。 */
function deactivateFragment(runtimeSlot: FragmentRuntimeSlot): void {
  if (runtimeSlot.mesh) runtimeSlot.mesh.visible = false;
  runtimeSlot.collider?.setEnabled(false);
  if (runtimeSlot.body) {
    deactivateFragmentBody(runtimeSlot.body);
  }
  runtimeSlot.active = false;
}

interface DeactivatableFragmentBody {
  setAngvel(velocity: LinearVelocity, wakeUp: boolean): void;
  setEnabled(enabled: boolean): void;
  setLinvel(velocity: LinearVelocity, wakeUp: boolean): void;
  sleep(): void;
}

/** 一度動いた破片bodyにも、速度零・disable・sleepをすべて明示適用する。 */
export function deactivateFragmentBody(body: DeactivatableFragmentBody): void {
  body.setLinvel(ZERO_VELOCITY, false);
  body.setAngvel(ZERO_VELOCITY, false);
  body.setEnabled(false);
  body.sleep();
}

/** 4つの壊せる積み木と、常時24slotだけを持つRapier破片poolを構成する。 */
export function BreakableBlockPlaza({
  breakablePoolHandleRef,
  breakableTelemetryRef,
  runtime,
  telemetryRef,
}: BreakableBlockPlazaProps): ReactElement {
  const runtimeSlotsRef = useRef<FragmentRuntimeSlot[]>(BREAKABLE_FRAGMENT_POOL.map(() => ({
    active: false,
    body: null,
    collider: null,
    mesh: null,
  })));
  const intactSlotsRef = useRef<IntactRuntimeSlot[]>(BREAKABLE_BLOCKS.map(() => ({
    body: null,
    collider: null,
    mesh: null,
  })));
  const intactBodyRefCallbacks = useRef(BREAKABLE_BLOCKS.map((_, index) => (
    (body: RapierRigidBody | null): void => {
      const intactSlot = intactSlotsRef.current[index];
      if (intactSlot) intactSlot.body = body;
    }
  ))).current;
  const intactColliderRefCallbacks = useRef(BREAKABLE_BLOCKS.map((_, index) => (
    (collider: RapierCollider | null): void => {
      const intactSlot = intactSlotsRef.current[index];
      if (intactSlot) intactSlot.collider = collider;
    }
  ))).current;
  const intactMeshRefCallbacks = useRef(BREAKABLE_BLOCKS.map((_, index) => (
    (mesh: THREE.Mesh | null): void => {
      const intactSlot = intactSlotsRef.current[index];
      if (intactSlot) intactSlot.mesh = mesh;
    }
  ))).current;
  const fragmentBodyRefCallbacks = useRef(BREAKABLE_FRAGMENT_POOL.map((_, index) => (
    (body: RapierRigidBody | null): void => {
      const runtimeSlot = runtimeSlotsRef.current[index];
      if (!runtimeSlot) return;
      runtimeSlot.body = body;
    }
  ))).current;
  const fragmentColliderRefCallbacks = useRef(BREAKABLE_FRAGMENT_POOL.map((_, index) => (
    (collider: RapierCollider | null): void => {
      const runtimeSlot = runtimeSlotsRef.current[index];
      if (!runtimeSlot) return;
      runtimeSlot.collider = collider;
    }
  ))).current;
  const fragmentMeshRefCallbacks = useRef(BREAKABLE_FRAGMENT_POOL.map((_, index) => (
    (mesh: THREE.Mesh | null): void => {
      const runtimeSlot = runtimeSlotsRef.current[index];
      if (!runtimeSlot) return;
      runtimeSlot.mesh = mesh;
    }
  ))).current;
  const impactTelemetryRef = useRef(BREAKABLE_BLOCKS.map(() => ({
      count: 0,
      intactEnabledCountAtFragmentActivation: null as number | null,
      maxEventRelativeSpeed: 0,
      maxSpeed: 0,
      maxVehiclePreviousStepSpeed: 0,
      vehicleCount: 0,
  })));
  const breakMutationTimersRef = useRef(new Set<number>());
  const chipMeshRef = useRef<THREE.InstancedMesh>(null);
  const chipBurstsRef = useRef<(ChipBurstRuntime | null)[]>(BREAKABLE_BLOCKS.map(() => null));
  const chipTransformRef = useRef(new THREE.Object3D());
  const chipColorRef = useRef(new THREE.Color());
  const latestFrameElapsedSecondsRef = useRef(0);
  const impactForwardRef = useRef<([number, number, number])[]>(
    BREAKABLE_BLOCKS.map(() => [0, 0, 1]),
  );

  /** block専用8slotのchip burstを、最新描画clockを基準に開始する。 */
  const triggerChipBurst = useCallback((
    blockIndex: number,
    origin: readonly [number, number, number],
    blockColor: string,
  ): void => {
    chipBurstsRef.current[blockIndex] = {
      blockColor,
      origin,
      startedAtSeconds: latestFrameElapsedSecondsRef.current,
    };
  }, []);

  useFrame(({ clock }) => {
    const mesh = chipMeshRef.current;
    if (!mesh) return;
    const elapsedSeconds = clock.elapsedTime;
    latestFrameElapsedSecondsRef.current = elapsedSeconds;
    const activeFrames = chipBurstsRef.current.flatMap((burst, blockIndex) => {
      if (!burst) return [];
      const ageSeconds = Math.max(0, elapsedSeconds - burst.startedAtSeconds);
      if (ageSeconds >= CHIP_LIFETIME_SECONDS) {
        chipBurstsRef.current[blockIndex] = null;
        return [];
      }
      return [createChipBurstFrame({
        ageSeconds,
        blockColor: burst.blockColor,
        origin: burst.origin,
        startSlot: blockIndex * CHIP_BURST_SIZE,
      })];
    });
    const instances = combineChipBurstFrames(activeFrames);
    const transform = chipTransformRef.current;
    const color = chipColorRef.current;
    for (const instance of instances) {
      transform.position.set(...instance.position);
      transform.scale.setScalar(instance.scale);
      transform.updateMatrix();
      mesh.setMatrixAt(instance.slot, transform.matrix);
      mesh.setColorAt(instance.slot, color.set(instance.color));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  /** 公開telemetryを固定実体参照から遅延評価し、設定値の自己申告を避ける。 */
  const refreshTelemetry = useCallback((): void => {
    const fragmentSlots = runtimeSlotsRef.current;
    const actualPool = createActualFragmentPoolSnapshot(fragmentSlots);
    const activeFragments = fragmentSlots.flatMap((runtimeSlot, slotIndex) => {
      const definition = BREAKABLE_FRAGMENT_POOL[slotIndex];
      const body = runtimeSlot.body;
      if (!definition || !body?.isEnabled() || !runtimeSlot.collider?.isEnabled()
        || !runtimeSlot.mesh?.visible) return [];
      const position = body.translation();
      return [{
        id: definition.id,
        position: [position.x, position.y, position.z] as const,
        scale: definition.scale,
      }];
    });
    const runtimeSnapshot = runtime.getSnapshot();
    const chipMesh = chipMeshRef.current;
    const chipMatrix = new THREE.Matrix4();
    const chipPosition = new THREE.Vector3();
    const chipScale = new THREE.Vector3();
    const chips = Array.from({ length: CHIP_POOL_SIZE }, (_, slot) => {
      if (!chipMesh) {
        return {
          active: false,
          position: INACTIVE_FRAGMENT_POSITION,
          scale: 0,
          slot,
        } as const;
      }
      chipMesh.getMatrixAt(slot, chipMatrix);
      chipPosition.setFromMatrixPosition(chipMatrix);
      chipScale.setFromMatrixScale(chipMatrix);
      const scale = Math.max(chipScale.x, chipScale.y, chipScale.z);
      return {
        active: scale > 0,
        position: [chipPosition.x, chipPosition.y, chipPosition.z] as const,
        scale,
        slot,
      } as const;
    });
    const blocks = BREAKABLE_BLOCKS.map((block, blockIndex) => {
      const slotIndices = BREAKABLE_FRAGMENT_SLOT_INDICES_BY_BLOCK[blockIndex] ?? [];
      const actualFragments = createActualFragmentPoolSnapshot(fragmentSlots, slotIndices);
      const intact = intactSlotsRef.current[blockIndex];
      const impact = impactTelemetryRef.current[blockIndex];
      const runtimeBlock = runtimeSnapshot.blocks[blockIndex];
      return {
        bodyHandles: actualFragments.bodyHandles,
        colliderHandles: actualFragments.colliderHandles,
        collisionEnabledFragmentCount: actualFragments.collisionEnabledFragmentCount,
        fragmentVisibleCount: actualFragments.visibleFragmentCount,
        id: block.id,
        impactCount: impact?.count ?? 0,
        intactBodyEnabledCount: intact?.body?.isEnabled() ? 1 : 0,
        intactBodyHandle: intact?.body?.handle ?? null,
        intactColliderEnabledCount: intact?.collider?.isEnabled() ? 1 : 0,
        intactColliderHandle: intact?.collider?.handle ?? null,
        intactEnabledCountAtFragmentActivation: impact?.intactEnabledCountAtFragmentActivation ?? null,
        intactVisible: runtimeBlock?.phase === 'intact' && (intact?.mesh?.visible ?? false),
        maxImpactSpeed: impact?.maxSpeed ?? 0,
        maxEventRelativeSpeed: impact?.maxEventRelativeSpeed ?? 0,
        maxVehiclePreviousStepSpeed: impact?.maxVehiclePreviousStepSpeed ?? 0,
        meshUuids: actualFragments.meshUuids,
        slotIds: slotIndices.map((slotIndex) => BREAKABLE_FRAGMENT_POOL_SLOT_IDS[slotIndex] ?? ''),
        vehicleImpactCount: impact?.vehicleCount ?? 0,
      } satisfies BreakableBlockTelemetry;
    });

    breakableTelemetryRef.current = {
      activeFragments,
      activeFragmentCount: actualPool.activeFragmentCount,
      blocks,
      bodyHandles: actualPool.bodyHandles,
      chipPoolSlotCount: CHIP_POOL_SIZE,
      chips,
      colliderHandles: actualPool.colliderHandles,
      collisionEnabledFragmentCount: actualPool.collisionEnabledFragmentCount,
      enabledBodyCount: actualPool.enabledBodyCount,
      meshUuids: actualPool.meshUuids,
      mountedBodyCount: actualPool.mountedBodyCount,
      mountedColliderCount: actualPool.mountedColliderCount,
      mountedMeshCount: actualPool.mountedMeshCount,
      poolSlotCount: actualPool.mountedBodyCount,
      poolSlotIds: BREAKABLE_FRAGMENT_POOL_SLOT_IDS,
      rapierSleepingFragmentCount: actualPool.rapierSleepingFragmentCount,
      sleepingFragmentCount: actualPool.sleepingFragmentCount,
      uniqueBodyHandleCount: actualPool.uniqueBodyHandleCount,
      uniqueColliderHandleCount: actualPool.uniqueColliderHandleCount,
      uniqueMeshUuidCount: actualPool.uniqueMeshUuidCount,
    };
  }, [breakableTelemetryRef, runtime]);

  /** runtime phaseを固定intact実体とfragment poolへ同期し、React unmountでRapier handleを捨てない。 */
  const syncRuntimeBodies = useCallback((snapshot: VoxelGameSnapshot): void => {
    const runtimeSlots = runtimeSlotsRef.current;
    let changedAnyBody = false;
    for (let blockIndex = 0; blockIndex < BREAKABLE_BLOCKS.length; blockIndex += 1) {
      const blockSnapshot = snapshot.blocks[blockIndex];
      if (!blockSnapshot) continue;
      const intact = intactSlotsRef.current[blockIndex];
      const shouldShowIntact = blockSnapshot.phase === 'intact';
      if (intact?.body && intact.body.isEnabled() !== shouldShowIntact) {
        intact.body.setEnabled(shouldShowIntact);
        changedAnyBody = true;
      }
      if (intact?.collider && intact.collider.isEnabled() !== shouldShowIntact) {
        intact.collider.setEnabled(shouldShowIntact);
        changedAnyBody = true;
      }
      if (intact?.mesh && intact.mesh.visible !== shouldShowIntact) {
        intact.mesh.visible = shouldShowIntact;
        changedAnyBody = true;
      }
      if (isFragmentWindowActive(
        blockSnapshot.phase,
        blockSnapshot.respawnRemainingMs,
      )) continue;
      for (const slotIndex of BREAKABLE_FRAGMENT_SLOT_INDICES_BY_BLOCK[blockIndex] ?? []) {
        const runtimeSlot = runtimeSlots[slotIndex];
        if (!runtimeSlot || !(
          runtimeSlot.active
          || runtimeSlot.body?.isEnabled()
          || runtimeSlot.collider?.isEnabled()
          || runtimeSlot.mesh?.visible
        )) continue;
        deactivateFragment(runtimeSlot);
        changedAnyBody = true;
      }
    }
    if (changedAnyBody) {
      refreshTelemetry();
    }
  }, [refreshTelemetry]);

  useEffect(() => {
    const runtimeSlots = runtimeSlotsRef.current;
    const resetChipInstances = (): void => {
      const mesh = chipMeshRef.current;
      if (!mesh) return;
      const transform = chipTransformRef.current;
      const color = chipColorRef.current.set('#000000');
      transform.position.set(...INACTIVE_FRAGMENT_POSITION);
      transform.scale.setScalar(0);
      transform.updateMatrix();
      for (let slot = 0; slot < CHIP_POOL_SIZE; slot += 1) {
        mesh.setMatrixAt(slot, transform.matrix);
        mesh.setColorAt(slot, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    runtimeSlots.forEach(deactivateFragment);
    resetChipInstances();
    refreshTelemetry();
    return () => {
      runtimeSlots.forEach((slot) => {
        if (slot.mesh) slot.mesh.visible = false;
        slot.active = false;
      });
      chipBurstsRef.current.fill(null);
      resetChipInstances();
    };
  }, [refreshTelemetry]);

  useEffect(() => () => {
    for (const timer of breakMutationTimersRef.current) window.clearTimeout(timer);
    breakMutationTimersRef.current.clear();
  }, []);

  useImperativeHandle(breakablePoolHandleRef, () => ({
    readActualTelemetry: () => {
      refreshTelemetry();
      return breakableTelemetryRef.current;
    },
    syncAfterRuntimeAdvance: () => syncRuntimeBodies(runtime.getSnapshot()),
  }), [breakableTelemetryRef, refreshTelemetry, runtime, syncRuntimeBodies]);

  return (
    <group>
      {BREAKABLE_BLOCKS.map((block, index) => (
        <RigidBody
          colliders={false}
          key={block.id}
          onCollisionEnter={(payload) => {
            if (runtime.getSnapshot().blocks[index]?.phase !== 'intact') return;
            const eventRelativeSpeed = getCollisionRelativeLinearSpeed(payload);
            const collisionBodyIsVehicle = isCollisionBodyVehicle(
              payload.other.rigidBody,
              telemetryRef.current,
            );
            const speed = resolveBlockImpactSpeed({
              collisionBodyIsVehicle,
              eventRelativeSpeed,
              vehiclePreviousStepSpeed: telemetryRef.current.speed,
            });
            const impact = impactTelemetryRef.current[index];
            if (impact) {
              impact.count += 1;
              impact.maxEventRelativeSpeed = Math.max(impact.maxEventRelativeSpeed, eventRelativeSpeed);
              impact.maxSpeed = Math.max(impact.maxSpeed, speed);
              if (collisionBodyIsVehicle) {
                impact.vehicleCount += 1;
                impact.maxVehiclePreviousStepSpeed = Math.max(
                  impact.maxVehiclePreviousStepSpeed,
                  telemetryRef.current.speed,
                );
              }
            }
            const newlyBroken = runtime.registerBlockImpact(block.id, speed);
            if (!newlyBroken) {
              refreshTelemetry();
              return;
            }

            impactForwardRef.current[index] = [
              telemetryRef.current.forward[0],
              0,
              telemetryRef.current.forward[2],
            ];
            triggerChipBurst(index, block.position, block.color);

            const breakMutationTimer = window.setTimeout(() => {
              breakMutationTimersRef.current.delete(breakMutationTimer);
              const intactSlot = intactSlotsRef.current[index];
              intactSlot?.collider?.setEnabled(false);
              intactSlot?.body?.setEnabled(false);
              if (intactSlot?.mesh) intactSlot.mesh.visible = false;
              if (impact) {
                impact.intactEnabledCountAtFragmentActivation = Number(
                  intactSlot?.body?.isEnabled() ?? false,
                ) + Number(intactSlot?.collider?.isEnabled() ?? false);
              }
              for (const slotIndex of BREAKABLE_FRAGMENT_SLOT_INDICES_BY_BLOCK[index] ?? []) {
                const slot = BREAKABLE_FRAGMENT_POOL[slotIndex];
                const runtimeSlot = runtimeSlotsRef.current[slotIndex];
                if (slot && runtimeSlot) {
                  activateFragment(
                    slot,
                    runtimeSlot,
                    block.position,
                    impactForwardRef.current[index] ?? [0, 0, 1],
                  );
                }
              }
              refreshTelemetry();
            }, 0);
            breakMutationTimersRef.current.add(breakMutationTimer);
          }}
          position={block.position}
          ref={intactBodyRefCallbacks[index]}
          rotation={[0, index * 0.22, 0]}
          type="fixed"
        >
          <CuboidCollider
            args={[0.75, 0.75, 0.75]}
            ref={intactColliderRefCallbacks[index]}
          />
          <mesh ref={intactMeshRefCallbacks[index]}>
            <boxGeometry args={[1.5, 1.5, 1.5]} />
            <meshLambertMaterial color={block.color} />
          </mesh>
        </RigidBody>
      ))}
      {BREAKABLE_FRAGMENT_POOL.map((slot, index) => (
        <RigidBody
          angularDamping={1.4}
          colliders={false}
          key={slot.id}
          linearDamping={0.6}
          position={INACTIVE_FRAGMENT_POSITION}
          ref={fragmentBodyRefCallbacks[index]}
        >
          <CuboidCollider
            args={[slot.scale[0] / 2, slot.scale[1] / 2, slot.scale[2] / 2]}
            friction={0.75}
            ref={fragmentColliderRefCallbacks[index]}
            restitution={0.22}
          />
          <mesh
            ref={fragmentMeshRefCallbacks[index]}
            visible={false}
          >
            <boxGeometry args={slot.scale} />
            <meshLambertMaterial color={slot.color} />
          </mesh>
        </RigidBody>
      ))}
      <instancedMesh
        args={[undefined, undefined, CHIP_POOL_SIZE]}
        frustumCulled={false}
        ref={chipMeshRef}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial vertexColors />
      </instancedMesh>
    </group>
  );
}

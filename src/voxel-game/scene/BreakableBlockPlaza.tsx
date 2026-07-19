import { useEffect, useRef, useState } from 'react';
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
import type { BreakablePhase, VoxelGameRuntime } from '../domain/VoxelGameRuntime';
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
  readonly localPosition: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly velocity: readonly [number, number, number];
}

export interface BreakableBlockTelemetry {
  readonly collisionEnabledFragmentCount: number;
  readonly fragmentVisibleCount: number;
  readonly id: string;
  readonly impactCount: number;
  readonly intactVisible: boolean;
  readonly maxImpactSpeed: number;
  readonly maxEventRelativeSpeed: number;
  readonly maxVehiclePreviousStepSpeed: number;
  readonly slotIds: readonly string[];
  readonly vehicleImpactCount: number;
}

export interface BreakableTelemetry {
  readonly activeFragmentCount: number;
  readonly blocks: readonly BreakableBlockTelemetry[];
  readonly collisionEnabledFragmentCount: number;
  readonly poolSlotCount: number;
  readonly poolSlotIds: readonly string[];
  readonly sleepingFragmentCount: number;
}

export type BreakableTelemetryRef = React.MutableRefObject<BreakableTelemetry>;

interface BreakableBlockPlazaProps {
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

export interface BlockImpactSpeedInput {
  readonly collisionBodyIsVehicle: boolean;
  readonly eventRelativeSpeed: number;
  readonly vehiclePreviousStepSpeed: number;
}

export const BREAKABLE_FRAGMENT_SLOTS_PER_BLOCK = 6;
export const BREAKABLE_FRAGMENT_LIFETIME_MS = 1_200;
const BLOCK_RESPAWN_DURATION_MS = 5_000;
const FRAGMENT_WINDOW_END_REMAINING_MS = BLOCK_RESPAWN_DURATION_MS - BREAKABLE_FRAGMENT_LIFETIME_MS;
const FRAGMENT_SCALE = [0.56, 0.56, 0.56] as const;
const INACTIVE_FRAGMENT_POSITION = [0, -40, 0] as const;
const ZERO_VELOCITY = { x: 0, y: 0, z: 0 } as const;
const IDENTITY_ROTATION = { w: 1, x: 0, y: 0, z: 0 } as const;

const FRAGMENT_TEMPLATES = [
  { localPosition: [0.32, 0.26, 0] as const, velocity: [3.2, 1.6, 0] as const },
  { localPosition: [0.12, 0.18, 0.28] as const, velocity: [2.7, 1.8, 0.8] as const },
  { localPosition: [0.12, 0.42, 0] as const, velocity: [2.4, 2.8, 0] as const },
  { localPosition: [0.12, 0.12, 0.36] as const, velocity: [2.7, 1.8, 1.8] as const },
  { localPosition: [0.12, 0.12, -0.36] as const, velocity: [2.7, 1.8, -1.8] as const },
  { localPosition: [0.28, -0.18, -0.2] as const, velocity: [2.1, 2.6, -0.8] as const },
] as const;

/** block定義ごとに専用6片を割り当て、再生成しない固定pool定義を返す。 */
export function createBreakableFragmentPool(
  blocks: readonly BreakableBlockDefinition[],
): readonly BreakableFragmentSlot[] {
  return blocks.flatMap((block) => FRAGMENT_TEMPLATES.map((template, index) => ({
    blockId: block.id,
    color: block.color,
    id: `${block.id}:fragment-${index}`,
    index,
    localPosition: template.localPosition,
    scale: FRAGMENT_SCALE,
    velocity: template.velocity,
  })));
}

export const BREAKABLE_FRAGMENT_POOL = createBreakableFragmentPool(BREAKABLE_BLOCKS);

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

/** after-step eventでは衝突車両の前step速度を使い、他bodyはevent時の実速度を使う。 */
export function resolveBlockImpactSpeed({
  collisionBodyIsVehicle,
  eventRelativeSpeed,
  vehiclePreviousStepSpeed,
}: BlockImpactSpeedInput): number {
  return collisionBodyIsVehicle ? vehiclePreviousStepSpeed : eventRelativeSpeed;
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
  return phase === 'broken' && respawnRemainingMs > FRAGMENT_WINDOW_END_REMAINING_MS;
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
): void {
  const body = runtimeSlot.body;
  if (!body) return;
  body.setEnabled(true);
  runtimeSlot.collider?.setEnabled(true);
  body.setTranslation({
    x: blockPosition[0] + slot.localPosition[0],
    y: blockPosition[1] + slot.localPosition[1],
    z: blockPosition[2] + slot.localPosition[2],
  }, true);
  body.setRotation(IDENTITY_ROTATION, true);
  body.setLinvel({ x: slot.velocity[0], y: slot.velocity[1], z: slot.velocity[2] }, true);
  body.setAngvel({
    x: slot.velocity[2] * 0.45,
    y: slot.velocity[0] * 0.3,
    z: -slot.velocity[0] * 0.45,
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
    runtimeSlot.body.setLinvel(ZERO_VELOCITY, false);
    runtimeSlot.body.setAngvel(ZERO_VELOCITY, false);
    runtimeSlot.body.sleep();
    runtimeSlot.body.setEnabled(false);
  }
  runtimeSlot.active = false;
}

/** 4つの壊せる積み木と、常時24slotだけを持つRapier破片poolを構成する。 */
export function BreakableBlockPlaza({
  breakableTelemetryRef,
  runtime,
  telemetryRef,
}: BreakableBlockPlazaProps): ReactElement {
  const [blockPhases, setBlockPhases] = useState<Record<string, BreakablePhase>>(() => Object.fromEntries(
    runtime.getSnapshot().blocks.map(({ id, phase }) => [id, phase]),
  ));
  const runtimeSlotsRef = useRef<FragmentRuntimeSlot[]>(BREAKABLE_FRAGMENT_POOL.map(() => ({
    active: false,
    body: null,
    collider: null,
    mesh: null,
  })));
  const previousPhasesRef = useRef(new Map(
    runtime.getSnapshot().blocks.map(({ id, phase }) => [id, phase]),
  ));
  const impactTelemetryRef = useRef(new Map(
    BREAKABLE_BLOCKS.map(({ id }) => [id, {
      count: 0,
      maxEventRelativeSpeed: 0,
      maxSpeed: 0,
      maxVehiclePreviousStepSpeed: 0,
      vehicleCount: 0,
    }]),
  ));

  useEffect(() => runtime.subscribe((snapshot) => {
    setBlockPhases((current) => {
      const next = Object.fromEntries(snapshot.blocks.map(({ id, phase }) => [id, phase]));
      return snapshot.blocks.every(({ id, phase }) => current[id] === phase) ? current : next;
    });
  }), [runtime]);

  useEffect(() => {
    const runtimeSlots = runtimeSlotsRef.current;
    runtimeSlots.forEach(deactivateFragment);
    return () => runtimeSlots.forEach((slot) => {
      if (slot.mesh) slot.mesh.visible = false;
      slot.active = false;
    });
  }, []);

  useFrame(() => {
    const snapshot = runtime.getSnapshot();
    const runtimeSlots = runtimeSlotsRef.current;

    for (const block of BREAKABLE_BLOCKS) {
      runtime.setBlockClear(
        block.id,
        isBlockRespawnAreaClear(block.position, telemetryRef.current.position),
      );
      const blockSnapshot = snapshot.blocks.find(({ id }) => id === block.id);
      if (!blockSnapshot) continue;
      const previousPhase = previousPhasesRef.current.get(block.id);
      const fragmentWindowActive = isFragmentWindowActive(
        blockSnapshot.phase,
        blockSnapshot.respawnRemainingMs,
      );

      BREAKABLE_FRAGMENT_POOL.forEach((slot, slotIndex) => {
        if (slot.blockId !== block.id) return;
        const runtimeSlot = runtimeSlots[slotIndex];
        if (!runtimeSlot) return;
        if (blockSnapshot.phase === 'broken' && previousPhase !== 'broken') {
          activateFragment(slot, runtimeSlot, block.position);
        }
        if (!fragmentWindowActive && runtimeSlot.active) deactivateFragment(runtimeSlot);
      });
      previousPhasesRef.current.set(block.id, blockSnapshot.phase);
    }

    const blockSnapshotById = new Map(snapshot.blocks.map((block) => [block.id, block]));
    const blocks = BREAKABLE_BLOCKS.map((block) => {
      const slotIndexes = BREAKABLE_FRAGMENT_POOL
        .map((slot, index) => slot.blockId === block.id ? index : -1)
        .filter((index) => index >= 0);
      const blockRuntimeSlots = slotIndexes.map((index) => runtimeSlots[index]);
      const impact = impactTelemetryRef.current.get(block.id);
      return {
        collisionEnabledFragmentCount: blockRuntimeSlots.filter((slot) => (
          slot?.body?.isEnabled() && slot.collider?.isEnabled()
        )).length,
        fragmentVisibleCount: blockRuntimeSlots.filter((slot) => slot?.mesh?.visible).length,
        id: block.id,
        impactCount: impact?.count ?? 0,
        intactVisible: blockSnapshotById.get(block.id)?.phase === 'intact',
        maxImpactSpeed: impact?.maxSpeed ?? 0,
        maxEventRelativeSpeed: impact?.maxEventRelativeSpeed ?? 0,
        maxVehiclePreviousStepSpeed: impact?.maxVehiclePreviousStepSpeed ?? 0,
        slotIds: slotIndexes.map((index) => BREAKABLE_FRAGMENT_POOL[index]?.id ?? ''),
        vehicleImpactCount: impact?.vehicleCount ?? 0,
      } satisfies BreakableBlockTelemetry;
    });
    breakableTelemetryRef.current = {
      activeFragmentCount: runtimeSlots.filter((slot) => slot.active).length,
      blocks,
      collisionEnabledFragmentCount: runtimeSlots.filter((slot) => (
        slot.body?.isEnabled() && slot.collider?.isEnabled()
      )).length,
      poolSlotCount: BREAKABLE_FRAGMENT_POOL.length,
      poolSlotIds: BREAKABLE_FRAGMENT_POOL.map(({ id }) => id),
      sleepingFragmentCount: runtimeSlots.filter((slot) => slot.body?.isSleeping()).length,
    };
  });

  return (
    <group>
      {BREAKABLE_BLOCKS.map((block, index) => blockPhases[block.id] === 'intact' ? (
        <RigidBody
          colliders={false}
          key={block.id}
          onCollisionEnter={(payload) => {
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
            const impact = impactTelemetryRef.current.get(block.id);
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
            runtime.registerBlockImpact(block.id, speed);
          }}
          position={block.position}
          rotation={[0, index * 0.22, 0]}
          type="fixed"
        >
          <CuboidCollider args={[0.75, 0.75, 0.75]} />
          <mesh>
            <boxGeometry args={[1.5, 1.5, 1.5]} />
            <meshLambertMaterial color={block.color} />
          </mesh>
        </RigidBody>
      ) : null)}
      {BREAKABLE_FRAGMENT_POOL.map((slot, index) => (
        <RigidBody
          angularDamping={1.4}
          colliders={false}
          key={slot.id}
          linearDamping={0.6}
          position={INACTIVE_FRAGMENT_POSITION}
          ref={(body) => {
            const runtimeSlot = runtimeSlotsRef.current[index];
            if (runtimeSlot) runtimeSlot.body = body;
          }}
        >
          <CuboidCollider
            args={[slot.scale[0] / 2, slot.scale[1] / 2, slot.scale[2] / 2]}
            friction={0.75}
            ref={(collider) => {
              const runtimeSlot = runtimeSlotsRef.current[index];
              if (runtimeSlot) runtimeSlot.collider = collider;
            }}
            restitution={0.22}
          />
          <mesh
            ref={(mesh) => {
              const runtimeSlot = runtimeSlotsRef.current[index];
              if (runtimeSlot) runtimeSlot.mesh = mesh;
            }}
            visible={false}
          >
            <boxGeometry args={slot.scale} />
            <meshLambertMaterial color={slot.color} />
          </mesh>
        </RigidBody>
      ))}
    </group>
  );
}

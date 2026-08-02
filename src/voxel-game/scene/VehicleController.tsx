import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import type { MutableRefObject, ReactElement, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { VoxelFireTruck } from '../../vehicle-lab/scene/VoxelFireTruck';
import { VoxelBulldozer } from '../../vehicle-lab/scene/VoxelBulldozer';
import { VoxelExcavator } from '../../vehicle-lab/scene/VoxelExcavator';
import { VoxelAmbulance } from '../../vehicle-lab/scene/VoxelAmbulance';
import { VoxelPolice } from '../../vehicle-lab/scene/VoxelPolice';
import {
  getVehicleDefinition,
  type VehicleColliderDefinition,
  type VehicleId,
  type VehiclePhysicsDefinition,
} from '../domain/vehicleDefinitions';
import type { DriveCommand } from '../input/controlState';
import { VEHICLE_GARAGE_POSITION, WORLD_BOUNDS } from './worldLayout';
import { WORLD_FRAME_UPDATE_PRIORITIES } from './worldFrameUpdatePriorities';
import { resolveScreenRelativeMovement, shortestAngleDelta } from './screenRelativeMovement';

export interface VehicleTelemetry {
  readonly forward: readonly [number, number, number];
  readonly id: VehicleId;
  readonly mass: number;
  readonly position: readonly [number, number, number];
  readonly resetCount: number;
  readonly speed: number;
}

export type VehicleTelemetryRef = React.MutableRefObject<VehicleTelemetry>;

/** Rapierが描画補間した車体rootのworld位置をcameraへ渡すref。 */
export type VehicleVisualPositionRef = MutableRefObject<readonly [number, number, number]>;

/** 親から車両を車庫へ戻すための命令API。 */
export interface VehicleControllerHandle {
  resetVehicle(): void;
}

interface VehicleControllerProps {
  readonly commandRef: RefObject<DriveCommand>;
  readonly paintColor?: string | null;
  readonly telemetryRef: VehicleTelemetryRef;
  readonly vehicleId: VehicleId;
  readonly visualPositionRef: VehicleVisualPositionRef;
}

/** controllerが毎frameとRapierへ渡す車種別設定。 */
export interface VehicleControllerConfig {
  readonly collider: VehicleColliderDefinition;
  readonly physics: VehiclePhysicsDefinition;
  readonly vehicleId: VehicleId;
}

const BASE_FORWARD = new THREE.Vector3(0, 0, 1);
const quaternion = new THREE.Quaternion();
const forward = new THREE.Vector3();
const visualWorldPosition = new THREE.Vector3();

/** 任意IDを既知車種へ解決し、controllerが使う設定だけを返す。 */
export function resolveVehicleControllerConfig(id: unknown): VehicleControllerConfig {
  const definition = getVehicleDefinition(id);
  return {
    collider: definition.collider,
    physics: definition.physics,
    vehicleId: definition.id,
  };
}

/** 指定車種を車庫へ置いた初期telemetryを返す。 */
export function createInitialVehicleTelemetry(vehicleId: VehicleId): VehicleTelemetry {
  const config = resolveVehicleControllerConfig(vehicleId);
  return {
    forward: [0, 0, 1],
    id: config.vehicleId,
    mass: config.physics.mass,
    position: [...VEHICLE_GARAGE_POSITION],
    resetCount: 0,
    speed: 0,
  };
}

/** Rapierの回転quaternionから水平yaw角を返す。 */
function getYaw(rotation: { readonly w: number; readonly x: number; readonly y: number; readonly z: number }): number {
  return Math.atan2(
    2 * (rotation.w * rotation.y + rotation.x * rotation.z),
    1 - 2 * (rotation.y * rotation.y + rotation.z * rotation.z),
  );
}

/** 車両が落下したか、箱庭境界を2unit以上越えたかを判定する。 */
function isOutsideResetEnvelope(position: { readonly x: number; readonly y: number; readonly z: number }): boolean {
  return position.y < -2
    || position.x < WORLD_BOUNDS.minX - 2
    || position.x > WORLD_BOUNDS.maxX + 2
    || position.z < WORLD_BOUNDS.minZ - 2
    || position.z > WORLD_BOUNDS.maxZ + 2;
}

/** 現在telemetryを指定位置と向きへ同期する。 */
function updateTelemetry(
  telemetryRef: VehicleTelemetryRef,
  position: { readonly x: number; readonly y: number; readonly z: number },
  direction: THREE.Vector3,
  mass: number,
  speed: number,
): void {
  telemetryRef.current = {
    forward: [direction.x, direction.y, direction.z],
    id: telemetryRef.current.id,
    mass,
    position: [position.x, position.y, position.z],
    resetCount: telemetryRef.current.resetCount,
    speed,
  };
}

/** 選択IDに対応する純voxel車体を1台だけ描画する。 */
function SelectedVehicleModel({
  actionActiveRef,
  paintColor,
  vehicleId,
}: {
  readonly actionActiveRef: RefObject<boolean>;
  readonly paintColor: string | null;
  readonly vehicleId: VehicleId;
}): ReactElement {
  if (vehicleId === 'fire-truck') return <VoxelFireTruck paintColor={paintColor} />;
  if (vehicleId === 'bulldozer') {
    return <VoxelBulldozer actionActiveRef={actionActiveRef} paintColor={paintColor} />;
  }
  if (vehicleId === 'excavator') {
    return <VoxelExcavator actionActiveRef={actionActiveRef} paintColor={paintColor} />;
  }
  if (vehicleId === 'ambulance') {
    return <VoxelAmbulance actionActiveRef={actionActiveRef} paintColor={paintColor} />;
  }
  return <VoxelPolice actionActiveRef={actionActiveRef} paintColor={paintColor} />;
}

/** 入力refを毎frame読み、消防車の速度・旋回・resetをRapierへ反映する。 */
export const VehicleController = forwardRef<VehicleControllerHandle, VehicleControllerProps>(
  function VehicleController({
    commandRef,
    paintColor = null,
    telemetryRef,
    vehicleId,
    visualPositionRef,
  }, ref): ReactElement {
    const bodyRef = useRef<RapierRigidBody>(null);
    const actionActiveRef = useRef(false);
    const visualRootRef = useRef<THREE.Group>(null);
    const config = resolveVehicleControllerConfig(vehicleId);

    /** 剛体とtelemetryを車庫の初期状態へ戻す。 */
    const resetVehicle = useCallback((): void => {
      const body = bodyRef.current;
      telemetryRef.current = {
        forward: [0, 0, 1],
        id: config.vehicleId,
        mass: body?.mass() ?? telemetryRef.current.mass,
        position: [...VEHICLE_GARAGE_POSITION],
        resetCount: telemetryRef.current.resetCount + 1,
        speed: 0,
      };
      visualPositionRef.current = [...VEHICLE_GARAGE_POSITION];
      if (!body) return;
      body.setTranslation({
        x: VEHICLE_GARAGE_POSITION[0],
        y: VEHICLE_GARAGE_POSITION[1],
        z: VEHICLE_GARAGE_POSITION[2],
      }, true);
      body.setRotation({ w: 1, x: 0, y: 0, z: 0 }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }, [config.vehicleId, telemetryRef, visualPositionRef]);

    useImperativeHandle(ref, () => ({ resetVehicle }), [resetVehicle]);

    useFrame((_state, delta) => {
      actionActiveRef.current = commandRef.current.primaryAction;
      const body = bodyRef.current;
      if (!body) return;

      const visualRoot = visualRootRef.current;
      if (visualRoot) {
        visualRoot.getWorldPosition(visualWorldPosition);
        visualPositionRef.current = [visualWorldPosition.x, visualWorldPosition.y, visualWorldPosition.z];
      }

      const position = body.translation();
      if (isOutsideResetEnvelope(position)) {
        resetVehicle();
        return;
      }

      const rotation = body.rotation();
      const yaw = getYaw(rotation);
      quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      forward.copy(BASE_FORWARD).applyQuaternion(quaternion).normalize();

      const command = commandRef.current;
      const movement = resolveScreenRelativeMovement(command);
      const velocity = body.linvel();
      const moving = movement.magnitude > 0 && movement.targetYaw !== null;
      const response = moving ? config.physics.movingResponse : config.physics.idleResponse;
      const nextVelocityX = THREE.MathUtils.damp(velocity.x, movement.velocity[0], response, delta);
      const nextVelocityZ = THREE.MathUtils.damp(velocity.z, movement.velocity[2], response, delta);
      const targetYawVelocity = moving
        ? THREE.MathUtils.clamp(
          shortestAngleDelta(yaw, movement.targetYaw) * 8,
          -config.physics.yawClamp,
          config.physics.yawClamp,
        )
        : 0;

      body.setLinvel({ x: nextVelocityX, y: velocity.y, z: nextVelocityZ }, true);
      body.setAngvel({ x: 0, y: targetYawVelocity, z: 0 }, true);
      updateTelemetry(telemetryRef, position, forward, body.mass(), Math.hypot(nextVelocityX, nextVelocityZ));
    }, WORLD_FRAME_UPDATE_PRIORITIES.vehicleVisualSync);

    return (
      <RigidBody
        angularDamping={5}
        colliders={false}
        enabledRotations={[false, true, false]}
        linearDamping={2.2}
        position={VEHICLE_GARAGE_POSITION}
        ref={bodyRef}
      >
        <CuboidCollider
          args={[...config.collider.halfExtents]}
          mass={config.physics.mass}
          position={config.collider.offset}
        />
        <group ref={visualRootRef} rotation={[0, Math.PI, 0]}>
          <SelectedVehicleModel
            actionActiveRef={actionActiveRef}
            paintColor={paintColor}
            vehicleId={config.vehicleId}
          />
        </group>
      </RigidBody>
    );
  },
);

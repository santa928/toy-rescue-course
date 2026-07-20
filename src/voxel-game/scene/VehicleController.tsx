import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import type { ReactElement, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { VoxelFireTruck } from '../../vehicle-lab/scene/VoxelFireTruck';
import type { DriveCommand } from '../input/controlState';
import { GARAGE_POSITION, WORLD_BOUNDS } from './worldLayout';
import { resolveScreenRelativeMovement, shortestAngleDelta } from './screenRelativeMovement';

export interface VehicleTelemetry {
  readonly forward: readonly [number, number, number];
  readonly mass: number;
  readonly position: readonly [number, number, number];
  readonly resetCount: number;
  readonly speed: number;
}

export type VehicleTelemetryRef = React.MutableRefObject<VehicleTelemetry>;

/** 親から車両を車庫へ戻すための命令API。 */
export interface VehicleControllerHandle {
  resetVehicle(): void;
}

interface VehicleControllerProps {
  readonly commandRef: RefObject<DriveCommand>;
  readonly telemetryRef: VehicleTelemetryRef;
}

const BASE_FORWARD = new THREE.Vector3(0, 0, 1);
const quaternion = new THREE.Quaternion();
const forward = new THREE.Vector3();

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
    mass,
    position: [position.x, position.y, position.z],
    resetCount: telemetryRef.current.resetCount,
    speed,
  };
}

/** 入力refを毎frame読み、消防車の速度・旋回・resetをRapierへ反映する。 */
export const VehicleController = forwardRef<VehicleControllerHandle, VehicleControllerProps>(
  function VehicleController({ commandRef, telemetryRef }, ref): ReactElement {
    const bodyRef = useRef<RapierRigidBody>(null);

    /** 剛体とtelemetryを車庫の初期状態へ戻す。 */
    const resetVehicle = useCallback((): void => {
      const body = bodyRef.current;
      telemetryRef.current = {
        forward: [0, 0, 1],
        mass: body?.mass() ?? telemetryRef.current.mass,
        position: [...GARAGE_POSITION],
        resetCount: telemetryRef.current.resetCount + 1,
        speed: 0,
      };
      if (!body) return;
      body.setTranslation({ x: GARAGE_POSITION[0], y: GARAGE_POSITION[1], z: GARAGE_POSITION[2] }, true);
      body.setRotation({ w: 1, x: 0, y: 0, z: 0 }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }, [telemetryRef]);

    useImperativeHandle(ref, () => ({ resetVehicle }), [resetVehicle]);

    useFrame((_state, delta) => {
      const body = bodyRef.current;
      if (!body) return;

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
      const response = moving ? 7.5 : 4.8;
      const nextVelocityX = THREE.MathUtils.damp(velocity.x, movement.velocity[0], response, delta);
      const nextVelocityZ = THREE.MathUtils.damp(velocity.z, movement.velocity[2], response, delta);
      const targetYawVelocity = moving
        ? THREE.MathUtils.clamp(shortestAngleDelta(yaw, movement.targetYaw) * 8, -5.2, 5.2)
        : 0;

      body.setLinvel({ x: nextVelocityX, y: velocity.y, z: nextVelocityZ }, true);
      body.setAngvel({ x: 0, y: targetYawVelocity, z: 0 }, true);
      updateTelemetry(telemetryRef, position, forward, body.mass(), Math.hypot(nextVelocityX, nextVelocityZ));
    });

    return (
      <RigidBody
        angularDamping={5}
        colliders={false}
        enabledRotations={[false, true, false]}
        linearDamping={2.2}
        position={GARAGE_POSITION}
        ref={bodyRef}
      >
        <CuboidCollider args={[1.45, 0.95, 1.7]} mass={1.4} position={[0, 0.95, 0]} />
        <group rotation={[0, Math.PI, 0]}>
          <VoxelFireTruck />
        </group>
      </RigidBody>
    );
  },
);

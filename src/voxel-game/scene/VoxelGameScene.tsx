import { useEffect, useRef } from 'react';
import type { ReactElement, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, Physics, RigidBody } from '@react-three/rapier';
import type { DriveCommand } from '../input/controlState';
import {
  VehicleController,
  type VehicleControllerHandle,
  type VehicleTelemetryRef,
} from './VehicleController';
import { VoxelWorld } from './VoxelWorld';
import { WorldFixedCamera } from './WorldFixedCamera';

interface VoxelGameSceneProps {
  readonly commandRef: RefObject<DriveCommand>;
  readonly controllerRef: RefObject<VehicleControllerHandle | null>;
  readonly telemetryRef: VehicleTelemetryRef;
}

/** 複数frameとdraw callを確認してから自動検証へscene readyを通知する。 */
function SceneReadySignal(): null {
  const renderedFrameCount = useRef(0);

  useFrame(({ gl }) => {
    renderedFrameCount.current += 1;
    if (renderedFrameCount.current >= 3 && gl.info.render.calls > 0) {
      document.documentElement.dataset.voxelSceneReady = 'true';
    }
  });

  useEffect(
    () => () => {
      delete document.documentElement.dataset.voxelSceneReady;
    },
    [],
  );

  return null;
}

/** 箱庭の照明、世界方向固定camera、物理空間、運転可能な消防車を構成する。 */
export function VoxelGameScene({ commandRef, controllerRef, telemetryRef }: VoxelGameSceneProps): ReactElement {
  return (
    <>
      <color attach="background" args={['#ead4b3']} />
      <WorldFixedCamera telemetryRef={telemetryRef} />
      <SceneReadySignal />
      <ambientLight intensity={1.5} />
      <directionalLight intensity={2.1} position={[20, 34, 18]} />
      <directionalLight color="#cbe0ff" intensity={0.75} position={[-18, 20, -14]} />
      <Physics gravity={[0, -18, 0]}>
        <VoxelWorld />
        <RigidBody colliders={false} type="fixed">
          <CuboidCollider args={[18, 0.2, 18]} position={[0, -0.2, 0]} />
        </RigidBody>
        <VehicleController commandRef={commandRef} ref={controllerRef} telemetryRef={telemetryRef} />
      </Physics>
    </>
  );
}

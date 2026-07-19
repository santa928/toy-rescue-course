import { useEffect, useRef } from 'react';
import type { ReactElement, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, Physics, RigidBody } from '@react-three/rapier';
import type { DriveCommand } from '../input/controlState';
import { advanceRuntimeFrame, type VoxelGameRuntime } from '../domain/VoxelGameRuntime';
import {
  VehicleController,
  type VehicleControllerHandle,
  type VehicleTelemetryRef,
} from './VehicleController';
import { BreakableBlockPlaza, type BreakableTelemetryRef } from './BreakableBlockPlaza';
import { VoxelWorld } from './VoxelWorld';
import { WaterAndFire, type MissionTelemetryRef } from './WaterAndFire';
import { WorldFixedCamera, type WorldCameraTelemetryRef } from './WorldFixedCamera';

interface VoxelGameSceneProps {
  readonly breakableTelemetryRef: BreakableTelemetryRef;
  readonly cameraTelemetryRef?: WorldCameraTelemetryRef;
  readonly commandRef: RefObject<DriveCommand>;
  readonly controllerRef: RefObject<VehicleControllerHandle | null>;
  readonly manualClockRef: React.MutableRefObject<boolean>;
  readonly missionTelemetryRef: MissionTelemetryRef;
  readonly runtime: VoxelGameRuntime;
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

interface RuntimeClockProps {
  readonly manualClockRef: React.MutableRefObject<boolean>;
  readonly runtime: VoxelGameRuntime;
}

/** 通常frameだけruntimeを進め、手動clock直後の1frameは二重加算を避ける。 */
function RuntimeClock({ manualClockRef, runtime }: RuntimeClockProps): null {
  useFrame((_state, delta) => {
    advanceRuntimeFrame(runtime, manualClockRef, delta);
  });
  return null;
}

/** 箱庭の照明、世界方向固定camera、物理空間、運転可能な消防車を構成する。 */
export function VoxelGameScene({
  breakableTelemetryRef,
  cameraTelemetryRef,
  commandRef,
  controllerRef,
  manualClockRef,
  missionTelemetryRef,
  runtime,
  telemetryRef,
}: VoxelGameSceneProps): ReactElement {
  return (
    <>
      <color attach="background" args={['#ead4b3']} />
      <WorldFixedCamera cameraTelemetryRef={cameraTelemetryRef} telemetryRef={telemetryRef} />
      <SceneReadySignal />
      <RuntimeClock manualClockRef={manualClockRef} runtime={runtime} />
      <ambientLight intensity={1.5} />
      <directionalLight intensity={2.1} position={[20, 34, 18]} />
      <directionalLight color="#cbe0ff" intensity={0.75} position={[-18, 20, -14]} />
      <Physics gravity={[0, -18, 0]}>
        <VoxelWorld />
        <BreakableBlockPlaza
          breakableTelemetryRef={breakableTelemetryRef}
          runtime={runtime}
          telemetryRef={telemetryRef}
        />
        <WaterAndFire
          commandRef={commandRef}
          missionTelemetryRef={missionTelemetryRef}
          runtime={runtime}
          telemetryRef={telemetryRef}
        />
        <RigidBody colliders={false} type="fixed">
          <CuboidCollider args={[18, 0.2, 18]} position={[0, -0.2, 0]} />
        </RigidBody>
        <VehicleController commandRef={commandRef} ref={controllerRef} telemetryRef={telemetryRef} />
      </Physics>
    </>
  );
}

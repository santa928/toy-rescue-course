import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject, ReactElement, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, Physics, RigidBody } from '@react-three/rapier';
import type { DriveCommand } from '../input/controlState';
import {
  canSwitchVehicle,
  type VehicleId,
} from '../domain/vehicleDefinitions';
import {
  advanceVehicleMissionFrame,
  type VehicleMissionCoordinator,
} from '../domain/VehicleMissionCoordinator';
import {
  syncBlockClearance,
  type VoxelGameRuntime,
} from '../domain/VoxelGameRuntime';
import {
  VehicleController,
  type VehicleControllerHandle,
  type VehicleTelemetryRef,
} from './VehicleController';
import {
  BreakableBlockPlaza,
  type BreakablePoolHandleRef,
  type BreakableTelemetryRef,
} from './BreakableBlockPlaza';
import { VoxelWorld } from './VoxelWorld';
import { WaterAndFire, type MissionTelemetryRef } from './WaterAndFire';
import {
  BulldozerDebrisMission,
  type BulldozerMissionSnapshotRef,
  type BulldozerMissionTelemetryRef,
} from './BulldozerDebrisMission';
import { WorldFixedCamera, type WorldCameraTelemetryRef } from './WorldFixedCamera';
import { WORLD_GROUND_BOX, scaleToHalfExtents } from './worldCollisionLayout';
import {
  BREAKABLE_BLOCKS,
  isInsideGarageRestartArea,
  resolveVehicleDistrict,
} from './worldLayout';

interface VoxelGameSceneProps {
  readonly breakablePoolHandleRef: BreakablePoolHandleRef;
  readonly breakableTelemetryRef: BreakableTelemetryRef;
  readonly bulldozerMissionSnapshotRef: BulldozerMissionSnapshotRef;
  readonly bulldozerMissionTelemetryRef: BulldozerMissionTelemetryRef;
  readonly cameraTelemetryRef?: WorldCameraTelemetryRef;
  readonly commandRef: RefObject<DriveCommand>;
  readonly coordinator: VehicleMissionCoordinator;
  readonly controllerRef: RefObject<VehicleControllerHandle | null>;
  readonly manualClockRef: React.MutableRefObject<boolean>;
  readonly missionTelemetryRef: MissionTelemetryRef;
  readonly onVehicleSwitchAvailabilityChange: (available: boolean) => void;
  readonly renderTelemetryRef: VoxelGameRenderTelemetryRef;
  readonly telemetryRef: VehicleTelemetryRef;
  readonly vehicleId: VehicleId;
}

export interface VoxelGameRenderTelemetry {
  readonly renderedFrames: number;
  readonly rendererCalls: number;
}

export type VoxelGameRenderTelemetryRef = MutableRefObject<VoxelGameRenderTelemetry>;

/** 車両位置に依存する積み木復元と車庫帰還signalを同じphysics時点へ同期する。 */
export function syncRuntimeSpatialSignals(
  runtime: VoxelGameRuntime,
  vehiclePosition: readonly [number, number, number],
): void {
  syncBlockClearance(runtime, BREAKABLE_BLOCKS, vehiclePosition);
  runtime.setSignals({ atGarage: isInsideGarageRestartArea(vehiclePosition) });
}

/** 最新位置を共有積み木と選択中車種の車庫・仕事地区signalへ同期する。 */
export function syncVehicleMissionSpatialSignals(
  coordinator: VehicleMissionCoordinator,
  vehiclePosition: readonly [number, number, number],
): void {
  syncBlockClearance(coordinator.fireRuntime, BREAKABLE_BLOCKS, vehiclePosition);
  coordinator.setSpatialSignals({
    atBulldozerWorksite: resolveVehicleDistrict(vehiclePosition) === 'blocks',
    atGarage: isInsideGarageRestartArea(vehiclePosition),
  });
}

/** 最新draw call数を保持しながら実描画frame数を1増やす。 */
export function advanceRenderTelemetry(
  current: VoxelGameRenderTelemetry,
  rendererCalls: number,
): VoxelGameRenderTelemetry {
  return {
    renderedFrames: current.renderedFrames + 1,
    rendererCalls,
  };
}

/** 複数frameとdraw callを確認してから自動検証へscene readyを通知する。 */
function SceneReadySignal({ renderTelemetryRef }: {
  readonly renderTelemetryRef: VoxelGameRenderTelemetryRef;
}): null {
  const renderedFrameCount = useRef(0);

  useFrame(({ gl }) => {
    renderedFrameCount.current += 1;
    renderTelemetryRef.current = advanceRenderTelemetry(
      renderTelemetryRef.current,
      gl.info.render.calls,
    );
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
  readonly breakablePoolHandleRef: BreakablePoolHandleRef;
  readonly coordinator: VehicleMissionCoordinator;
  readonly manualClockRef: React.MutableRefObject<boolean>;
  readonly onVehicleSwitchAvailabilityChange: (available: boolean) => void;
  readonly telemetryRef: VehicleTelemetryRef;
}

/** 最新車両位置を復元判定へ同期してから通常clockを進める。 */
function RuntimeClock({
  breakablePoolHandleRef,
  coordinator,
  manualClockRef,
  onVehicleSwitchAvailabilityChange,
  telemetryRef,
}: RuntimeClockProps): null {
  const previousSwitchAvailabilityRef = useRef<boolean | null>(null);
  const syncLatestBlockClearance = useCallback(() => {
    syncVehicleMissionSpatialSignals(coordinator, telemetryRef.current.position);
  }, [coordinator, telemetryRef]);

  useFrame((_state, delta) => {
    const switchAvailable = canSwitchVehicle({
      atGarage: isInsideGarageRestartArea(telemetryRef.current.position),
      speed: telemetryRef.current.speed,
    });
    if (switchAvailable !== previousSwitchAvailabilityRef.current) {
      previousSwitchAvailabilityRef.current = switchAvailable;
      onVehicleSwitchAvailabilityChange(switchAvailable);
    }
    advanceVehicleMissionFrame(coordinator, manualClockRef, delta, syncLatestBlockClearance);
    breakablePoolHandleRef.current?.syncAfterRuntimeAdvance();
  });
  return null;
}

/** 箱庭の照明、世界方向固定camera、物理空間、運転可能な消防車を構成する。 */
export function VoxelGameScene({
  breakablePoolHandleRef,
  breakableTelemetryRef,
  bulldozerMissionSnapshotRef,
  bulldozerMissionTelemetryRef,
  cameraTelemetryRef,
  commandRef,
  coordinator,
  controllerRef,
  manualClockRef,
  missionTelemetryRef,
  renderTelemetryRef,
  onVehicleSwitchAvailabilityChange,
  telemetryRef,
  vehicleId,
}: VoxelGameSceneProps): ReactElement {
  return (
    <>
      <color attach="background" args={['#ead4b3']} />
      <WorldFixedCamera cameraTelemetryRef={cameraTelemetryRef} telemetryRef={telemetryRef} />
      <SceneReadySignal renderTelemetryRef={renderTelemetryRef} />
      <RuntimeClock
        breakablePoolHandleRef={breakablePoolHandleRef}
        coordinator={coordinator}
        manualClockRef={manualClockRef}
        onVehicleSwitchAvailabilityChange={onVehicleSwitchAvailabilityChange}
        telemetryRef={telemetryRef}
      />
      <ambientLight intensity={1.5} />
      <directionalLight intensity={2.1} position={[20, 34, 18]} />
      <directionalLight color="#cbe0ff" intensity={0.75} position={[-18, 20, -14]} />
      <Physics gravity={[0, -18, 0]}>
        <VoxelWorld />
        <BreakableBlockPlaza
          breakablePoolHandleRef={breakablePoolHandleRef}
          breakableTelemetryRef={breakableTelemetryRef}
          runtime={coordinator.fireRuntime}
          telemetryRef={telemetryRef}
        />
        <WaterAndFire
          commandRef={commandRef}
          enabled={vehicleId === 'fire-truck'}
          missionTelemetryRef={missionTelemetryRef}
          runtime={coordinator.fireRuntime}
          telemetryRef={telemetryRef}
        />
        <BulldozerDebrisMission
          commandRef={commandRef}
          coordinator={coordinator}
          enabled={vehicleId === 'bulldozer'}
          missionTelemetryRef={bulldozerMissionTelemetryRef}
          snapshotRef={bulldozerMissionSnapshotRef}
          vehicleId={vehicleId}
          vehicleTelemetryRef={telemetryRef}
        />
        <RigidBody colliders={false} type="fixed">
          <CuboidCollider
            args={scaleToHalfExtents(WORLD_GROUND_BOX.scale)}
            position={WORLD_GROUND_BOX.position}
          />
        </RigidBody>
        <VehicleController
          commandRef={commandRef}
          key={vehicleId}
          ref={controllerRef}
          telemetryRef={telemetryRef}
          vehicleId={vehicleId}
        />
      </Physics>
    </>
  );
}

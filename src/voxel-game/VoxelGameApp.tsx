import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Canvas } from '@react-three/fiber';
import { advanceManualClock, VoxelGameRuntime } from './domain/VoxelGameRuntime';
import { useVoxelGameControls } from './input/useVoxelGameControls';
import { VoxelGameScene } from './scene/VoxelGameScene';
import type {
  VehicleControllerHandle,
  VehicleTelemetry,
} from './scene/VehicleController';
import {
  CELEBRATION_STAR_GROUPS,
  FIRE_LAYER_BOXES,
  getFireLayerCount,
  type MissionTelemetry,
} from './scene/WaterAndFire';
import type { WorldCameraTelemetry } from './scene/WorldFixedCamera';
import {
  BREAKABLE_FRAGMENT_POOL,
  type BreakableTelemetry,
} from './scene/BreakableBlockPlaza';
import {
  BREAKABLE_BLOCKS,
  FIRE_POSITION,
  GARAGE_POSITION,
  WORLD_BOUNDS,
} from './scene/worldLayout';

/** 運転可能な箱庭Canvas、入力、段階的な自動検証hookを構成する。 */
export function VoxelGameApp(): ReactElement {
  const controls = useVoxelGameControls();
  const breakableTelemetryRef = useRef<BreakableTelemetry>({
    activeFragmentCount: 0,
    blocks: BREAKABLE_BLOCKS.map(({ id }) => ({
      collisionEnabledFragmentCount: 0,
      fragmentVisibleCount: 0,
      id,
      impactCount: 0,
      intactVisible: true,
      maxImpactSpeed: 0,
      maxEventRelativeSpeed: 0,
      maxVehiclePreviousStepSpeed: 0,
      slotIds: BREAKABLE_FRAGMENT_POOL.filter(({ blockId }) => blockId === id).map(({ id: slotId }) => slotId),
      vehicleImpactCount: 0,
    })),
    collisionEnabledFragmentCount: 0,
    poolSlotCount: BREAKABLE_FRAGMENT_POOL.length,
    poolSlotIds: BREAKABLE_FRAGMENT_POOL.map(({ id }) => id),
    sleepingFragmentCount: 0,
  });
  const controllerRef = useRef<VehicleControllerHandle>(null);
  const cameraTelemetryRef = useRef<WorldCameraTelemetry>({
    lookTarget: [GARAGE_POSITION[0], GARAGE_POSITION[1] + 0.8, GARAGE_POSITION[2] - 1.5],
    position: [GARAGE_POSITION[0] + 10, GARAGE_POSITION[1] + 12, GARAGE_POSITION[2] + 12],
    viewport: { height: 0, width: 0 },
    zoom: 56,
  });
  const runtimeRef = useRef(new VoxelGameRuntime(BREAKABLE_BLOCKS.map(({ id }) => id)));
  const manualClockRef = useRef(false);
  const missionTelemetryRef = useRef<MissionTelemetry>({
    direction: [0, 0, 1],
    distance: Number.POSITIVE_INFINITY,
    nozzleOrigin: [GARAGE_POSITION[0], GARAGE_POSITION[1] + 2.15, GARAGE_POSITION[2] + 1.7],
    sprayActive: false,
    sprayOnFire: false,
    targeted: false,
  });
  const [missionPhase, setMissionPhase] = useState(runtimeRef.current.getSnapshot().missionPhase);
  const telemetryRef = useRef<VehicleTelemetry>({
    forward: [0, 0, 1],
    mass: 0,
    position: [...GARAGE_POSITION],
    resetCount: 0,
    speed: 0,
  });

  useEffect(() => {
    const unsubscribe = runtimeRef.current.subscribe((snapshot) => {
      setMissionPhase((current) => current === snapshot.missionPhase ? current : snapshot.missionPhase);
    });
    window.render_game_to_text = () => {
      const runtime = runtimeRef.current.getSnapshot();
      return JSON.stringify({
        coordinateSystem: 'origin=center, +x=right, +y=up, +z=toward-garage',
        landmarks: {
          breakableBlocks: BREAKABLE_BLOCKS.map(({ id, position }) => ({ id, position })),
          fire: FIRE_POSITION,
          garage: GARAGE_POSITION,
        },
        mode: 'drive-ready',
        camera: cameraTelemetryRef.current,
        breakables: breakableTelemetryRef.current,
        mission: missionTelemetryRef.current,
        runtime,
        vehicle: telemetryRef.current,
        visualLayout: {
          fireLayers: FIRE_LAYER_BOXES,
          starGroups: CELEBRATION_STAR_GROUPS,
        },
        visuals: {
          fireLayerCount: getFireLayerCount(runtime.fireIntensity),
          routeCubeCount: runtime.routeVisible ? 12 : 0,
          starCubeCount: runtime.missionPhase === 'celebrating' ? 30 : 0,
          waterCubeCount: missionTelemetryRef.current.sprayActive ? 18 : 0,
          intactBlockCount: breakableTelemetryRef.current.blocks.filter(({ intactVisible }) => intactVisible).length,
          fragmentVisibleCount: breakableTelemetryRef.current.activeFragmentCount,
          fragmentCollisionEnabledCount: breakableTelemetryRef.current.collisionEnabledFragmentCount,
          fragmentPoolSlotCount: breakableTelemetryRef.current.poolSlotCount,
        },
        worldBounds: WORLD_BOUNDS,
      });
    };
    window.reset_voxel_game_vehicle = () => controllerRef.current?.resetVehicle();
    window.advanceTime = (milliseconds: number) => advanceManualClock(
      runtimeRef.current,
      manualClockRef,
      milliseconds,
    );

    return () => {
      unsubscribe();
      delete window.render_game_to_text;
      delete window.reset_voxel_game_vehicle;
      delete window.advanceTime;
    };
  }, []);

  return (
    <main className="voxel-game-shell">
      <section className="voxel-game-canvas" aria-label="純ボクセル消防車の箱庭">
        <Canvas dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: 'high-performance' }}>
          <VoxelGameScene
            breakableTelemetryRef={breakableTelemetryRef}
            cameraTelemetryRef={cameraTelemetryRef}
            commandRef={controls.commandRef}
            controllerRef={controllerRef}
            manualClockRef={manualClockRef}
            missionTelemetryRef={missionTelemetryRef}
            runtime={runtimeRef.current}
            telemetryRef={telemetryRef}
          />
        </Canvas>
        {missionPhase === 'celebrating' ? (
          <p aria-live="polite" className="voxel-game-success">できた！</p>
        ) : null}
      </section>
    </main>
  );
}

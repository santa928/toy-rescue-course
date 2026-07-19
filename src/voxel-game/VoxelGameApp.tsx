import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { Canvas } from '@react-three/fiber';
import { VoxelGameRuntime } from './domain/VoxelGameRuntime';
import { useVoxelGameControls } from './input/useVoxelGameControls';
import { VoxelGameScene } from './scene/VoxelGameScene';
import type {
  VehicleControllerHandle,
  VehicleTelemetry,
} from './scene/VehicleController';
import {
  BREAKABLE_BLOCKS,
  FIRE_POSITION,
  GARAGE_POSITION,
  WORLD_BOUNDS,
} from './scene/worldLayout';

/** 運転可能な箱庭Canvas、入力、段階的な自動検証hookを構成する。 */
export function VoxelGameApp(): ReactElement {
  const controls = useVoxelGameControls();
  const controllerRef = useRef<VehicleControllerHandle>(null);
  const runtimeRef = useRef(new VoxelGameRuntime(BREAKABLE_BLOCKS.map(({ id }) => id)));
  const telemetryRef = useRef<VehicleTelemetry>({
    forward: [0, 0, 1],
    mass: 0,
    position: [...GARAGE_POSITION],
    resetCount: 0,
    speed: 0,
  });

  useEffect(() => {
    window.render_game_to_text = () =>
      JSON.stringify({
        coordinateSystem: 'origin=center, +x=right, +y=up, +z=toward-garage',
        landmarks: {
          breakableBlocks: BREAKABLE_BLOCKS.map(({ id, position }) => ({ id, position })),
          fire: FIRE_POSITION,
          garage: GARAGE_POSITION,
        },
        mode: 'drive-ready',
        runtime: runtimeRef.current.getSnapshot(),
        vehicle: telemetryRef.current,
        worldBounds: WORLD_BOUNDS,
      });
    window.reset_voxel_game_vehicle = () => controllerRef.current?.resetVehicle();
    window.advanceTime = () => undefined;

    return () => {
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
            commandRef={controls.commandRef}
            controllerRef={controllerRef}
            telemetryRef={telemetryRef}
          />
        </Canvas>
      </section>
    </main>
  );
}

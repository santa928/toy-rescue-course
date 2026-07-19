import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { Canvas } from '@react-three/fiber';
import { VoxelGameScene } from './scene/VoxelGameScene';
import {
  BREAKABLE_BLOCKS,
  FIRE_POSITION,
  GARAGE_POSITION,
  WORLD_BOUNDS,
} from './scene/worldLayout';

/** static箱庭のCanvasと自動検証用の読み取り契約を構成する。 */
export function VoxelGameApp(): ReactElement {
  useEffect(() => {
    window.render_game_to_text = () =>
      JSON.stringify({
        coordinateSystem: 'origin=center, +x=right, +z=bottom, +y=up',
        landmarks: {
          breakableBlocks: BREAKABLE_BLOCKS.map(({ id, position }) => ({ id, position })),
          fire: FIRE_POSITION,
          garage: GARAGE_POSITION,
        },
        mode: 'static-world',
        worldBounds: WORLD_BOUNDS,
      });
    window.advanceTime = () => undefined;

    return () => {
      delete window.render_game_to_text;
      delete window.advanceTime;
    };
  }, []);

  return (
    <main className="voxel-game-shell">
      <section className="voxel-game-canvas" aria-label="純ボクセル消防車の箱庭">
        <Canvas dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: 'high-performance' }}>
          <VoxelGameScene />
        </Canvas>
      </section>
    </main>
  );
}

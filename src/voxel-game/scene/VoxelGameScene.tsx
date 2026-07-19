import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { OrthographicCamera } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import * as THREE from 'three';
import { VoxelFireTruck } from '../../vehicle-lab/scene/VoxelFireTruck';
import { VoxelWorld } from './VoxelWorld';
import { GARAGE_POSITION } from './worldLayout';

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

/** static箱庭の照明、俯瞰カメラ、物理空間、消防車を構成する。 */
export function VoxelGameScene(): ReactElement {
  const cameraRef = useRef<THREE.OrthographicCamera>(null);

  useLayoutEffect(() => {
    const camera = cameraRef.current;
    if (!camera) {
      return;
    }
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, []);

  return (
    <>
      <color attach="background" args={['#ead4b3']} />
      <OrthographicCamera makeDefault position={[30, 36, 38]} ref={cameraRef} zoom={15.5} />
      <SceneReadySignal />
      <ambientLight intensity={1.5} />
      <directionalLight intensity={2.1} position={[20, 34, 18]} />
      <directionalLight color="#cbe0ff" intensity={0.75} position={[-18, 20, -14]} />
      <Physics gravity={[0, -18, 0]}>
        <VoxelWorld />
        <VoxelFireTruck position={GARAGE_POSITION} scale={1.2} />
      </Physics>
    </>
  );
}

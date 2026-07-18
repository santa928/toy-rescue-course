import { useEffect, useRef } from 'react';
import type { ComponentRef, ReactElement } from 'react';
import { OrbitControls, OrthographicCamera } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { VoxelFireTruck } from './VoxelFireTruck';

export type VehicleLabView = 'perspective' | 'front' | 'left' | 'back' | 'right';

interface VehicleShowroomProps {
  readonly autoRotate: boolean;
  readonly onFreeOrbit: () => void;
  readonly view: VehicleLabView;
}

const CAMERA_POSITIONS: Record<VehicleLabView, readonly [number, number, number]> = {
  perspective: [6.5, 4.8, 8],
  front: [0, 2.4, -10],
  left: [-10, 2.4, 0],
  back: [0, 2.4, 10],
  right: [10, 2.4, 0],
};

/** 固定方向ボタンとOrbitControlsを同じカメラへ同期する。 */
function CameraRig({ autoRotate, onFreeOrbit, view }: VehicleShowroomProps): ReactElement {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    if (view === 'perspective') {
      return;
    }
    const [x, y, z] = CAMERA_POSITIONS[view];
    camera.position.set(x, y, z);
    camera.lookAt(0, 0.85, 0);
    controlsRef.current?.target.set(0, 0.85, 0);
    controlsRef.current?.update();
  }, [camera, view]);

  return (
    <OrbitControls
      autoRotate={autoRotate}
      autoRotateSpeed={0.8}
      enablePan={false}
      maxZoom={110}
      minZoom={45}
      onStart={onFreeOrbit}
      ref={controlsRef}
      target={[0, 0.85, 0]}
    />
  );
}

/** rendererの実測draw callをテスト用telemetryへ記録する。 */
function RendererMetrics(): null {
  useFrame(({ camera, gl }) => {
    const telemetry = window.__vehicleLabTelemetry;
    if (!telemetry) {
      return;
    }
    window.__vehicleLabTelemetry = {
      ...telemetry,
      cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
      cameraZoom: 'zoom' in camera ? camera.zoom : 1,
      renderedFrames: telemetry.renderedFrames + 1,
      rendererCalls: gl.info.render.calls,
    };
  });
  return null;
}

/** 純ボクセル消防車、展示台、照明、カメラ操作を構成する。 */
export function VehicleShowroom({ autoRotate, onFreeOrbit, view }: VehicleShowroomProps): ReactElement {
  return (
    <>
      <color attach="background" args={['#eee9e2']} />
      <OrthographicCamera makeDefault position={[6.5, 4.8, 8]} zoom={72} />
      <CameraRig autoRotate={autoRotate} onFreeOrbit={onFreeOrbit} view={view} />
      <RendererMetrics />

      <ambientLight intensity={1.35} />
      <directionalLight castShadow intensity={2.1} position={[5, 8, 6]} shadow-mapSize={[1024, 1024]} />
      <directionalLight color="#b8d7ff" intensity={0.65} position={[-5, 3, -4]} />

      <group position={[0, 0.18, 0]}>
        <VoxelFireTruck />
      </group>

      <mesh receiveShadow position={[0, 0, 0]}>
        <boxGeometry args={[5.6, 0.34, 4.4]} />
        <meshStandardMaterial color="#b77b48" roughness={0.86} />
      </mesh>
      <mesh receiveShadow position={[0, -0.24, 0]}>
        <boxGeometry args={[200, 0.15, 200]} />
        <meshStandardMaterial color="#d8d1c8" roughness={0.95} />
      </mesh>
    </>
  );
}

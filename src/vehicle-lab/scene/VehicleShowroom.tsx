import { useEffect, useRef } from 'react';
import type { ComponentRef, ReactElement } from 'react';
import { OrbitControls, OrthographicCamera } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { VoxelFireTruck } from './VoxelFireTruck';

export type VehicleLabView = 'perspective' | 'front' | 'left' | 'back' | 'right';

export interface VehicleLabCameraPreset {
  readonly requestId: number;
  readonly view: VehicleLabView;
}

interface VehicleShowroomProps {
  readonly autoRotate: boolean;
  readonly cameraPreset: VehicleLabCameraPreset | null;
  readonly onFreeOrbit: () => void;
}

interface OrbitAngles {
  readonly azimuth: number;
  readonly polar: number;
}

const ORBIT_ANGLE_EPSILON = 0.001;

const CAMERA_POSITIONS: Record<VehicleLabView, readonly [number, number, number]> = {
  perspective: [6.5, 4.8, 8],
  front: [0, 2.4, -10],
  left: [-10, 2.4, 0],
  back: [0, 2.4, 10],
  right: [10, 2.4, 0],
};

/** 2つの方位角の最短差分を0からπの範囲で返す。 */
function calculateAzimuthDistance(first: number, second: number): number {
  return Math.abs(Math.atan2(Math.sin(first - second), Math.cos(first - second)));
}

/** 固定方向ボタンとOrbitControlsを同じカメラへ同期する。 */
function CameraRig({ autoRotate, cameraPreset, onFreeOrbit }: VehicleShowroomProps): ReactElement {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const interactionStartRef = useRef<OrbitAngles | null>(null);
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    if (!cameraPreset) {
      return;
    }
    const [x, y, z] = CAMERA_POSITIONS[cameraPreset.view];
    const controls = controlsRef.current;
    if (controls) {
      controls.autoRotate = false;
      controls.target.set(0, 0.85, 0);
    }
    camera.position.set(x, y, z);
    camera.lookAt(0, 0.85, 0);
    if ('zoom' in camera) {
      camera.zoom = 72;
      camera.updateProjectionMatrix();
    }
  }, [camera, cameraPreset]);

  /** 操作開始時のOrbitControls角度を、終了時の回転判定用に保持する。 */
  const trackInteractionStart = (): void => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }
    interactionStartRef.current = {
      azimuth: controls.getAzimuthalAngle(),
      polar: controls.getPolarAngle(),
    };
  };

  /** 操作終了時に実際の回転だけを自由視点としてアプリへ通知する。 */
  const detectCompletedOrbit = (): void => {
    const controls = controlsRef.current;
    const interactionStart = interactionStartRef.current;
    interactionStartRef.current = null;
    if (!controls || !interactionStart) {
      return;
    }

    const azimuthDistance = calculateAzimuthDistance(
      controls.getAzimuthalAngle(),
      interactionStart.azimuth,
    );
    const polarDistance = Math.abs(controls.getPolarAngle() - interactionStart.polar);
    if (azimuthDistance > ORBIT_ANGLE_EPSILON || polarDistance > ORBIT_ANGLE_EPSILON) {
      onFreeOrbit();
    }
  };

  return (
    <OrbitControls
      autoRotate={autoRotate}
      autoRotateSpeed={0.8}
      enableDamping={false}
      enablePan={false}
      maxZoom={110}
      minZoom={45}
      onEnd={detectCompletedOrbit}
      onStart={trackInteractionStart}
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

/** 静止展示物のshadow mapを初回だけ更新し、以後の重複shadow passを省く。 */
function StaticShadowMap(): null {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);

  return null;
}

/** 純ボクセル消防車、展示台、照明、カメラ操作を構成する。 */
export function VehicleShowroom({ autoRotate, cameraPreset, onFreeOrbit }: VehicleShowroomProps): ReactElement {
  return (
    <>
      <color attach="background" args={['#eee9e2']} />
      <OrthographicCamera makeDefault position={[6.5, 4.8, 8]} zoom={72} />
      <CameraRig autoRotate={autoRotate} cameraPreset={cameraPreset} onFreeOrbit={onFreeOrbit} />
      <RendererMetrics />
      <StaticShadowMap />

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

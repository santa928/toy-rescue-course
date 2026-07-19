import { useRef } from 'react';
import type { ReactElement } from 'react';
import { OrthographicCamera } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { VehicleTelemetryRef } from './VehicleController';
import { resolveWorldFixedCameraZoom } from './WorldFixedCameraLayout';

interface WorldFixedCameraProps {
  readonly telemetryRef: VehicleTelemetryRef;
}

const CAMERA_OFFSET = new THREE.Vector3(10, 12, 12);
const LOOK_OFFSET = new THREE.Vector3(0, 0.8, -1.5);
const smoothedPositionTarget = new THREE.Vector3();
const cameraTarget = new THREE.Vector3();
const lookTarget = new THREE.Vector3();

/** 車両位置だけを追い、車両yawでは回転しない世界方向固定cameraを構成する。 */
export function WorldFixedCamera({ telemetryRef }: WorldFixedCameraProps): ReactElement {
  const cameraRef = useRef<THREE.OrthographicCamera>(null);
  const followedPositionRef = useRef(new THREE.Vector3(...telemetryRef.current.position));

  useFrame(({ size }, delta) => {
    const camera = cameraRef.current;
    if (!camera) return;

    smoothedPositionTarget.fromArray(telemetryRef.current.position);
    const damping = 1 - Math.exp(-6 * Math.max(0, delta));
    followedPositionRef.current.lerp(smoothedPositionTarget, damping);
    cameraTarget.copy(followedPositionRef.current).add(CAMERA_OFFSET);
    lookTarget.copy(followedPositionRef.current).add(LOOK_OFFSET);
    camera.position.copy(cameraTarget);
    camera.lookAt(lookTarget);

    const nextZoom = resolveWorldFixedCameraZoom(size.width, size.height);
    if (Math.abs(camera.zoom - nextZoom) > 0.01) {
      camera.zoom = nextZoom;
      camera.updateProjectionMatrix();
    }
  });

  const [vehicleX, vehicleY, vehicleZ] = telemetryRef.current.position;
  return (
    <OrthographicCamera
      makeDefault
      position={[vehicleX + 10, vehicleY + 12, vehicleZ + 12]}
      ref={cameraRef}
      zoom={56}
    />
  );
}

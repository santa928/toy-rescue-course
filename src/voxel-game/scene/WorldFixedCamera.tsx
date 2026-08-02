import { useRef } from 'react';
import type { MutableRefObject, ReactElement } from 'react';
import { OrthographicCamera } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { VehicleTelemetryRef, VehicleVisualPositionRef } from './VehicleController';
import { resolveWorldFixedCameraZoom } from './WorldFixedCameraLayout';
import { resolveCameraFollowAxis } from './worldCameraFollow';
import {
  WORLD_CAMERA_ANCHOR_Y,
  WORLD_CAMERA_LOOK_OFFSET,
  WORLD_CAMERA_OFFSET,
} from './worldCameraConfig';
import { WORLD_FRAME_UPDATE_PRIORITIES } from './worldFrameUpdatePriorities';

interface WorldFixedCameraProps {
  readonly cameraTelemetryRef?: WorldCameraTelemetryRef;
  readonly telemetryRef: VehicleTelemetryRef;
  readonly visualPositionRef: VehicleVisualPositionRef;
}

export interface WorldCameraTelemetry {
  lookTarget: [number, number, number];
  position: [number, number, number];
  viewport: { height: number; width: number };
  zoom: number;
}

export type WorldCameraTelemetryRef = MutableRefObject<WorldCameraTelemetry>;

const CAMERA_OFFSET = new THREE.Vector3(...WORLD_CAMERA_OFFSET);
const LOOK_OFFSET = new THREE.Vector3(...WORLD_CAMERA_LOOK_OFFSET);
const smoothedPositionTarget = new THREE.Vector3();
const cameraTarget = new THREE.Vector3();
const lookTarget = new THREE.Vector3();

/** 車両位置だけを追い、車両yawでは回転しない世界方向固定cameraを構成する。 */
export function WorldFixedCamera({
  cameraTelemetryRef,
  telemetryRef,
  visualPositionRef,
}: WorldFixedCameraProps): ReactElement {
  const cameraRef = useRef<THREE.OrthographicCamera>(null);
  const followedPositionRef = useRef(new THREE.Vector3(
    telemetryRef.current.position[0],
    WORLD_CAMERA_ANCHOR_Y,
    telemetryRef.current.position[2],
  ));
  const observedResetCountRef = useRef(telemetryRef.current.resetCount);

  useFrame(({ size }, delta) => {
    const camera = cameraRef.current;
    if (!camera) return;

    const followedPosition = followedPositionRef.current;
    const visualPosition = visualPositionRef.current;
    if (observedResetCountRef.current !== telemetryRef.current.resetCount) {
      observedResetCountRef.current = telemetryRef.current.resetCount;
      followedPosition.set(visualPosition[0], WORLD_CAMERA_ANCHOR_Y, visualPosition[2]);
    }
    smoothedPositionTarget.set(
      resolveCameraFollowAxis(followedPosition.x, visualPosition[0]),
      followedPosition.y,
      resolveCameraFollowAxis(followedPosition.z, visualPosition[2]),
    );
    const damping = 1 - Math.exp(-6 * Math.max(0, delta));
    followedPosition.lerp(smoothedPositionTarget, damping);
    cameraTarget.copy(followedPosition).add(CAMERA_OFFSET);
    lookTarget.copy(followedPosition).add(LOOK_OFFSET);
    camera.position.copy(cameraTarget);
    camera.lookAt(lookTarget);

    const nextZoom = resolveWorldFixedCameraZoom(size.width, size.height);
    if (Math.abs(camera.zoom - nextZoom) > 0.01) {
      camera.zoom = nextZoom;
      camera.updateProjectionMatrix();
    }

    const cameraTelemetry = cameraTelemetryRef?.current;
    if (cameraTelemetry) {
      cameraTelemetry.position[0] = camera.position.x;
      cameraTelemetry.position[1] = camera.position.y;
      cameraTelemetry.position[2] = camera.position.z;
      cameraTelemetry.lookTarget[0] = lookTarget.x;
      cameraTelemetry.lookTarget[1] = lookTarget.y;
      cameraTelemetry.lookTarget[2] = lookTarget.z;
      cameraTelemetry.viewport.height = size.height;
      cameraTelemetry.viewport.width = size.width;
      cameraTelemetry.zoom = camera.zoom;
    }
  }, WORLD_FRAME_UPDATE_PRIORITIES.camera);

  const [vehicleX, , vehicleZ] = telemetryRef.current.position;
  return (
    <OrthographicCamera
      makeDefault
      position={[
        vehicleX + WORLD_CAMERA_OFFSET[0],
        WORLD_CAMERA_ANCHOR_Y + WORLD_CAMERA_OFFSET[1],
        vehicleZ + WORLD_CAMERA_OFFSET[2],
      ]}
      ref={cameraRef}
      zoom={56}
    />
  );
}

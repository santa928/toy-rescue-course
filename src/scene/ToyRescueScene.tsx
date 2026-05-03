import { useEffect, useMemo, useRef } from 'react';
import type { ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier';
import { ContactShadows, Environment, PerspectiveCamera, RoundedBox, useKeyboardControls } from '@react-three/drei';
import * as THREE from 'three';
import type { VehicleSpec } from '../game/data/vehicles';
import type { DriveInput } from '../game/input/actions';
import type { ColorEffect, PaintColor } from '../game/simulation/colorEffect';
import { VehicleModel } from './VehicleModel';

export interface GameTelemetry {
  readonly vehicleId: string;
  readonly position: readonly [number, number, number];
  readonly speed?: number;
  readonly activeBlocks: number;
  readonly colorEffect: ColorEffect | null;
  readonly terrain?: TerrainKind;
}

interface ToyRescueSceneProps {
  readonly colorEffect: ColorEffect | null;
  readonly driveInput: DriveInput;
  readonly onPaint: (color: PaintColor) => void;
  readonly onTelemetry: (telemetry: GameTelemetry) => void;
  readonly resetToken: number;
  readonly vehicle: VehicleSpec;
}

interface BlockData {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly color: string;
}

type TerrainKind = 'table' | 'sand' | 'water' | 'paintPool';

interface TerrainState {
  readonly accelerationMultiplier: number;
  readonly heightOffset: number;
  readonly kind: TerrainKind;
  readonly maxSpeedMultiplier: number;
  readonly turnMultiplier: number;
}

const mapSize = {
  width: 42,
  length: 54,
} as const;
const spawnPosition = [0, 0.7, 20] as const;

const blockColors = ['#ef4444', '#2563eb', '#facc15', '#22c55e', '#d8b08a'] as const;
const paintZones = [
  { color: 'red', kind: 'pool', position: [-7.8, 0, 12.5], radius: 1.35 },
  { color: 'blue', kind: 'pool', position: [7.6, 0, 7.8], radius: 1.35 },
  { color: 'yellow', kind: 'shower', position: [-9.4, 0, -8.5], radius: 1.15 },
] as const satisfies ReadonlyArray<{
  color: PaintColor;
  kind: 'pool' | 'shower';
  position: readonly [number, number, number];
  radius: number;
}>;

const defaultTerrain: TerrainState = {
  accelerationMultiplier: 1,
  heightOffset: 0,
  kind: 'table',
  maxSpeedMultiplier: 1,
  turnMultiplier: 1,
} as const;

const sandZone = {
  center: [0, -14.5],
  halfSize: [7.2, 4.75],
} as const;

const riverZone = {
  center: [11.8, -1.8],
  halfSize: [1.75, 12],
  rotation: -0.18,
} as const;

/**
 * 回転した長方形ゾーン内に現在位置があるか判定する。
 */
function isInsideRotatedRect(
  x: number,
  z: number,
  zone: { readonly center: readonly [number, number]; readonly halfSize: readonly [number, number]; readonly rotation?: number },
): boolean {
  const rotation = zone.rotation ?? 0;
  const dx = x - zone.center[0];
  const dz = z - zone.center[1];
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;

  return Math.abs(localX) <= zone.halfSize[0] && Math.abs(localZ) <= zone.halfSize[1];
}

/**
 * 車両位置から地形効果を決める。
 */
function getTerrainState(position: { readonly x: number; readonly z: number }): TerrainState {
  for (const zone of paintZones) {
    if (zone.kind !== 'pool') {
      continue;
    }
    const dx = position.x - zone.position[0];
    const dz = position.z - zone.position[2];
    if (Math.hypot(dx, dz) <= zone.radius) {
      return {
        accelerationMultiplier: 0.62,
        heightOffset: -0.16,
        kind: 'paintPool',
        maxSpeedMultiplier: 0.68,
        turnMultiplier: 0.78,
      };
    }
  }

  if (isInsideRotatedRect(position.x, position.z, riverZone)) {
    return {
      accelerationMultiplier: 0.68,
      heightOffset: -0.18,
      kind: 'water',
      maxSpeedMultiplier: 0.74,
      turnMultiplier: 0.82,
    };
  }

  if (isInsideRotatedRect(position.x, position.z, sandZone)) {
    return {
      accelerationMultiplier: 0.46,
      heightOffset: -0.06,
      kind: 'sand',
      maxSpeedMultiplier: 0.56,
      turnMultiplier: 0.72,
    };
  }

  return defaultTerrain;
}

/**
 * 机らしい木目を軽量なCanvasTextureとして生成する。
 */
function createWoodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');

  if (!context) {
    return new THREE.CanvasTexture(canvas);
  }

  const gradient = context.createLinearGradient(0, 0, 512, 0);
  gradient.addColorStop(0, '#c99765');
  gradient.addColorStop(0.5, '#e0b982');
  gradient.addColorStop(1, '#b98552');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);

  for (let y = 0; y < 512; y += 18) {
    context.strokeStyle = y % 36 === 0 ? 'rgba(86, 48, 20, 0.16)' : 'rgba(255, 246, 220, 0.18)';
    context.lineWidth = y % 36 === 0 ? 2 : 1;
    context.beginPath();
    for (let x = 0; x <= 512; x += 16) {
      const wave = Math.sin((x + y) * 0.025) * 5 + Math.sin(x * 0.07) * 2;
      if (x === 0) {
        context.moveTo(x, y + wave);
      } else {
        context.lineTo(x, y + wave);
      }
    }
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(7.5, 9.4);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 砂場用のざらついた粒状テクスチャを生成する。
 */
function createSandTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');

  if (!context) {
    return new THREE.CanvasTexture(canvas);
  }

  context.fillStyle = '#c99a62';
  context.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2400; i += 1) {
    const lightness = 145 + Math.floor(Math.random() * 70);
    context.fillStyle = `rgba(${lightness + 40}, ${lightness + 12}, ${lightness - 38}, ${0.16 + Math.random() * 0.28})`;
    context.beginPath();
    context.arc(Math.random() * 512, Math.random() * 512, 0.8 + Math.random() * 2.2, 0, Math.PI * 2);
    context.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 3.8);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 道路をマスキングテープ風に見せるための淡い縞テクスチャを生成する。
 */
function createRoadTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');

  if (!context) {
    return new THREE.CanvasTexture(canvas);
  }

  context.fillStyle = '#d6d1bd';
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = 'rgba(255, 255, 255, 0.42)';
  context.lineWidth = 3;
  for (let x = -260; x < 280; x += 42) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + 256, 256);
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.2, 9);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 積み木の壁と塔を決定的な配置で生成する。
 */
function createBlocks(): readonly BlockData[] {
  const blocks: BlockData[] = [];
  let id = 0;

  for (let side = -1; side <= 1; side += 2) {
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 14; col += 1) {
        blocks.push({
          id: `wall-${id}`,
          position: [side * 5.2, 0.35 + row * 0.72, -11.5 + col * 0.92],
          color: blockColors[(row + col + id) % blockColors.length],
        });
        id += 1;
      }
    }
  }

  const towers = [
    [-12.5, 15.8],
    [12.2, 13.4],
    [10.4, -15.6],
  ] as const;
  for (const [x, z] of towers) {
    for (let row = 0; row < 5; row += 1) {
      blocks.push({
        id: `tower-${id}`,
        position: [x, 0.35 + row * 0.72, z],
        color: blockColors[(row + id) % blockColors.length],
      });
      id += 1;
    }
  }

  return blocks;
}

/**
 * 車両の剛体を入力に応じて動かし、位置情報を親へ通知する。
 */
function PlayerVehicle({
  colorEffect,
  driveInput,
  onPaint,
  onTelemetry,
  resetToken,
  vehicle,
}: ToyRescueSceneProps): ReactElement {
  const bodyRef = useRef<RapierRigidBody>(null);
  const visualRef = useRef<THREE.Group>(null);
  const lastTelemetryAt = useRef(0);
  const lastPaintAt = useRef(0);
  const speedRef = useRef(0);
  const yawRef = useRef(0);
  const terrainRef = useRef<TerrainKind>('table');
  const [, getKeyboardControls] = useKeyboardControls<string>();

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }

    body.setTranslation({ x: spawnPosition[0], y: spawnPosition[1], z: spawnPosition[2] }, true);
    body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    speedRef.current = 0;
    yawRef.current = 0;
    terrainRef.current = 'table';
    if (visualRef.current) {
      visualRef.current.position.y = 0;
    }
  }, [resetToken, vehicle.id]);

  useFrame(({ clock, camera, size }, delta) => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }

    const keyboardInput = getKeyboardControls();
    const combinedInput = {
      forward: driveInput.forward || Boolean(keyboardInput.forward),
      backward: driveInput.backward || Boolean(keyboardInput.backward),
      left: driveInput.left || Boolean(keyboardInput.left),
      right: driveInput.right || Boolean(keyboardInput.right),
    };
    const throttle = Number(combinedInput.forward) - Number(combinedInput.backward);
    const steering = Number(combinedInput.right) - Number(combinedInput.left);
    const positionBeforeMove = body.translation();
    const terrain = getTerrainState(positionBeforeMove);
    terrainRef.current = terrain.kind;
    const velocity = body.linvel();
    const targetSpeed = throttle * vehicle.maxSpeed * terrain.maxSpeedMultiplier;
    const rate = throttle === 0 ? vehicle.braking : vehicle.acceleration * terrain.accelerationMultiplier;
    const nextSpeed = THREE.MathUtils.damp(speedRef.current, targetSpeed, rate, delta);
    speedRef.current = Math.abs(nextSpeed) < 0.02 ? 0 : nextSpeed;

    if (steering !== 0) {
      const speedRatio = Math.max(0.38, Math.min(1, Math.abs(speedRef.current) / vehicle.maxSpeed));
      const reverse = speedRef.current < -0.05 ? -1 : 1;
      yawRef.current -= steering * vehicle.turnPower * terrain.turnMultiplier * speedRatio * reverse * delta;
    }
    const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawRef.current);
    const forwardVector = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).setY(0).normalize();
    const desiredVelocity = forwardVector.multiplyScalar(speedRef.current);
    body.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }, true);
    body.setLinvel({ x: desiredVelocity.x, y: velocity.y, z: desiredVelocity.z }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    if (visualRef.current) {
      visualRef.current.position.y = THREE.MathUtils.damp(visualRef.current.position.y, terrain.heightOffset, 8, delta);
    }

    const position = body.translation();
    for (const zone of paintZones) {
      const dx = position.x - zone.position[0];
      const dz = position.z - zone.position[2];
      const distance = Math.hypot(dx, dz);
      if (distance <= zone.radius && clock.elapsedTime - lastPaintAt.current > 0.8) {
        lastPaintAt.current = clock.elapsedTime;
        onPaint(zone.color);
      }
    }

    const aspect = size.width / Math.max(1, size.height);
    const isPhonePortrait = aspect < 0.58;
    const isPortrait = aspect < 0.9;
    const cameraOffset = new THREE.Vector3(
      0,
      isPhonePortrait ? 5.8 : isPortrait ? 6.4 : 5.8,
      isPhonePortrait ? 10.4 : isPortrait ? 11.8 : 10.2,
    );
    const lookOffset = new THREE.Vector3(0, 0.35, isPhonePortrait ? -3.1 : -3.6);
    const cameraTarget = new THREE.Vector3(position.x, position.y, position.z).add(cameraOffset);
    camera.position.lerp(cameraTarget, 0.16);
    const lookTarget = new THREE.Vector3(position.x, position.y, position.z).add(lookOffset);
    camera.lookAt(lookTarget);

    if (position.y < -3) {
      body.setTranslation({ x: spawnPosition[0], y: spawnPosition[1], z: spawnPosition[2] }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      speedRef.current = 0;
      yawRef.current = 0;
    }

    if (clock.elapsedTime - lastTelemetryAt.current > 0.15) {
      lastTelemetryAt.current = clock.elapsedTime;
      const telemetry = {
        activeBlocks: createBlocks().length,
        colorEffect,
        position: [
          Number(position.x.toFixed(2)),
          Number(position.y.toFixed(2)),
          Number(position.z.toFixed(2)),
        ] as const,
        speed: Number(speedRef.current.toFixed(2)),
        terrain: terrainRef.current,
        vehicleId: vehicle.id,
      } satisfies GameTelemetry;
      window.__toyRescueTelemetry = telemetry;
      onTelemetry(telemetry);
    }
  });

  return (
    <RigidBody
      angularDamping={2.4}
      colliders="cuboid"
      key={`${vehicle.id}-${resetToken}`}
      linearDamping={0.45}
      mass={vehicle.mass}
      position={spawnPosition}
      ref={bodyRef}
    >
      <group ref={visualRef}>
        <VehicleModel colorEffect={colorEffect} vehicle={vehicle} />
      </group>
    </RigidBody>
  );
}

/**
 * 低い水面に波紋と薄い飛沫を重ね、粒々に見えない液体表現にする。
 */
function LiquidSurface({
  color,
  position,
  radius,
}: {
  readonly color: string;
  readonly position: readonly [number, number, number];
  readonly radius: number;
}): ReactElement {
  const rippleRef = useRef<THREE.Group>(null);
  const splashRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const telemetry = window.__toyRescueTelemetry;
    const dx = (telemetry?.position[0] ?? 999) - position[0];
    const dz = (telemetry?.position[2] ?? 999) - position[2];
    const active = Math.hypot(dx, dz) <= radius + 0.35 && Math.abs(telemetry?.speed ?? 0) > 0.25;
    const pulse = 1 + Math.sin(clock.elapsedTime * 5.4) * 0.035;

    if (rippleRef.current) {
      rippleRef.current.scale.setScalar(active ? pulse : 1);
      for (const child of rippleRef.current.children) {
        const mesh = child as THREE.Mesh;
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.opacity = active ? 0.38 : 0.22;
      }
    }

    if (splashRef.current) {
      splashRef.current.visible = active;
      splashRef.current.rotation.y = clock.elapsedTime * 1.6;
      splashRef.current.position.y = 0.25 + Math.sin(clock.elapsedTime * 12) * 0.05;
    }
  });

  return (
    <group position={[0, -0.005, 0]}>
      <mesh receiveShadow position={[0, 0, 0]}>
        <cylinderGeometry args={[radius * 0.96, radius * 0.96, 0.06, 56]} />
        <meshStandardMaterial color={color} transparent opacity={0.48} roughness={0.12} metalness={0.02} />
      </mesh>
      <group ref={rippleRef} rotation={[Math.PI / 2, 0, 0]}>
        {[0.42, 0.68, 0.92].map((scale, index) => (
          <mesh key={scale} position={[0, 0, 0.04 + index * 0.006]}>
            <torusGeometry args={[radius * scale, 0.018, 8, 72]} />
            <meshStandardMaterial color="#f7fdff" transparent opacity={0.24} roughness={0.08} />
          </mesh>
        ))}
      </group>
      <group ref={splashRef} visible={false}>
        {Array.from({ length: 10 }, (_, index) => {
          const angle = (index / 10) * Math.PI * 2;
          return (
            <mesh key={index} position={[Math.cos(angle) * radius * 0.72, 0.28 + (index % 3) * 0.04, Math.sin(angle) * radius * 0.72]} rotation={[0.35, angle, 0]}>
              <boxGeometry args={[0.035, 0.36, 0.015]} />
              <meshStandardMaterial color="#e7fbff" transparent opacity={0.62} roughness={0.18} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

/**
 * 川を走っているときだけ、車体付近に流れる波紋と飛沫を出す。
 */
function RiverWake(): ReactElement {
  const wakeRef = useRef<THREE.Group>(null);
  const sprayRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const telemetry = window.__toyRescueTelemetry;
    const speed = Math.abs(telemetry?.speed ?? 0);
    const x = telemetry?.position[0] ?? 999;
    const z = telemetry?.position[2] ?? 999;
    const active = telemetry?.terrain === 'water' && speed > 0.18 && isInsideRotatedRect(x, z, riverZone);

    if (!wakeRef.current || !sprayRef.current) {
      return;
    }

    wakeRef.current.visible = active;
    sprayRef.current.visible = active;

    if (!active) {
      return;
    }

    const dx = x - riverZone.center[0];
    const dz = z - riverZone.center[1];
    const cos = Math.cos(-riverZone.rotation);
    const sin = Math.sin(-riverZone.rotation);
    const localX = THREE.MathUtils.clamp(dx * cos - dz * sin, -1.2, 1.2);
    const localZ = THREE.MathUtils.clamp(dx * sin + dz * cos, -10.8, 10.8);
    const pulse = 1 + Math.sin(clock.elapsedTime * 9) * 0.08;

    wakeRef.current.position.set(localX, 0.08, localZ + 0.45);
    wakeRef.current.scale.setScalar(pulse);
    sprayRef.current.position.set(localX, 0.16 + Math.sin(clock.elapsedTime * 14) * 0.04, localZ + 0.28);
    sprayRef.current.rotation.y = Math.sin(clock.elapsedTime * 5.5) * 0.18;
  });

  return (
    <>
      <group ref={wakeRef} visible={false} rotation={[Math.PI / 2, 0, 0]}>
        {[0.36, 0.62, 0.88].map((radius, index) => (
          <mesh key={radius} position={[0, 0, 0.03 + index * 0.008]}>
            <ringGeometry args={[radius, radius + 0.03, 48]} />
            <meshStandardMaterial color="#f7fdff" transparent opacity={0.62 - index * 0.1} roughness={0.08} side={THREE.DoubleSide} />
          </mesh>
        ))}
        {[-0.32, 0, 0.32].map((x, index) => (
          <mesh key={x} position={[x, -0.36 - index * 0.16, 0.075 + index * 0.004]} rotation={[0, 0, x * 0.35]}>
            <planeGeometry args={[0.12, 0.82 - index * 0.12]} />
            <meshStandardMaterial color="#f0fbff" transparent opacity={0.4 - index * 0.06} roughness={0.08} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
      <group ref={sprayRef} visible={false}>
        {[-1, 1].flatMap((side) =>
          [0, 1, 2, 3, 4].map((index) => (
            <mesh
              key={`${side}-${index}`}
              position={[
                side * (0.36 + index * 0.11),
                0.18 + index * 0.035,
                -0.1 - index * 0.07,
              ]}
              rotation={[0.35 + index * 0.05, 0, side * (0.45 + index * 0.08)]}
            >
              <boxGeometry args={[0.05, 0.42 - index * 0.03, 0.014]} />
              <meshStandardMaterial color="#e9fbff" transparent opacity={0.86 - index * 0.08} roughness={0.12} />
            </mesh>
          )),
        )}
      </group>
    </>
  );
}

/**
 * 色シャワーを粒ではなく半透明の光の幕として表現する。
 */
function ShowerCurtain({ color }: { readonly color: string }): ReactElement {
  const curtainRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!curtainRef.current) {
      return;
    }
    curtainRef.current.position.y = Math.sin(clock.elapsedTime * 2.8) * 0.05;
    curtainRef.current.rotation.y = Math.sin(clock.elapsedTime * 1.2) * 0.08;
  });

  return (
    <group ref={curtainRef}>
      {[-0.56, -0.28, 0, 0.28, 0.56].map((x, index) => (
        <mesh key={x} position={[x, 2.55, 0]} rotation={[0, index % 2 === 0 ? 0.04 : -0.04, 0]}>
          <boxGeometry args={[0.08, 3.6, 0.025]} />
          <meshStandardMaterial color={color} transparent opacity={0.28} emissive={color} emissiveIntensity={0.18} roughness={0.22} />
        </mesh>
      ))}
      <mesh position={[0, 2.48, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.42, 0.75, 56]} />
        <meshStandardMaterial color={color} transparent opacity={0.2} emissive={color} emissiveIntensity={0.12} roughness={0.18} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/**
 * 色プールまたは色シャワーのセンサー領域。
 */
function PaintZone({
  color,
  kind,
  position,
}: {
  readonly color: PaintColor;
  readonly kind: 'pool' | 'shower';
  readonly position: readonly [number, number, number];
}): ReactElement {
  const paintColor = color === 'red' ? '#ef4444' : color === 'blue' ? '#2563eb' : '#facc15';
  const isPool = kind === 'pool';

  return (
    <group position={position}>
      {isPool && (
        <>
          <mesh receiveShadow position={[0, -0.09, 0]}>
            <cylinderGeometry args={[1.52, 1.62, 0.06, 56]} />
            <meshStandardMaterial color="#f6efe3" roughness={0.44} metalness={0.03} />
          </mesh>
          <mesh castShadow receiveShadow position={[0, 0.035, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.42, 0.11, 10, 72]} />
            <meshStandardMaterial color="#f6efe3" roughness={0.42} metalness={0.03} />
          </mesh>
          <LiquidSurface color={paintColor} position={position} radius={1.25} />
        </>
      )}
      {!isPool && (
        <group>
          <ShowerCurtain color={paintColor} />
          <RoundedBox args={[2.8, 0.2, 0.18]} radius={0.05} smoothness={5} position={[0, 4.78, 0]}>
            <meshStandardMaterial color="#d8d6bd" roughness={0.58} />
          </RoundedBox>
          <RoundedBox args={[0.18, 4.7, 0.18]} radius={0.05} smoothness={5} position={[-1.28, 2.38, 0]}>
            <meshStandardMaterial color="#d8d6bd" roughness={0.58} />
          </RoundedBox>
          <RoundedBox args={[0.18, 4.7, 0.18]} radius={0.05} smoothness={5} position={[1.28, 2.38, 0]}>
            <meshStandardMaterial color="#d8d6bd" roughness={0.58} />
          </RoundedBox>
        </group>
      )}
    </group>
  );
}

/**
 * テープを貼ったような道路を薄い角丸パーツで置く。
 */
function TapeRoad({
  length,
  position,
  roadTexture,
  rotation = 0,
  width = 3.2,
}: {
  readonly length: number;
  readonly position: readonly [number, number, number];
  readonly roadTexture: THREE.Texture;
  readonly rotation?: number;
  readonly width?: number;
}): ReactElement {
  return (
    <RoundedBox receiveShadow args={[width, 0.045, length]} radius={0.08} smoothness={5} position={position} rotation={[0, rotation, 0]}>
      <meshStandardMaterial map={roadTexture} color="#ebe2ca" roughness={0.66} />
    </RoundedBox>
  );
}

/**
 * 砂場を木枠と粒状テクスチャで作る。
 */
function SandPit({ sandTexture }: { readonly sandTexture: THREE.Texture }): ReactElement {
  return (
    <group position={[0, 0.04, -14.5]}>
      <mesh receiveShadow position={[0, 0.005, 0]}>
        <boxGeometry args={[14.4, 0.04, 9.5]} />
        <meshStandardMaterial map={sandTexture} roughness={0.92} />
      </mesh>
      {[
        [-5.4, 0.18, -4.9, 4.0, 0.32, 0.32],
        [5.4, 0.18, -4.9, 4.0, 0.32, 0.32],
        [-5.4, 0.18, 4.9, 4.0, 0.32, 0.32],
        [5.4, 0.18, 4.9, 4.0, 0.32, 0.32],
        [-7.5, 0.18, 0, 0.32, 0.32, 9.8],
        [7.5, 0.18, 0, 0.32, 0.32, 9.8],
      ].map(([x, y, z, width, height, length], index) => (
        <RoundedBox castShadow receiveShadow args={[width, height, length]} key={index} radius={0.08} smoothness={5} position={[x, y, z]}>
          <meshStandardMaterial color="#b98958" roughness={0.74} />
        </RoundedBox>
      ))}
      {Array.from({ length: 42 }, (_, index) => (
        <mesh castShadow key={index} position={[-6.4 + (index % 11) * 1.18, 0.13, -3.6 + Math.floor(index / 11) * 1.8]}>
          <sphereGeometry args={[0.05 + (index % 4) * 0.015, 8, 6]} />
          <meshStandardMaterial color={index % 2 === 0 ? '#e3bf82' : '#a36f3f'} roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * 半透明の青い川と木の岸を配置する。
 */
function River(): ReactElement {
  return (
    <group position={[11.8, 0.055, -1.8]} rotation={[0, -0.18, 0]}>
      <RoundedBox receiveShadow args={[3.5, 0.045, 24]} radius={0.2} smoothness={8} position={[0, 0, 0]}>
        <meshStandardMaterial color="#3aa7d8" transparent opacity={0.48} roughness={0.08} metalness={0.02} />
      </RoundedBox>
      {[-2.0, 2.0].map((x) => (
        <RoundedBox castShadow receiveShadow args={[0.32, 0.18, 24.3]} key={x} radius={0.08} smoothness={5} position={[x, 0.08, 0]}>
          <meshStandardMaterial color="#c49360" roughness={0.78} />
        </RoundedBox>
      ))}
      {Array.from({ length: 14 }, (_, index) => (
        <mesh key={index} position={[Math.sin(index * 1.3) * 1.1, 0.08, -10.5 + index * 1.58]} rotation={[-Math.PI / 2, 0, index * 0.4]}>
          <planeGeometry args={[0.62, 0.08]} />
          <meshStandardMaterial color="#e6fbff" transparent opacity={0.42} roughness={0.1} />
        </mesh>
      ))}
      <RiverWake />
    </group>
  );
}

/**
 * 踏切と線路をおもちゃの木製パーツとして置く。
 */
function RailCrossing(): ReactElement {
  return (
    <group position={[-13.5, 0.12, 1.2]} rotation={[0, 0.22, 0]}>
      {[-0.34, 0.34].map((x) => (
        <mesh castShadow receiveShadow key={x} position={[x, 0.04, 0]}>
          <boxGeometry args={[0.08, 0.08, 14]} />
          <meshStandardMaterial color="#2f3138" roughness={0.44} />
        </mesh>
      ))}
      {Array.from({ length: 18 }, (_, index) => (
        <mesh castShadow receiveShadow key={index} position={[0, 0.03, -6.5 + index * 0.78]}>
          <boxGeometry args={[1.1, 0.07, 0.12]} />
          <meshStandardMaterial color="#7b5638" roughness={0.72} />
        </mesh>
      ))}
      <RoundedBox castShadow args={[0.22, 1.55, 0.22]} radius={0.04} smoothness={5} position={[1.15, 0.78, -1.25]}>
        <meshStandardMaterial color="#f8fafc" roughness={0.44} />
      </RoundedBox>
      <group position={[1.85, 1.45, -1.25]} rotation={[0, 0, -0.5]}>
        <RoundedBox castShadow args={[2.2, 0.14, 0.12]} radius={0.03} smoothness={4}>
          <meshStandardMaterial color="#f8fafc" roughness={0.42} />
        </RoundedBox>
        {[-0.64, 0, 0.64].map((x) => (
          <RoundedBox castShadow args={[0.28, 0.16, 0.13]} key={x} radius={0.03} smoothness={4} position={[x, 0, 0.01]}>
            <meshStandardMaterial color="#ef4444" roughness={0.38} />
          </RoundedBox>
        ))}
      </group>
    </group>
  );
}

/**
 * 本とスロープで段差の遊び場を作る。
 */
function StepAndRamp(): ReactElement {
  return (
    <group position={[7.2, 0.15, -20.4]} rotation={[0, -0.42, 0]}>
      {['#f8fafc', '#e8dcc8', '#f8fafc', '#dbeafe'].map((color, index) => (
        <RoundedBox
          castShadow
          receiveShadow
          args={[4.7, 0.28, 1.28]}
          radius={0.08}
          smoothness={6}
          key={color + index}
          position={[0, 0.14 + index * 0.26, 2.0 - index * 1.12]}
        >
          <meshStandardMaterial color={color} roughness={0.62} />
        </RoundedBox>
      ))}
      <mesh castShadow receiveShadow position={[0, 0.34, 3.02]} rotation={[0.22, 0, 0]}>
        <boxGeometry args={[4.5, 0.18, 2.15]} />
        <meshStandardMaterial color="#c99a62" roughness={0.7} />
      </mesh>
    </group>
  );
}

/**
 * 見た目の地形に対応する固定コライダーをまとめる。
 */
function TerrainColliders(): ReactElement {
  return (
    <>
      <RigidBody type="fixed" friction={1.15} restitution={0.02}>
        <CuboidCollider args={[2.0, 0.16, 0.16]} position={[-5.4, 0.22, -19.4]} />
        <CuboidCollider args={[2.0, 0.16, 0.16]} position={[5.4, 0.22, -19.4]} />
        <CuboidCollider args={[2.0, 0.16, 0.16]} position={[-5.4, 0.22, -9.6]} />
        <CuboidCollider args={[2.0, 0.16, 0.16]} position={[5.4, 0.22, -9.6]} />
        <CuboidCollider args={[0.16, 0.16, 4.9]} position={[-7.5, 0.22, -14.5]} />
        <CuboidCollider args={[0.16, 0.16, 4.9]} position={[7.5, 0.22, -14.5]} />
      </RigidBody>

      <RigidBody type="fixed" friction={0.9} position={[11.8, 0.055, -1.8]} rotation={[0, -0.18, 0]}>
        <CuboidCollider args={[0.16, 0.09, 12.15]} position={[-2, 0.08, 0]} />
        <CuboidCollider args={[0.16, 0.09, 12.15]} position={[2, 0.08, 0]} />
      </RigidBody>

      <RigidBody type="fixed" friction={1.05} position={[7.2, 0.15, -20.4]} rotation={[0, -0.42, 0]}>
        {[0, 1, 2, 3].map((index) => (
          <CuboidCollider args={[2.35, 0.14, 0.64]} key={index} position={[0, 0.14 + index * 0.26, 2.0 - index * 1.12]} />
        ))}
        <CuboidCollider args={[2.25, 0.09, 1.08]} position={[0, 0.34, 3.02]} rotation={[0.22, 0, 0]} />
      </RigidBody>

      <RigidBody type="fixed" friction={0.92} position={[-13.5, 0.12, 1.2]} rotation={[0, 0.22, 0]}>
        <CuboidCollider args={[0.04, 0.035, 7]} position={[-0.34, 0.04, 0]} />
        <CuboidCollider args={[0.04, 0.035, 7]} position={[0.34, 0.04, 0]} />
        <CuboidCollider args={[0.11, 0.78, 0.11]} position={[1.15, 0.78, -1.25]} />
        <CuboidCollider args={[1.1, 0.07, 0.06]} position={[1.85, 1.45, -1.25]} rotation={[0, 0, -0.5]} />
      </RigidBody>

      <RigidBody type="fixed" friction={1.05} position={[-13.8, 0.18, 18.6]} rotation={[0, 0.36, 0]}>
        <CuboidCollider args={[1.9, 0.16, 0.43]} position={[0, 0.08, 0.03]} />
      </RigidBody>

      <RigidBody type="fixed" friction={1.05} position={[15.8, 0.08, 19.7]} rotation={[0, -0.22, 0]}>
        <CuboidCollider args={[2.2, 0.11, 3.1]} position={[0, 0.02, 0]} rotation={[-0.22, 0, 0]} />
      </RigidBody>

      <RigidBody type="fixed" friction={1.05} position={[-17.6, 0.24, -21.2]} rotation={[0, 0.28, 0]}>
        <CuboidCollider args={[2.2, 0.28, 1.1]} position={[0, 0.16, 0]} />
      </RigidBody>
    </>
  );
}

/**
 * 机上の本番寄りジオラマ感を出す背景小物。
 */
function SetDressing({
  roadTexture,
  sandTexture,
}: {
  readonly roadTexture: THREE.Texture;
  readonly sandTexture: THREE.Texture;
}): ReactElement {
  return (
    <group>
      <TapeRoad length={35} position={[0, 0.035, 4.5]} roadTexture={roadTexture} />
      <TapeRoad length={18} position={[-8.3, 0.04, 1.5]} roadTexture={roadTexture} rotation={Math.PI / 2} width={2.45} />
      <TapeRoad length={18} position={[7.8, 0.04, -4.8]} roadTexture={roadTexture} rotation={Math.PI / 2} width={2.45} />
      <SandPit sandTexture={sandTexture} />
      <River />
      <RailCrossing />
      <StepAndRamp />

      <group position={[-13.8, 0.18, 18.6]} rotation={[0, 0.36, 0]}>
        <RoundedBox args={[3.8, 0.18, 0.86]} radius={0.06} smoothness={5} position={[0, 0, 0]}>
          <meshStandardMaterial color="#f8fafc" roughness={0.52} />
        </RoundedBox>
        <RoundedBox args={[3.6, 0.12, 0.74]} radius={0.05} smoothness={5} position={[0.05, 0.17, 0.05]}>
          <meshStandardMaterial color="#ef4444" roughness={0.44} />
        </RoundedBox>
      </group>
      <group position={[15.8, 0.08, 19.7]} rotation={[0, -0.22, 0]}>
        <mesh rotation={[-0.22, 0, 0]}>
          <boxGeometry args={[4.4, 0.22, 6.2]} />
          <meshStandardMaterial color="#d6a778" roughness={0.5} />
        </mesh>
      </group>
      <group position={[-17.6, 0.24, -21.2]} rotation={[0, 0.28, 0]}>
        <RoundedBox args={[4.4, 0.48, 2.2]} radius={0.08} smoothness={5}>
          <meshStandardMaterial color="#e7d8bf" roughness={0.72} />
        </RoundedBox>
        <RoundedBox args={[4.1, 0.14, 1.88]} radius={0.06} smoothness={5} position={[0, 0.32, 0]}>
          <meshStandardMaterial color="#93c5fd" roughness={0.46} />
        </RoundedBox>
      </group>
    </group>
  );
}

/**
 * R3FとRapierで構成する3Dプレイフィールド。
 */
export function ToyRescueScene({
  colorEffect,
  driveInput,
  onPaint,
  onTelemetry,
  resetToken,
  vehicle,
}: ToyRescueSceneProps): ReactElement {
  const blocks = useMemo(() => createBlocks(), []);
  const woodTexture = useMemo(() => createWoodTexture(), []);
  const sandTexture = useMemo(() => createSandTexture(), []);
  const roadTexture = useMemo(() => createRoadTexture(), []);

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 7.4, 32.5]} fov={54} />
      <hemisphereLight args={['#f4f7ff', '#c99765', 1.15]} />
      <ambientLight intensity={0.52} />
      <directionalLight
        castShadow
        intensity={2.15}
        position={[8, 13, 10]}
        shadow-camera-bottom={-28}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={28}
        shadow-mapSize={[3072, 3072]}
      />
      <Environment preset="apartment" />

      <RigidBody type="fixed" friction={1}>
        <mesh receiveShadow position={[0, -0.04, 0]}>
          <boxGeometry args={[mapSize.width, 0.08, mapSize.length]} />
          <meshStandardMaterial map={woodTexture} roughness={0.62} />
        </mesh>
      </RigidBody>

      <RigidBody type="fixed">
        <CuboidCollider args={[mapSize.width / 2, 1.2, 0.25]} position={[0, 0.8, -mapSize.length / 2]} />
        <CuboidCollider args={[mapSize.width / 2, 1.2, 0.25]} position={[0, 0.8, mapSize.length / 2]} />
        <CuboidCollider args={[0.25, 1.2, mapSize.length / 2]} position={[-mapSize.width / 2, 0.8, 0]} />
        <CuboidCollider args={[0.25, 1.2, mapSize.length / 2]} position={[mapSize.width / 2, 0.8, 0]} />
      </RigidBody>

      {blocks.map((block) => (
        <RigidBody
          angularDamping={0.18}
          colliders="cuboid"
          friction={0.82}
          key={`${block.id}-${resetToken}`}
          linearDamping={0.08}
          mass={0.4}
          position={block.position}
          restitution={0.08}
        >
          <RoundedBox castShadow receiveShadow args={[0.72, 0.68, 0.72]} radius={0.065} smoothness={5}>
            <meshStandardMaterial color={block.color} roughness={0.55} />
          </RoundedBox>
        </RigidBody>
      ))}

      <SetDressing roadTexture={roadTexture} sandTexture={sandTexture} />
      <TerrainColliders />

      {paintZones.map((zone) => (
        <PaintZone color={zone.color} kind={zone.kind} key={zone.color} position={zone.position} />
      ))}

      <PlayerVehicle
        colorEffect={colorEffect}
        driveInput={driveInput}
        onPaint={onPaint}
        onTelemetry={onTelemetry}
        resetToken={resetToken}
        vehicle={vehicle}
      />

      <ContactShadows blur={3.4} far={14} opacity={0.28} position={[0, 0.01, 0]} scale={30} />
    </>
  );
}

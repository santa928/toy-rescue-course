import type { VehicleSpec } from '../game/data/vehicles';
import { resolvePaintedColor, type ColorEffect } from '../game/simulation/colorEffect';
import type { ReactElement } from 'react';
import { RoundedBox, Text } from '@react-three/drei';

interface VehicleModelProps {
  readonly colorEffect: ColorEffect | null;
  readonly vehicle: VehicleSpec;
}

/**
 * 横から見える窓と装備パネルを薄い角丸パーツで置く。
 */
function SidePanel({
  color,
  length,
  position,
  width,
}: {
  readonly color: string;
  readonly length: number;
  readonly position: readonly [number, number, number];
  readonly width: number;
}): ReactElement {
  return (
    <RoundedBox castShadow args={[0.035, width, length]} radius={0.015} smoothness={4} position={position}>
      <meshStandardMaterial color={color} roughness={0.24} metalness={0.04} transparent opacity={0.9} />
    </RoundedBox>
  );
}

/**
 * タイヤを黒いゴムと明るいホイールの二層で表現する。
 */
function Wheel({ position }: { readonly position: readonly [number, number, number] }): ReactElement {
  return (
    <group position={position} rotation={[Math.PI / 2, 0, 0]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.27, 0.27, 0.22, 32]} />
        <meshStandardMaterial color="#16181d" roughness={0.74} />
      </mesh>
      <mesh castShadow position={[0, 0, 0.118]}>
        <cylinderGeometry args={[0.16, 0.16, 0.025, 28]} />
        <meshStandardMaterial color="#f1eadb" roughness={0.38} metalness={0.12} />
      </mesh>
    </group>
  );
}

/**
 * 工事車両のおもちゃらしい黒いキャタピラを作る。
 */
function Track({
  length,
  position,
}: {
  readonly length: number;
  readonly position: readonly [number, number, number];
}): ReactElement {
  return (
    <group position={position}>
      <RoundedBox castShadow receiveShadow args={[0.34, 0.28, length]} radius={0.08} smoothness={6}>
        <meshStandardMaterial color="#20242b" roughness={0.78} />
      </RoundedBox>
      {Array.from({ length: 5 }, (_, index) => (
        <mesh castShadow key={index} position={[0, 0.15, -length * 0.36 + index * length * 0.18]}>
          <boxGeometry args={[0.36, 0.035, 0.08]} />
          <meshStandardMaterial color="#3b414b" roughness={0.68} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * 救急車や消防車に付く小さな発光パトライト。
 */
function Lightbar({
  color,
  height,
  length,
}: {
  readonly color: string;
  readonly height: number;
  readonly length: number;
}): ReactElement {
  return (
    <group position={[0, height * 1.42, -length * 0.2]}>
      <RoundedBox castShadow args={[0.72, 0.11, 0.22]} radius={0.04} smoothness={6}>
        <meshStandardMaterial color="#f8fafc" roughness={0.22} metalness={0.08} />
      </RoundedBox>
      <mesh castShadow position={[-0.2, 0.03, 0]}>
        <sphereGeometry args={[0.105, 16, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} roughness={0.18} />
      </mesh>
      <mesh castShadow position={[0.2, 0.03, 0]}>
        <sphereGeometry args={[0.105, 16, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.55} roughness={0.18} />
      </mesh>
    </group>
  );
}

/**
 * 働くくるまをプリミティブ形状で構成する軽量な3Dモデル。
 */
export function VehicleModel({ colorEffect, vehicle }: VehicleModelProps): ReactElement {
  const [width, height, length] = vehicle.size;
  const bodyColor = resolvePaintedColor(vehicle.baseColor, colorEffect);
  const wheelX = width * 0.42;
  const wheelZ = length * 0.33;
  const glassColor = vehicle.role === 'construction' ? '#243244' : '#172333';
  const trimColor = vehicle.id === 'firetruck' ? '#f1eadb' : '#d7dedc';
  const isConstruction = vehicle.id === 'bulldozer' || vehicle.id === 'excavator';

  return (
    <group>
      <RoundedBox castShadow receiveShadow args={[width, height, length]} radius={0.16} smoothness={10} position={[0, height * 0.52, 0]}>
        <meshStandardMaterial color={bodyColor} roughness={0.34} metalness={0.06} />
      </RoundedBox>

      <RoundedBox castShadow args={[width * 0.78, height * 0.58, length * 0.46]} radius={0.12} smoothness={9} position={[0, height * 1.0, -length * 0.18]}>
        <meshStandardMaterial color={vehicle.id === 'police' ? '#f8fafc' : vehicle.accentColor} roughness={0.32} />
      </RoundedBox>

      <SidePanel color={glassColor} length={length * 0.22} position={[width * 0.39, height * 1.04, -length * 0.25]} width={height * 0.3} />
      <SidePanel color={glassColor} length={length * 0.22} position={[-width * 0.39, height * 1.04, -length * 0.25]} width={height * 0.3} />
      <RoundedBox castShadow args={[width * 0.48, height * 0.28, 0.04]} radius={0.03} smoothness={5} position={[0, height * 0.96, -length * 0.42]}>
        <meshStandardMaterial color={glassColor} roughness={0.2} metalness={0.05} transparent opacity={0.88} />
      </RoundedBox>

      {(vehicle.id === 'ambulance' || vehicle.id === 'police' || vehicle.id === 'firetruck') && (
        <Lightbar color={vehicle.secondaryColor} height={height} length={length} />
      )}

      {vehicle.id === 'ambulance' && (
        <>
          <RoundedBox castShadow args={[width * 0.86, height * 0.58, 0.06]} radius={0.04} smoothness={5} position={[0, height * 0.68, length * 0.52]}>
            <meshStandardMaterial color="#f8fafc" roughness={0.32} />
          </RoundedBox>
          <RoundedBox castShadow args={[width * 0.54, 0.06, 0.07]} radius={0.02} smoothness={4} position={[0, height * 0.74, length * 0.56]}>
            <meshStandardMaterial color="#ef4444" roughness={0.35} />
          </RoundedBox>
          <RoundedBox castShadow args={[0.07, 0.28, 0.07]} radius={0.02} smoothness={4} position={[0, height * 0.74, length * 0.56]}>
            <meshStandardMaterial color="#ef4444" roughness={0.35} />
          </RoundedBox>
          <RoundedBox castShadow args={[width * 0.8, 0.085, 0.08]} radius={0.02} smoothness={4} position={[0, height * 0.94, -length * 0.52]}>
            <meshStandardMaterial color="#ef4444" roughness={0.35} />
          </RoundedBox>
          <RoundedBox castShadow args={[0.12, 0.34, 0.08]} radius={0.02} smoothness={4} position={[0, height * 0.64, -length * 0.52]}>
            <meshStandardMaterial color="#ef4444" roughness={0.35} />
          </RoundedBox>
          <SidePanel color="#ef4444" length={length * 0.36} position={[width * 0.5, height * 0.66, 0.18]} width={0.08} />
          <SidePanel color="#ef4444" length={length * 0.36} position={[-width * 0.5, height * 0.66, 0.18]} width={0.08} />
          {[width * 0.52, -width * 0.52].map((x) => (
            <group key={x} position={[x, height * 0.82, 0.18]}>
              <SidePanel color="#ef4444" length={0.42} position={[0, 0, 0]} width={0.075} />
              <SidePanel color="#ef4444" length={0.08} position={[0, 0, 0]} width={0.36} />
            </group>
          ))}
        </>
      )}

      {vehicle.id === 'police' && (
        <group>
          <RoundedBox castShadow args={[width * 1.03, height * 0.36, length * 0.42]} radius={0.06} smoothness={6} position={[0, height * 0.7, 0.12]}>
            <meshStandardMaterial color="#202632" roughness={0.48} />
          </RoundedBox>
          {[1, -1].map((side) => (
            <Text
              anchorX="center"
              anchorY="middle"
              fontSize={0.18}
              key={side}
              letterSpacing={0.06}
              position={[side * width * 0.535, height * 0.78, 0.14]}
              rotation={[0, side > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
            >
              POLICE
              <meshStandardMaterial color="#f8fafc" roughness={0.35} />
            </Text>
          ))}
          <mesh castShadow position={[-0.18, height * 1.5, -length * 0.2]}>
            <sphereGeometry args={[0.1, 16, 12]} />
            <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.75} roughness={0.18} />
          </mesh>
          <RoundedBox castShadow args={[width * 0.8, height * 0.22, 0.06]} radius={0.03} smoothness={4} position={[0, height * 0.68, length * 0.54]}>
            <meshStandardMaterial color="#202632" roughness={0.45} />
          </RoundedBox>
        </group>
      )}

      {vehicle.id === 'firetruck' && (
        <group>
          <RoundedBox castShadow args={[width * 0.52, height * 0.42, length * 0.56]} radius={0.08} smoothness={6} position={[0, height * 0.76, length * 0.22]}>
            <meshStandardMaterial color="#ec4f5f" roughness={0.36} metalness={0.04} />
          </RoundedBox>
          <RoundedBox castShadow args={[width * 0.82, height * 0.48, 0.06]} radius={0.035} smoothness={5} position={[0, height * 0.8, length * 0.45]}>
            <meshStandardMaterial color={trimColor} roughness={0.42} />
          </RoundedBox>
          <mesh castShadow position={[width * 0.2, height * 0.82, length * 0.52]}>
            <cylinderGeometry args={[0.1, 0.1, 0.1, 16]} />
            <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={0.3} roughness={0.24} />
          </mesh>
          <mesh castShadow position={[-width * 0.2, height * 0.82, length * 0.52]}>
            <cylinderGeometry args={[0.1, 0.1, 0.1, 16]} />
            <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={0.3} roughness={0.24} />
          </mesh>
          <group position={[width * 0.48, height * 0.82, length * 0.22]} rotation={[Math.PI / 2, 0, 0]}>
            <mesh castShadow>
              <torusGeometry args={[0.28, 0.045, 10, 32]} />
              <meshStandardMaterial color="#d8d0c4" roughness={0.46} />
            </mesh>
          </group>
          <group position={[0, height * 1.38, 0.08]} rotation={[0, 0, Math.PI / 2]}>
            <mesh castShadow>
              <boxGeometry args={[0.12, length * 0.78, 0.12]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.35} />
            </mesh>
            <mesh castShadow position={[0.24, 0, 0]}>
              <boxGeometry args={[0.08, length * 0.72, 0.08]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.35} />
            </mesh>
            {Array.from({ length: 6 }, (_, index) => (
              <mesh castShadow key={index} position={[0.12, -length * 0.31 + index * length * 0.12, 0]}>
                <boxGeometry args={[0.22, 0.035, 0.04]} />
                <meshStandardMaterial color="#f8fafc" roughness={0.35} />
              </mesh>
            ))}
          </group>
        </group>
      )}

      {vehicle.id === 'bulldozer' && (
        <group>
          <RoundedBox castShadow args={[width * 0.78, height * 0.62, length * 0.46]} radius={0.08} smoothness={6} position={[0, height * 1.0, 0.03]}>
            <meshStandardMaterial color="#fbbf24" roughness={0.38} />
          </RoundedBox>
          <SidePanel color="#243244" length={length * 0.26} position={[width * 0.26, height * 1.08, -length * 0.02]} width={height * 0.25} />
          <SidePanel color="#243244" length={length * 0.26} position={[-width * 0.26, height * 1.08, -length * 0.02]} width={height * 0.25} />
          <mesh castShadow position={[0, height * 0.42, -length * 0.68]} rotation={[0.32, 0, 0]}>
            <boxGeometry args={[width * 1.28, height * 0.5, 0.2]} />
            <meshStandardMaterial color={vehicle.secondaryColor} roughness={0.4} metalness={0.2} />
          </mesh>
          <mesh castShadow position={[0, height * 0.2, -length * 0.47]}>
            <boxGeometry args={[width * 1.08, 0.08, 0.16]} />
            <meshStandardMaterial color="#4b5563" roughness={0.5} />
          </mesh>
          <RoundedBox castShadow args={[width * 0.86, height * 0.26, 0.08]} radius={0.04} smoothness={5} position={[0, height * 0.55, length * 0.45]}>
            <meshStandardMaterial color="#374151" roughness={0.5} />
          </RoundedBox>
        </group>
      )}

      {vehicle.id === 'excavator' && (
        <group>
          <mesh castShadow position={[0, height * 0.62, 0.06]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.52, 0.52, 0.22, 28]} />
            <meshStandardMaterial color="#4b5563" roughness={0.55} />
          </mesh>
          <RoundedBox castShadow args={[width * 0.62, height * 0.58, length * 0.42]} radius={0.08} smoothness={6} position={[-width * 0.08, height * 1.02, 0.08]}>
            <meshStandardMaterial color="#f59e0b" roughness={0.4} />
          </RoundedBox>
          <SidePanel color="#243244" length={length * 0.2} position={[width * 0.26, height * 1.08, 0.0]} width={height * 0.28} />
          <SidePanel color="#243244" length={length * 0.2} position={[-width * 0.42, height * 1.08, 0.0]} width={height * 0.28} />
          <group position={[0.08, height * 1.38, -length * 0.12]} rotation={[0.34, 0, 0]}>
            <mesh castShadow position={[0, 0, -0.5]}>
              <boxGeometry args={[0.18, 0.18, 1.1]} />
              <meshStandardMaterial color={vehicle.accentColor} roughness={0.42} />
            </mesh>
            <mesh castShadow position={[0, -0.13, -0.95]} rotation={[0.3, 0, 0]}>
              <boxGeometry args={[0.16, 0.16, 0.82]} />
              <meshStandardMaterial color={vehicle.accentColor} roughness={0.42} />
            </mesh>
            <mesh castShadow position={[0, -0.12, -1.1]}>
              <boxGeometry args={[0.56, 0.18, 0.28]} />
              <meshStandardMaterial color={vehicle.secondaryColor} roughness={0.4} />
            </mesh>
          </group>
          <RoundedBox castShadow args={[width * 0.62, height * 0.2, 0.08]} radius={0.04} smoothness={5} position={[0, height * 0.58, length * 0.42]}>
            <meshStandardMaterial color="#4b5563" roughness={0.54} />
          </RoundedBox>
        </group>
      )}

      {isConstruction
        ? [wheelX, -wheelX].map((x) => <Track key={x} length={length * 0.82} position={[x, height * 0.22, 0.05]} />)
        : [wheelX, -wheelX].flatMap((x) => [wheelZ, -wheelZ].map((z) => <Wheel key={`${x}-${z}`} position={[x, height * 0.28, z]} />))}

      <RoundedBox castShadow args={[width * 0.76, 0.08, 0.08]} radius={0.02} smoothness={4} position={[0, height * 0.52, -length * 0.56]}>
        <meshStandardMaterial color={vehicle.accentColor} emissive={vehicle.accentColor} emissiveIntensity={0.25} roughness={0.22} />
      </RoundedBox>
    </group>
  );
}

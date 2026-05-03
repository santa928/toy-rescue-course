export type VehicleId = 'ambulance' | 'police' | 'firetruck' | 'bulldozer' | 'excavator';

export type VehicleRole = 'rescue' | 'police' | 'fire' | 'construction';

export interface VehicleSpec {
  readonly id: VehicleId;
  readonly label: string;
  readonly role: VehicleRole;
  readonly baseColor: string;
  readonly accentColor: string;
  readonly secondaryColor: string;
  readonly maxSpeed: number;
  readonly acceleration: number;
  readonly braking: number;
  readonly turnPower: number;
  readonly pushPower: number;
  readonly mass: number;
  readonly size: readonly [number, number, number];
}

export const VEHICLES: readonly VehicleSpec[] = [
  {
    id: 'ambulance',
    label: '救急車',
    role: 'rescue',
    baseColor: '#f8fafc',
    accentColor: '#ef4444',
    secondaryColor: '#b91c1c',
    maxSpeed: 8.4,
    acceleration: 11.5,
    braking: 13,
    turnPower: 2.65,
    pushPower: 1.35,
    mass: 1.15,
    size: [1.45, 0.58, 2.25],
  },
  {
    id: 'police',
    label: 'パトカー',
    role: 'police',
    baseColor: '#f8fafc',
    accentColor: '#1f2937',
    secondaryColor: '#2563eb',
    maxSpeed: 9.6,
    acceleration: 12.5,
    braking: 13.5,
    turnPower: 2.95,
    pushPower: 1.2,
    mass: 1,
    size: [1.35, 0.5, 2.1],
  },
  {
    id: 'firetruck',
    label: '消防車',
    role: 'fire',
    baseColor: '#dc2626',
    accentColor: '#f8fafc',
    secondaryColor: '#facc15',
    maxSpeed: 7.4,
    acceleration: 9.2,
    braking: 11,
    turnPower: 2.25,
    pushPower: 1.75,
    mass: 1.4,
    size: [1.5, 0.68, 2.55],
  },
  {
    id: 'bulldozer',
    label: 'ブルドーザー',
    role: 'construction',
    baseColor: '#facc15',
    accentColor: '#f97316',
    secondaryColor: '#374151',
    maxSpeed: 6.5,
    acceleration: 8.4,
    braking: 9.5,
    turnPower: 2.35,
    pushPower: 2.15,
    mass: 1.55,
    size: [1.55, 0.62, 1.9],
  },
  {
    id: 'excavator',
    label: 'ショベルカー',
    role: 'construction',
    baseColor: '#fb923c',
    accentColor: '#facc15',
    secondaryColor: '#4b5563',
    maxSpeed: 6.9,
    acceleration: 8.8,
    braking: 10,
    turnPower: 2.65,
    pushPower: 1.75,
    mass: 1.35,
    size: [1.45, 0.62, 1.95],
  },
] as const;

/**
 * 車種IDから働くくるまの操作パラメータと表示情報を取得する。
 */
export function getVehicleById(vehicleId: VehicleId): VehicleSpec {
  const vehicle = VEHICLES.find((entry) => entry.id === vehicleId);

  if (!vehicle) {
    throw new Error(`Unknown vehicle id: ${vehicleId}`);
  }

  return vehicle;
}

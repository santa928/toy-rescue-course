import type { VehicleId } from '../../voxel-game/domain/vehicleDefinitions';

/** 車種ごとに一時色へ置き換えてよいbody palette ID。 */
export const VEHICLE_PAINTABLE_PALETTE_IDS = {
  'fire-truck': ['red'],
  ambulance: ['white'],
  bulldozer: ['yellow'],
  excavator: ['orange'],
} as const satisfies Record<VehicleId, readonly string[]>;

interface ResolveVehiclePaintColorOptions {
  readonly baseColor: string;
  readonly paintColor: string | null | undefined;
  readonly paletteId: string;
  readonly vehicleId: VehicleId;
}

/** 有効な一時色をpaintable bodyへだけ適用し、それ以外は静的paletteを返す。 */
export function resolveVehiclePaintColor({
  baseColor,
  paintColor,
  paletteId,
  vehicleId,
}: ResolveVehiclePaintColorOptions): string {
  if (typeof paintColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(paintColor)) {
    return baseColor;
  }
  const paintablePaletteIds: readonly string[] = VEHICLE_PAINTABLE_PALETTE_IDS[vehicleId];
  return paintablePaletteIds.includes(paletteId) ? paintColor : baseColor;
}

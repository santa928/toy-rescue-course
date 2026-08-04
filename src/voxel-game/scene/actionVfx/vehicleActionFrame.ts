import type { VehicleId } from '../../domain/vehicleDefinitions';

export const VEHICLE_ACTION_VOXEL_POOL_SIZE = 48;
export const VEHICLE_ACTION_RELEASE_TAIL_SECONDS = 0.32;

export type SpectacleVehicleId = Exclude<VehicleId, 'fire-truck'>;

export type VehicleActionPalette =
  | 'ambulance-red'
  | 'bulldozer-yellow'
  | 'excavator-orange'
  | 'metal'
  | 'police-blue'
  | 'police-red'
  | 'soil'
  | 'white';

/** rendererが共有する車種別の玩具色。 */
export const VEHICLE_ACTION_PALETTE_COLORS: Readonly<Record<VehicleActionPalette, string>> = {
  'ambulance-red': '#ef3d35',
  'bulldozer-yellow': '#ffd84d',
  'excavator-orange': '#f28a20',
  metal: '#c7ccd0',
  'police-blue': '#2f86ff',
  'police-red': '#f4473f',
  soil: '#aa632e',
  white: '#fffdf4',
};

const CYCLE_DURATION_SECONDS: Readonly<Record<SpectacleVehicleId, number>> = {
  ambulance: 1,
  bulldozer: 0.55,
  excavator: 0.9,
  police: 0.5,
};

const HIDDEN_Y = -40;

export interface VehicleActionVoxelTransform {
  active: boolean;
  palette: VehicleActionPalette;
  readonly position: [number, number, number];
  readonly scale: [number, number, number];
  readonly slot: number;
}

export interface VehicleActionVfxFrame {
  activeCount: number;
  actionStartedAtSeconds: number;
  cycleDurationSeconds: number;
  cycleProgress: number;
  pressCount: number;
  releasedAtSeconds: number;
  vehicleId: SpectacleVehicleId | null;
  readonly voxels: VehicleActionVoxelTransform[];
  wasActive: boolean;
}

export interface VehicleActionVfxInput {
  readonly actionActive: boolean;
  readonly deltaSeconds: number;
  readonly elapsedSeconds: number;
  readonly forward: readonly [number, number, number];
  readonly position: readonly [number, number, number];
  readonly speed: number;
  readonly vehicleId: VehicleId;
}

/** 初回material compile前から全48 instanceを白で初期化するcolor bufferを返す。 */
export function createVehicleActionInstanceColorArray(): Float32Array {
  const colors = new Float32Array(VEHICLE_ACTION_VOXEL_POOL_SIZE * 3);
  colors.fill(1);
  return colors;
}

/** 指定IDが自由玩具アクションを持つ非消防車か判定する。 */
export function isSpectacleVehicleId(vehicleId: VehicleId): vehicleId is SpectacleVehicleId {
  return vehicleId !== 'fire-truck';
}

/** 固定poolの1slotを非active状態で作る。 */
function createVoxel(slot: number): VehicleActionVoxelTransform {
  return {
    active: false,
    palette: 'white',
    position: [0, HIDDEN_Y, 0],
    scale: [0, 0, 0],
    slot,
  };
}

/** 48slotを一度だけ確保した自由アクションframeを返す。 */
export function createVehicleActionVfxFrame(): VehicleActionVfxFrame {
  return {
    activeCount: 0,
    actionStartedAtSeconds: -1,
    cycleDurationSeconds: 0,
    cycleProgress: 0,
    pressCount: 0,
    releasedAtSeconds: -1,
    vehicleId: null,
    voxels: Array.from({ length: VEHICLE_ACTION_VOXEL_POOL_SIZE }, (_, slot) => createVoxel(slot)),
    wasActive: false,
  };
}

/** 全slotをzero scaleの画面外位置へ戻す。 */
function hideAllVoxels(frame: VehicleActionVfxFrame): void {
  frame.activeCount = 0;
  for (const voxel of frame.voxels) {
    voxel.active = false;
    voxel.position[0] = 0;
    voxel.position[1] = HIDDEN_Y;
    voxel.position[2] = 0;
    voxel.scale[0] = 0;
    voxel.scale[1] = 0;
    voxel.scale[2] = 0;
  }
}

/** 1slotを車両のright／up／forward基準からworld transformへ変換する。 */
function showVoxel(
  frame: VehicleActionVfxFrame,
  slot: number,
  basis: {
    readonly forwardX: number;
    readonly forwardZ: number;
    readonly origin: readonly [number, number, number];
    readonly rightX: number;
    readonly rightZ: number;
  },
  local: readonly [number, number, number],
  scale: number,
  palette: VehicleActionPalette,
): void {
  const voxel = frame.voxels[slot];
  if (!voxel || !Number.isFinite(scale) || scale <= 0) return;
  voxel.active = true;
  voxel.palette = palette;
  voxel.position[0] = basis.origin[0] + basis.rightX * local[0] + basis.forwardX * local[2];
  voxel.position[1] = basis.origin[1] + local[1];
  voxel.position[2] = basis.origin[2] + basis.rightZ * local[0] + basis.forwardZ * local[2];
  voxel.scale[0] = scale;
  voxel.scale[1] = scale;
  voxel.scale[2] = scale;
  frame.activeCount += 1;
}

/** ブルドーザー前方へbladeの力を示す扇状cubeを配置する。 */
function updateBulldozerVoxels(
  frame: VehicleActionVfxFrame,
  basis: Parameters<typeof showVoxel>[2],
  progress: number,
  tailScale: number,
): void {
  for (let slot = 0; slot < 14; slot += 1) {
    const column = slot % 7;
    const row = Math.floor(slot / 7);
    const spread = (column - 3) * (0.34 + progress * 0.16);
    const palette: VehicleActionPalette = slot % 3 === 0
      ? 'soil'
      : slot % 2 === 0 ? 'metal' : 'bulldozer-yellow';
    showVoxel(
      frame,
      slot,
      basis,
      [spread, 0.42 + row * 0.24 + Math.sin(progress * Math.PI) * 0.32, 1.55 + row * 0.55 + progress * 1.1],
      (0.22 + (1 - progress) * 0.12) * tailScale,
      palette,
    );
  }
}

/** ショベルカー前方へbucketのすくい軌跡を弧状配置する。 */
function updateExcavatorVoxels(
  frame: VehicleActionVfxFrame,
  basis: Parameters<typeof showVoxel>[2],
  progress: number,
  tailScale: number,
): void {
  for (let slot = 0; slot < 12; slot += 1) {
    const step = slot / 11;
    const angle = progress * Math.PI * 0.9 + step * 0.75;
    const palette: VehicleActionPalette = slot % 4 === 0
      ? 'metal'
      : slot % 2 === 0 ? 'soil' : 'excavator-orange';
    showVoxel(
      frame,
      slot,
      basis,
      [0.55 + step * 0.7, 0.38 + Math.sin(angle) * 1.1, 1.05 + Math.cos(angle) * 1.15],
      (0.2 + step * 0.1) * tailScale,
      palette,
    );
  }
}

/** 救急車の周囲へ赤白の十字waveを二重に配置する。 */
function updateAmbulanceVoxels(
  frame: VehicleActionVfxFrame,
  basis: Parameters<typeof showVoxel>[2],
  progress: number,
  tailScale: number,
): void {
  for (let slot = 0; slot < 16; slot += 1) {
    const arm = slot % 4;
    const ring = Math.floor(slot / 4);
    const distance = 0.9 + ring * 0.34 + progress * 0.8;
    const x = arm === 0 ? distance : arm === 1 ? -distance : 0;
    const z = arm === 2 ? distance : arm === 3 ? -distance : 0;
    showVoxel(
      frame,
      slot,
      basis,
      [x, 0.85 + ring * 0.15 + Math.sin(progress * Math.PI) * 0.2, z],
      (0.2 + (3 - ring) * 0.035) * tailScale,
      (slot + ring) % 2 === 0 ? 'ambulance-red' : 'white',
    );
  }
}

/** パトカーへ赤青の左右ringと走行trailを配置する。 */
function updatePoliceVoxels(
  frame: VehicleActionVfxFrame,
  basis: Parameters<typeof showVoxel>[2],
  progress: number,
  speed: number,
  actionActive: boolean,
  tailScale: number,
): void {
  for (let slot = 0; slot < 8; slot += 1) {
    const side = slot % 2 === 0 ? -1 : 1;
    const step = Math.floor(slot / 2);
    const palette: VehicleActionPalette = side < 0 ? 'police-red' : 'police-blue';
    showVoxel(
      frame,
      slot,
      basis,
      [side * (0.9 + step * 0.22 + progress * 0.55), 1.08 + step * 0.18, 0.28 - step * 0.2],
      (0.2 + (step % 2) * 0.06) * tailScale,
      palette,
    );
  }
  for (let slot = 8; slot < 12; slot += 1) {
    const step = slot - 8;
    const redPhase = progress < 0.5;
    showVoxel(
      frame,
      slot,
      basis,
      [(step % 2 === 0 ? -0.3 : 0.3), 1.18 + step * 0.32, 0],
      (0.18 + (step % 2) * 0.035) * tailScale,
      redPhase === (step % 2 === 0) ? 'police-red' : 'police-blue',
    );
  }
  if (getActivePoliceTrailCount({ actionActive, speed }) === 0) return;
  for (let slot = 12; slot < 18; slot += 1) {
    const step = slot - 12;
    showVoxel(
      frame,
      slot,
      basis,
      [(step % 2 === 0 ? -0.58 : 0.58), 0.28, -1.45 - step * 0.34],
      (0.18 + (1 - progress) * 0.06) * tailScale,
      step % 2 === 0 ? 'police-red' : 'police-blue',
    );
  }
}

/** サイレン走行時だけ確保済み後方trail 6slotを有効化する。 */
export function getActivePoliceTrailCount({
  actionActive,
  speed,
}: {
  readonly actionActive: boolean;
  readonly speed: number;
}): number {
  return actionActive && Number.isFinite(speed) && speed >= 0.35 ? 6 : 0;
}

/** 入力と車両telemetryから自由アクションの固定frameをin-place更新する。 */
export function updateVehicleActionVfxFrame(
  frame: VehicleActionVfxFrame,
  input: VehicleActionVfxInput,
): void {
  hideAllVoxels(frame);
  const finitePosition = input.position.every(Number.isFinite);
  const finiteForward = input.forward.every(Number.isFinite);
  const finiteTime = Number.isFinite(input.elapsedSeconds) && Number.isFinite(input.deltaSeconds);
  if (!isSpectacleVehicleId(input.vehicleId) || !finitePosition || !finiteForward || !finiteTime) {
    frame.vehicleId = null;
    frame.wasActive = false;
    frame.actionStartedAtSeconds = -1;
    frame.releasedAtSeconds = -1;
    frame.cycleProgress = 0;
    frame.cycleDurationSeconds = 0;
    return;
  }

  const elapsedSeconds = Math.max(0, input.elapsedSeconds);
  const vehicleChanged = frame.vehicleId !== input.vehicleId;
  if (vehicleChanged) {
    frame.vehicleId = input.vehicleId;
    frame.wasActive = false;
    frame.actionStartedAtSeconds = -1;
    frame.releasedAtSeconds = -1;
  }
  if (input.actionActive && !frame.wasActive) {
    frame.actionStartedAtSeconds = elapsedSeconds;
    frame.releasedAtSeconds = -1;
    frame.pressCount += 1;
  } else if (!input.actionActive && frame.wasActive) {
    frame.releasedAtSeconds = elapsedSeconds;
  }
  frame.wasActive = input.actionActive;
  frame.cycleDurationSeconds = CYCLE_DURATION_SECONDS[input.vehicleId];

  const releaseAge = frame.releasedAtSeconds < 0
    ? 0
    : elapsedSeconds - frame.releasedAtSeconds;
  const visible = frame.actionStartedAtSeconds >= 0
    && (input.actionActive || releaseAge <= VEHICLE_ACTION_RELEASE_TAIL_SECONDS);
  if (!visible) {
    frame.cycleProgress = 0;
    return;
  }

  const actionAge = Math.max(0, elapsedSeconds - frame.actionStartedAtSeconds);
  frame.cycleProgress = (actionAge % frame.cycleDurationSeconds) / frame.cycleDurationSeconds;
  const forwardLength = Math.hypot(input.forward[0], input.forward[2]);
  const forwardX = forwardLength > 0.0001 ? input.forward[0] / forwardLength : 0;
  const forwardZ = forwardLength > 0.0001 ? input.forward[2] / forwardLength : 1;
  const basis = {
    forwardX,
    forwardZ,
    origin: input.position,
    rightX: forwardZ,
    rightZ: -forwardX,
  } as const;
  const tailScale = input.actionActive
    ? 1
    : Math.max(0, 1 - releaseAge / VEHICLE_ACTION_RELEASE_TAIL_SECONDS);
  const safeSpeed = Number.isFinite(input.speed) ? Math.max(0, input.speed) : 0;

  if (input.vehicleId === 'bulldozer') {
    updateBulldozerVoxels(frame, basis, frame.cycleProgress, tailScale);
  } else if (input.vehicleId === 'excavator') {
    updateExcavatorVoxels(frame, basis, frame.cycleProgress, tailScale);
  } else if (input.vehicleId === 'ambulance') {
    updateAmbulanceVoxels(frame, basis, frame.cycleProgress, tailScale);
  } else {
    updatePoliceVoxels(
      frame,
      basis,
      frame.cycleProgress,
      safeSpeed,
      input.actionActive,
      tailScale,
    );
  }
}

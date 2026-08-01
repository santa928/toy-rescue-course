import type {
  ColorPlaySourceDefinition,
  VehicleColorId,
  WorldPoint,
} from './productionWorldMap';
import { COLOR_PLAY_SOURCES } from './worldLayout';

/** 1つのpoolを浅く波打たせる固定voxel数。 */
export const COLOR_PLAY_POOL_SLOT_COUNT = 8;

/** 1つのshower内を上から循環させる固定voxel数。 */
export const COLOR_PLAY_SHOWER_SLOT_COUNT = 18;

/** 赤青黄のpoolとshowerを合わせた動的voxel総数。 */
export const COLOR_PLAY_TOTAL_CUBE_COUNT = 78;

/** 3色の動的batch、白frame、濃灰baseを合わせたdraw call数。 */
export const COLOR_PLAY_STATION_DRAW_CALLS = 5;

/** 色遊びVFXの1固定slotを表すin-place更新可能なtransform。 */
export interface ColorPlayVfxInstance {
  readonly colorHex: string;
  readonly colorId: VehicleColorId;
  readonly kind: ColorPlaySourceDefinition['kind'];
  readonly position: [number, number, number];
  readonly scale: [number, number, number];
  readonly slot: number;
  readonly sourceId: string;
  readonly sourceIndex: number;
}

/** 全色遊びsourceのtransform identityを維持する再利用frame。 */
export interface ColorPlayVfxFrame {
  readonly instances: ColorPlayVfxInstance[];
}

/** 静的stationをInstancedMeshへ渡す直方体定義。 */
export interface ColorPlayStationBox {
  readonly position: WorldPoint;
  readonly scale: WorldPoint;
}

/** 白い縁と濃灰の足場へ分けた静的station batch。 */
export interface ColorPlayStationBoxes {
  readonly baseBoxes: readonly ColorPlayStationBox[];
  readonly frameBoxes: readonly ColorPlayStationBox[];
}

/** 不正な時刻を決定的な0秒へ正規化する。 */
function normalizeElapsedSeconds(elapsedSeconds: number): number {
  return Number.isFinite(elapsedSeconds) && elapsedSeconds >= 0 ? elapsedSeconds : 0;
}

/** source種別に応じた固定slot数を返す。 */
function getSourceSlotCount(source: ColorPlaySourceDefinition): number {
  return source.kind === 'pool'
    ? COLOR_PLAY_POOL_SLOT_COUNT
    : COLOR_PLAY_SHOWER_SLOT_COUNT;
}

/** sourceとslotに紐づく初期transformを一度だけ確保する。 */
function createInstance(
  source: ColorPlaySourceDefinition,
  sourceIndex: number,
  slot: number,
): ColorPlayVfxInstance {
  return {
    colorHex: source.color,
    colorId: source.colorId,
    kind: source.kind,
    position: [source.position[0], source.position[1], source.position[2]],
    scale: [1, 1, 1],
    slot,
    sourceId: source.id,
    sourceIndex,
  };
}

/** 全sourceの固定slotを確保し、0秒時点の有限transformで初期化する。 */
export function createColorPlayVfxFrame(
  sources: readonly ColorPlaySourceDefinition[] = COLOR_PLAY_SOURCES,
): ColorPlayVfxFrame {
  const instances: ColorPlayVfxInstance[] = [];
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const source = sources[sourceIndex];
    for (let slot = 0; slot < getSourceSlotCount(source); slot += 1) {
      instances.push(createInstance(source, sourceIndex, slot));
    }
  }
  return updateColorPlayVfxFrame({ instances }, 0, sources);
}

/** poolの8枚を浅いタイル状に並べ、位相差のある波をin-place反映する。 */
function updatePoolInstance(
  instance: ColorPlayVfxInstance,
  source: ColorPlaySourceDefinition,
  elapsedSeconds: number,
): void {
  const column = instance.slot % 4;
  const row = Math.floor(instance.slot / 4);
  const wave = Math.sin(elapsedSeconds * 2.4 + instance.slot * 0.8);
  instance.position[0] = source.position[0] + (column - 1.5) * 0.85;
  instance.position[1] = source.position[1] + 0.075 + wave * 0.07;
  instance.position[2] = source.position[2] + (row - 0.5) * 1.28;
  instance.scale[0] = 0.72;
  instance.scale[1] = 0.1 + (wave + 1) * 0.018;
  instance.scale[2] = 1.04;
}

/** showerの18滴をアーチ上部から床面へ循環させてin-place反映する。 */
function updateShowerInstance(
  instance: ColorPlayVfxInstance,
  source: ColorPlaySourceDefinition,
  elapsedSeconds: number,
): void {
  const column = instance.slot % 3;
  const row = Math.floor(instance.slot / 3);
  const progress = (elapsedSeconds * 0.72 + row / 6 + column * 0.08) % 1;
  const wobble = Math.sin(elapsedSeconds * 4 + instance.slot * 1.3);
  const size = 0.23 + wobble * 0.025;
  instance.position[0] = source.position[0] + (column - 1) * 1.1 + wobble * 0.05;
  instance.position[1] = 0.35 + (1 - progress) * 2.84;
  instance.position[2] = source.position[2] + (row % 2 === 0 ? -0.24 : 0.24);
  instance.scale[0] = size;
  instance.scale[1] = size * 1.35;
  instance.scale[2] = size;
}

/** 全固定slotを配列とtransform identityを変えずに指定時刻へ更新する。 */
export function updateColorPlayVfxFrame(
  frame: ColorPlayVfxFrame,
  elapsedSeconds: number,
  sources: readonly ColorPlaySourceDefinition[] = COLOR_PLAY_SOURCES,
): ColorPlayVfxFrame {
  const safeElapsedSeconds = normalizeElapsedSeconds(elapsedSeconds);
  for (const instance of frame.instances) {
    const source = sources[instance.sourceIndex];
    if (!source) continue;
    if (source.kind === 'pool') {
      updatePoolInstance(instance, source, safeElapsedSeconds);
    } else {
      updateShowerInstance(instance, source, safeElapsedSeconds);
    }
  }
  return frame;
}

/** poolの白縁4本またはshowerの白アーチ3本を静的batchへ追加する。 */
function appendFrameBoxes(
  target: ColorPlayStationBox[],
  source: ColorPlaySourceDefinition,
): void {
  if (source.kind === 'pool') {
    target.push(
      { position: [source.position[0] - 2.16, 0.36, source.position[2]], scale: [0.18, 0.28, 3.45] },
      { position: [source.position[0] + 2.16, 0.36, source.position[2]], scale: [0.18, 0.28, 3.45] },
      { position: [source.position[0], 0.36, source.position[2] - 1.64], scale: [4.5, 0.28, 0.18] },
      { position: [source.position[0], 0.36, source.position[2] + 1.64], scale: [4.5, 0.28, 0.18] },
    );
    return;
  }
  target.push(
    { position: [source.position[0] - 1.75, 1.68, source.position[2]], scale: [0.22, 3.05, 0.3] },
    { position: [source.position[0] + 1.75, 1.68, source.position[2]], scale: [0.22, 3.05, 0.3] },
    { position: [source.position[0], 3.18, source.position[2]], scale: [3.72, 0.24, 0.3] },
  );
}

/** 6 stationを白frame 21個と濃灰base 6個の安定batchへ構成する。 */
export function createColorPlayStationBoxes(
  sources: readonly ColorPlaySourceDefinition[] = COLOR_PLAY_SOURCES,
): ColorPlayStationBoxes {
  const frameBoxes: ColorPlayStationBox[] = [];
  const baseBoxes: ColorPlayStationBox[] = [];
  for (const source of sources) {
    appendFrameBoxes(frameBoxes, source);
    baseBoxes.push({
      position: [source.position[0], 0.16, source.position[2]],
      scale: [4.7, 0.14, 3.65],
    });
  }
  return { baseBoxes, frameBoxes };
}

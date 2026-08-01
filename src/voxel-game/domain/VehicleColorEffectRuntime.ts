import type { VehicleId } from './vehicleDefinitions';
import type {
  ColorPlaySourceDefinition,
  VehicleColorId,
  WorldPoint,
} from '../scene/productionWorldMap';

export const COLOR_EFFECT_DURATION_MILLISECONDS = 12_000;
export const COLOR_SOURCE_TRIGGER_MARGIN = 0.6;

/** 車体の一時色、接触source、残時間を外部へ公開する不変snapshot。 */
export interface VehicleColorEffectSnapshot {
  readonly active: boolean;
  readonly activationCount: number;
  readonly colorHex: string | null;
  readonly colorId: VehicleColorId | null;
  readonly contactSourceId: string | null;
  readonly remainingMilliseconds: number;
  readonly remainingSeconds: number;
  readonly sourceId: string | null;
  readonly sourceKind: ColorPlaySourceDefinition['kind'] | null;
  readonly vehicleId: VehicleId | null;
}

export type VehicleColorEffectListener = (snapshot: VehicleColorEffectSnapshot) => void;

/** XZ triggerを0.6unit広げ、定義順で最初に接触する有効sourceを返す。 */
export function findColorPlaySource(
  sources: readonly ColorPlaySourceDefinition[],
  position: WorldPoint,
): ColorPlaySourceDefinition | null {
  if (!position.every(Number.isFinite)) return null;
  const [x, , z] = position;
  return sources.find(({ triggerBounds }) => (
    x >= triggerBounds.minX - COLOR_SOURCE_TRIGGER_MARGIN
    && x <= triggerBounds.maxX + COLOR_SOURCE_TRIGGER_MARGIN
    && z >= triggerBounds.minZ - COLOR_SOURCE_TRIGGER_MARGIN
    && z <= triggerBounds.maxZ + COLOR_SOURCE_TRIGGER_MARGIN
  )) ?? null;
}

/** 残ミリ秒を子ども向けHUDへ表示する切り上げ秒へ変換する。 */
function toRemainingSeconds(remainingMilliseconds: number): number {
  return Math.ceil(Math.max(0, remainingMilliseconds) / 1_000);
}

/** listener通知を色イベント・接触edge・秒境界だけへ絞る署名を返す。 */
function createObservableSignature(snapshot: VehicleColorEffectSnapshot): string {
  return [
    snapshot.active,
    snapshot.activationCount,
    snapshot.colorId,
    snapshot.contactSourceId,
    snapshot.remainingSeconds,
    snapshot.sourceId,
    snapshot.sourceKind,
    snapshot.vehicleId,
  ].join('|');
}

/** 初期状態の車体色なしsnapshotを返す。 */
function createInactiveSnapshot(activationCount = 0): VehicleColorEffectSnapshot {
  return {
    active: false,
    activationCount,
    colorHex: null,
    colorId: null,
    contactSourceId: null,
    remainingMilliseconds: 0,
    remainingSeconds: 0,
    sourceId: null,
    sourceKind: null,
    vehicleId: null,
  };
}

/** 6 sourceの接触、上書き、期限、車種所有権を決定的に管理するpure runtime。 */
export class VehicleColorEffectRuntime {
  private readonly listeners = new Set<VehicleColorEffectListener>();

  private observableSignature: string;

  private snapshot: VehicleColorEffectSnapshot = createInactiveSnapshot();

  public constructor(private readonly sources: readonly ColorPlaySourceDefinition[]) {
    this.observableSignature = createObservableSignature(this.snapshot);
  }

  /** 現在状態を外部から変更できないfresh objectとして返す。 */
  public getSnapshot(): VehicleColorEffectSnapshot {
    return { ...this.snapshot };
  }

  /** 色イベントと秒境界の通知を購読し、解除関数を返す。 */
  public subscribe(listener: VehicleColorEffectListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 最新車両位置をsource接触へ同期し、entry edgeだけで12秒効果を発動する。 */
  public syncVehiclePosition(vehicleId: VehicleId, position: WorldPoint): void {
    const source = findColorPlaySource(this.sources, position);
    if (source === null) {
      if (this.snapshot.contactSourceId === null) return;
      this.snapshot = { ...this.snapshot, contactSourceId: null };
      this.notifyIfObservableChanged();
      return;
    }

    if (
      this.snapshot.active
      && this.snapshot.contactSourceId === source.id
      && this.snapshot.vehicleId === vehicleId
    ) {
      return;
    }

    this.snapshot = {
      active: true,
      activationCount: this.snapshot.activationCount + 1,
      colorHex: source.color,
      colorId: source.colorId,
      contactSourceId: source.id,
      remainingMilliseconds: COLOR_EFFECT_DURATION_MILLISECONDS,
      remainingSeconds: toRemainingSeconds(COLOR_EFFECT_DURATION_MILLISECONDS),
      sourceId: source.id,
      sourceKind: source.kind,
      vehicleId,
    };
    this.notifyIfObservableChanged();
  }

  /** source離脱後だけ正の有限時間を減らし、0msで元paletteへ戻す。 */
  public advance(milliseconds: number): void {
    if (
      !Number.isFinite(milliseconds)
      || milliseconds <= 0
      || !this.snapshot.active
      || this.snapshot.contactSourceId !== null
    ) {
      return;
    }

    const remainingMilliseconds = Math.max(
      0,
      this.snapshot.remainingMilliseconds - milliseconds,
    );
    if (remainingMilliseconds === 0) {
      this.snapshot = createInactiveSnapshot(this.snapshot.activationCount);
    } else {
      this.snapshot = {
        ...this.snapshot,
        remainingMilliseconds,
        remainingSeconds: toRemainingSeconds(remainingMilliseconds),
      };
    }
    this.notifyIfObservableChanged();
  }

  /** 成功した車種選択でownerが変わる場合だけ一時色を解除する。 */
  public handleSuccessfulVehicleSwitch(nextVehicleId: VehicleId): void {
    if (!this.snapshot.active || this.snapshot.vehicleId === nextVehicleId) return;
    this.snapshot = createInactiveSnapshot(this.snapshot.activationCount);
    this.notifyIfObservableChanged();
  }

  /** 秒量子化した公開状態が変化した場合だけlistenerへfresh snapshotを通知する。 */
  private notifyIfObservableChanged(): void {
    const signature = createObservableSignature(this.snapshot);
    if (signature === this.observableSignature) return;
    this.observableSignature = signature;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

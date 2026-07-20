export const CHIP_POOL_SIZE = 32;
export const CHIP_BURST_SIZE = 8;
export const CHIP_LIFETIME_SECONDS = 0.35;

/** 元blockから分離する主破片の、初期配置と決定的な打ち出し係数。 */
export interface MainFragmentDefinition {
  readonly forwardSpeed: number;
  readonly lateralSpeed: number;
  readonly localPosition: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly upwardSpeed: number;
}

/** 補助chip burstの変換を求めるための入力値。 */
export interface ChipBurstInput {
  readonly ageSeconds: number;
  readonly blockColor: string;
  readonly origin: readonly [number, number, number];
  readonly startSlot: number;
}

/** 固定pool内の補助chip一片の描画変換。 */
export interface ChipInstanceTransform {
  readonly active: boolean;
  readonly color: string;
  readonly position: readonly [number, number, number];
  readonly scale: number;
  readonly slot: number;
}

/** 固定32slotを同一形状で返す補助chip burstの描画フレーム。 */
export interface ChipBurstFrame {
  readonly instances: readonly ChipInstanceTransform[];
}

const MAIN_FRAGMENT_DEFINITIONS: readonly MainFragmentDefinition[] = [
  { forwardSpeed: 2.1, lateralSpeed: -1.15, localPosition: [-0.25, -0.25, 0], scale: [0.5, 0.5, 0.5], upwardSpeed: 2.2 },
  { forwardSpeed: 2.4, lateralSpeed: 0, localPosition: [0, -0.25, 0], scale: [0.5, 0.5, 0.5], upwardSpeed: 2.6 },
  { forwardSpeed: 2.7, lateralSpeed: 1.1, localPosition: [0.25, -0.25, 0], scale: [0.5, 0.5, 0.5], upwardSpeed: 2.35 },
  { forwardSpeed: 2.9, lateralSpeed: -0.9, localPosition: [-0.25, 0.25, 0], scale: [0.5, 0.5, 0.5], upwardSpeed: 3.1 },
  { forwardSpeed: 3.2, lateralSpeed: 0.2, localPosition: [0, 0.25, 0], scale: [0.5, 0.5, 0.5], upwardSpeed: 3.8 },
  { forwardSpeed: 3.45, lateralSpeed: 0.95, localPosition: [0.25, 0.25, 0], scale: [0.5, 0.5, 0.5], upwardSpeed: 3.35 },
];

const CHIP_DIRECTIONS = [
  [-0.82, 0.82, -0.24], [-0.42, 1.08, 0.3], [0.04, 1.24, -0.42], [0.48, 0.98, 0.2],
  [0.86, 0.72, -0.18], [-0.66, 0.62, 0.54], [0.28, 0.72, 0.68], [0.72, 0.56, 0.46],
] as const;

/** 元block内に収まる3列×2段の主破片定義を返す。 */
export function createMainFragmentDefinitions(): readonly MainFragmentDefinition[] {
  return MAIN_FRAGMENT_DEFINITIONS;
}

/** 衝突forwardと直交する左右spreadから決定的な主破片初速を返す。 */
export function resolveMainFragmentVelocity(
  definition: MainFragmentDefinition,
  impactForward: readonly [number, number, number],
): readonly [number, number, number] {
  const length = Math.hypot(impactForward[0], impactForward[2]) || 1;
  const forwardX = impactForward[0] / length;
  const forwardZ = impactForward[2] / length;
  const rightX = forwardZ;
  const rightZ = -forwardX;

  return [
    forwardX * definition.forwardSpeed + rightX * definition.lateralSpeed,
    definition.upwardSpeed,
    forwardZ * definition.forwardSpeed + rightZ * definition.lateralSpeed,
  ];
}

/** 0〜31のpool slotへ丸める。 */
function normalizePoolSlot(slot: number): number {
  return ((slot % CHIP_POOL_SIZE) + CHIP_POOL_SIZE) % CHIP_POOL_SIZE;
}

/** 固定32slotのうち連続8slotだけを、経過時間に応じた補助chipへ変換する。 */
export function createChipBurstFrame(input: ChipBurstInput): ChipBurstFrame {
  const normalizedAge = Math.min(1, Math.max(0, input.ageSeconds / CHIP_LIFETIME_SECONDS));
  const active = normalizedAge < 1;
  const activeSlots = new Set<number>();

  if (active) {
    for (let offset = 0; offset < CHIP_BURST_SIZE; offset += 1) {
      activeSlots.add(normalizePoolSlot(input.startSlot + offset));
    }
  }

  const instances: ChipInstanceTransform[] = [];
  for (let slot = 0; slot < CHIP_POOL_SIZE; slot += 1) {
    const burstOffset = normalizePoolSlot(slot - input.startSlot);
    const isActive = activeSlots.has(slot);
    const direction = CHIP_DIRECTIONS[burstOffset % CHIP_BURST_SIZE];
    instances.push({
      active: isActive,
      color: input.blockColor,
      position: [
        input.origin[0] + direction[0] * normalizedAge,
        input.origin[1] + direction[1] * normalizedAge - normalizedAge * normalizedAge * 0.18,
        input.origin[2] + direction[2] * normalizedAge,
      ],
      scale: isActive ? 0.16 * (1 - normalizedAge) : 0,
      slot,
    });
  }

  return { instances };
}

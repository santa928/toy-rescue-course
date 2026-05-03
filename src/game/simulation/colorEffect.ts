export type PaintColor = 'red' | 'blue' | 'yellow' | 'green';

export interface ColorEffect {
  readonly color: PaintColor;
  readonly remainingSeconds: number;
}

export const PAINT_COLORS: Record<PaintColor, string> = {
  red: '#ef4444',
  blue: '#2563eb',
  yellow: '#facc15',
  green: '#22c55e',
};

/**
 * 色ギミックに触れた車へ、一時的な着色状態を付与する。
 */
export function applyColorEffect(
  _current: ColorEffect | null,
  color: PaintColor,
  durationSeconds: number,
): ColorEffect {
  return {
    color,
    remainingSeconds: Math.max(0, durationSeconds),
  };
}

/**
 * 経過秒数に応じて一時色の残り時間を進め、期限切れなら解除する。
 */
export function tickColorEffect(effect: ColorEffect | null, deltaSeconds: number): ColorEffect | null {
  if (!effect) {
    return null;
  }

  const remainingSeconds = Math.max(0, effect.remainingSeconds - deltaSeconds);

  if (remainingSeconds <= 0) {
    return null;
  }

  return {
    ...effect,
    remainingSeconds,
  };
}

/**
 * 現在の車体色として、着色中の色または車種の基本色を返す。
 */
export function resolvePaintedColor(baseColor: string, effect: ColorEffect | null): string {
  return effect ? PAINT_COLORS[effect.color] : baseColor;
}

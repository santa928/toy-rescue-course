/** viewport上の実測済みHUD矩形。 */
export interface ScreenRect {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

/** 主要HUD同士とviewportの収まりを検証する入力。 */
export interface HudLayoutRects {
  readonly colorEffect: ScreenRect | null;
  readonly fullscreen: ScreenRect;
  readonly mission: ScreenRect;
  readonly selector: ScreenRect | null;
  readonly viewport: { readonly height: number; readonly width: number };
}

/** 矩形が有限な正寸法でviewport内へ収まるか判定する。 */
function isRectInsideViewport(
  rect: ScreenRect,
  viewport: HudLayoutRects['viewport'],
): boolean {
  return [rect.bottom, rect.left, rect.right, rect.top, viewport.height, viewport.width]
    .every(Number.isFinite)
    && viewport.height > 0
    && viewport.width > 0
    && rect.left >= 0
    && rect.top >= 0
    && rect.right > rect.left
    && rect.bottom > rect.top
    && rect.right <= viewport.width
    && rect.bottom <= viewport.height;
}

/** 重ならない2矩形の最短距離を返し、重なっていれば0を返す。 */
function getRectDistance(left: ScreenRect, right: ScreenRect): number {
  const horizontalGap = Math.max(left.left - right.right, right.left - left.right, 0);
  const verticalGap = Math.max(left.top - right.bottom, right.top - left.bottom, 0);
  return Math.hypot(horizontalGap, verticalGap);
}

/** 主要HUDがviewport内に収まり、全組が指定安全余白以上離れているか判定する。 */
export function isHudLayoutSafe(layout: HudLayoutRects, minimumGap = 8): boolean {
  if (!Number.isFinite(minimumGap) || minimumGap < 0) return false;
  const rectangles = [layout.selector, layout.mission, layout.colorEffect, layout.fullscreen]
    .filter((rect): rect is ScreenRect => rect !== null);
  if (!rectangles.every((rect) => isRectInsideViewport(rect, layout.viewport))) return false;
  if (
    layout.colorEffect !== null
    && getRectDistance(layout.mission, layout.colorEffect) < 10
  ) return false;

  for (let leftIndex = 0; leftIndex < rectangles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rectangles.length; rightIndex += 1) {
      if (getRectDistance(rectangles[leftIndex], rectangles[rightIndex]) < minimumGap) return false;
    }
  }
  return true;
}

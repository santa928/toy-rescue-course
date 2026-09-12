const MIN_CAMERA_ZOOM = 56;
const MAX_CAMERA_ZOOM = 72;
const LOW_HEIGHT_VIEWPORT_MAX_PX = 480;

/** viewport寸法から、低高さ画面の上端安全余白を保つworld camera倍率を返す。 */
export function resolveWorldFixedCameraZoom(width: number, height: number): number {
  const safeHeight = Math.max(1, height);
  const aspect = width / safeHeight;
  const aspectZoom = Math.min(
    MAX_CAMERA_ZOOM,
    Math.max(MIN_CAMERA_ZOOM, MIN_CAMERA_ZOOM + (aspect - 1) * 16),
  );

  // 横画面は車体の投影高を画面高の半分以下に、縦画面は左右の操作余白を確保する。
  const availableZoom = safeHeight <= LOW_HEIGHT_VIEWPORT_MAX_PX
    ? Math.min(safeHeight * 0.1, width / (width <= 700 ? 25 : 21.2))
    : width < 640 ? width / 8.8 : aspectZoom;
  return Math.min(aspectZoom, availableZoom);
}

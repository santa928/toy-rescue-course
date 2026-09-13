const MIN_CAMERA_ZOOM = 56;
const MAX_CAMERA_ZOOM = 72;

/** viewport寸法から、低高さ画面の上端安全余白を保つworld camera倍率を返す。 */
export function resolveWorldFixedCameraZoom(width: number, height: number): number {
  const safeHeight = Math.max(1, height);
  const aspect = width / safeHeight;
  const aspectZoom = Math.min(
    MAX_CAMERA_ZOOM,
    Math.max(MIN_CAMERA_ZOOM, MIN_CAMERA_ZOOM + (aspect - 1) * 16),
  );

  // 上部HUDと車体中央の余白が増える分だけ倍率を連続的に解放する。
  // 480px/700px境界で突然拡大すると、背の高い車体がselectorへ重なる。
  const wideLandscapeRatio = Math.max(0, Math.min(1, (width - 700) / 144));
  const lowHeightWidthDivisor = 25 - wideLandscapeRatio * 3.8;
  const heightRoomRatio = Math.max(0, Math.min(1, (safeHeight - 480) / 240));
  const widthDivisor = lowHeightWidthDivisor
    + (8.8 - lowHeightWidthDivisor) * heightRoomRatio;
  const availableZoom = Math.min(safeHeight * 0.1, width / widthDivisor);
  return Math.min(aspectZoom, availableZoom);
}

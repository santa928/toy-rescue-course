const MIN_CAMERA_ZOOM = 56;
const MAX_CAMERA_ZOOM = 72;
const LOW_HEIGHT_VIEWPORT_MAX_PX = 480;
const LOW_HEIGHT_VIEWPORT_ZOOM_CAP = 56;

/** viewport寸法から、低高さ画面の上端安全余白を保つworld camera倍率を返す。 */
export function resolveWorldFixedCameraZoom(width: number, height: number): number {
  const safeHeight = Math.max(1, height);
  const aspect = width / safeHeight;
  const aspectZoom = Math.min(
    MAX_CAMERA_ZOOM,
    Math.max(MIN_CAMERA_ZOOM, MIN_CAMERA_ZOOM + (aspect - 1) * 16),
  );

  return safeHeight <= LOW_HEIGHT_VIEWPORT_MAX_PX
    ? Math.min(aspectZoom, LOW_HEIGHT_VIEWPORT_ZOOM_CAP)
    : aspectZoom;
}

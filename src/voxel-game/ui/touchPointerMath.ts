/** joystick要素の画面上の矩形。DOMRectから必要な値だけを受け取る。 */
export interface JoystickBounds {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

/** 車両controlへ渡す-1から1のjoystick座標。 */
export interface JoystickPointer {
  readonly x: number;
  readonly y: number;
}

/** 浮動スティックを開始した画面座標。 */
export interface SwipeOrigin {
  readonly x: number;
  readonly y: number;
}

/** pointer座標をjoystick中心基準へ変換し、円形半径内へclampする。 */
export function resolveJoystickPointer(
  bounds: JoystickBounds,
  clientX: number,
  clientY: number,
): JoystickPointer {
  const radius = Math.min(bounds.width, bounds.height) / 2;
  if (!Number.isFinite(radius) || radius <= 0) return { x: 0, y: 0 };

  const rawX = (clientX - (bounds.left + bounds.width / 2)) / radius;
  const rawY = (clientY - (bounds.top + bounds.height / 2)) / radius;
  const magnitude = Math.hypot(rawX, rawY);
  if (!Number.isFinite(magnitude) || magnitude === 0) return { x: 0, y: 0 };
  const scale = magnitude > 1 ? 1 / magnitude : 1;
  return { x: rawX * scale, y: rawY * scale };
}

/** pointer開始点から現在点への差を円形の-1〜1入力へ正規化する。 */
export function resolveSwipePointer(
  origin: SwipeOrigin,
  clientX: number,
  clientY: number,
  maximumDistance: number,
): JoystickPointer {
  if (
    ![origin.x, origin.y, clientX, clientY, maximumDistance].every(Number.isFinite)
    || maximumDistance <= 0
  ) {
    return { x: 0, y: 0 };
  }
  const rawX = (clientX - origin.x) / maximumDistance;
  const rawY = (clientY - origin.y) / maximumDistance;
  const magnitude = Math.hypot(rawX, rawY);
  if (magnitude <= 1) return { x: rawX, y: rawY };
  return { x: rawX / magnitude, y: rawY / magnitude };
}

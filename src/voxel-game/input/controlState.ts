/** キーボードまたは画面ボタンから入力できる離散操作。 */
export type DigitalAction = 'forward' | 'backward' | 'left' | 'right' | 'spray';

/** デバイス別の入力を保持する不変の内部状態。 */
export interface ControlState {
  readonly digital: Readonly<Record<DigitalAction, boolean>>;
  readonly touchStick: readonly [number, number] | null;
}

/** 車両制御と放水処理が共通で読む画面方向の正規化済み入力値。 */
export interface DriveCommand {
  readonly moveX: number;
  readonly moveY: number;
  readonly spray: boolean;
}

const TOUCH_STICK_DEAD_ZONE = 0.14;

/** 全操作を離した初期状態を返す。 */
export function createControlState(): ControlState {
  return {
    digital: { backward: false, forward: false, left: false, right: false, spray: false },
    touchStick: null,
  };
}

/** keyboardまたはbuttonのdigital actionを不変更新する。 */
export function setDigitalAction(state: ControlState, action: DigitalAction, pressed: boolean): ControlState {
  return { ...state, digital: { ...state.digital, [action]: pressed } };
}

/** touch stickを有限な-1から1へclampし、dead zone内ならkeyboardへ戻す。 */
export function setTouchStick(state: ControlState, x: number, y: number): ControlState {
  const finiteX = Number.isFinite(x) ? x : 0;
  const finiteY = Number.isFinite(y) ? y : 0;
  let clampedX = Math.max(-1, Math.min(1, finiteX));
  let clampedY = Math.max(-1, Math.min(1, finiteY));
  const clampedLength = Math.hypot(clampedX, clampedY);
  if (clampedLength > 1) {
    clampedX /= clampedLength;
    clampedY /= clampedLength;
  }
  const touchStick: readonly [number, number] | null = Math.hypot(clampedX, clampedY) < TOUCH_STICK_DEAD_ZONE
    ? null
    : [clampedX, clampedY];
  return { ...state, touchStick };
}

/** device固有状態を画面の左右・上下へ進む共通commandへ変換する。 */
export function toDriveCommand(state: ControlState): DriveCommand {
  let moveX = Number(state.digital.right) - Number(state.digital.left);
  let moveY = Number(state.digital.forward) - Number(state.digital.backward);
  if (state.touchStick) {
    moveX = state.touchStick[0];
    moveY = -state.touchStick[1];
  } else {
    const digitalLength = Math.hypot(moveX, moveY);
    if (digitalLength > 1) {
      moveX = Math.sign(moveX) * Math.SQRT1_2;
      moveY = Math.sign(moveY) * Math.SQRT1_2;
    }
  }
  return { moveX, moveY, spray: state.digital.spray };
}

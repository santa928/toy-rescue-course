/** キーボードまたは画面ボタンから入力できる離散操作。 */
export type DigitalAction = 'forward' | 'backward' | 'left' | 'right' | 'spray';

/** デバイス別の入力を保持する不変の内部状態。 */
export interface ControlState {
  readonly digital: Readonly<Record<DigitalAction, boolean>>;
  readonly touchStick: readonly [number, number] | null;
}

/** 車両制御と放水処理が共通で読む正規化済みの入力値。 */
export interface DriveCommand {
  readonly spray: boolean;
  readonly steer: number;
  readonly throttle: number;
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

/** touch stickを-1から1へclampし、dead zone内なら中央へ戻す。 */
export function setTouchStick(state: ControlState, x: number, y: number): ControlState {
  const clampedX = Math.max(-1, Math.min(1, x));
  const clampedY = Math.max(-1, Math.min(1, y));
  const touchStick: readonly [number, number] = Math.hypot(clampedX, clampedY) < TOUCH_STICK_DEAD_ZONE
    ? [0, 0]
    : [clampedX, clampedY];
  return { ...state, touchStick };
}

/** device固有状態を車両が読む共通commandへ変換する。 */
export function toDriveCommand(state: ControlState): DriveCommand {
  const digitalSteer = Number(state.digital.right) - Number(state.digital.left);
  const digitalThrottle = Number(state.digital.forward) - Number(state.digital.backward);
  const touchThrottle = state.touchStick ? -state.touchStick[1] : null;
  return {
    spray: state.digital.spray,
    steer: state.touchStick?.[0] ?? digitalSteer,
    throttle: touchThrottle === null ? digitalThrottle : touchThrottle === 0 ? 0 : touchThrottle,
  };
}

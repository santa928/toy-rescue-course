import type { DriveCommand } from './controlState';
import { VEHICLE_DEFINITIONS, type VehicleId } from '../domain/vehicleDefinitions';

export type GamepadStatus = 'waiting' | 'ready' | 'release' | 'disconnected' | 'unsupported' | 'unavailable';

/** 接続案内と車庫選択だけをReactへ通知する状態。 */
export interface GamepadUiState {
  readonly status: GamepadStatus;
  readonly menuVehicleId: VehicleId | null;
}

/** 毎frameの入力結果。切断時のresetと車種決定は一度だけ通知する。 */
export interface GamepadFrame extends GamepadUiState {
  readonly command: DriveCommand;
  readonly selectVehicleId: VehicleId | null;
  readonly resetAll: boolean;
}

export interface GamepadContext {
  readonly canSwitchVehicle: boolean;
  readonly selectedVehicleId: VehicleId;
}

export const STOP_GAMEPAD_COMMAND: DriveCommand = { moveX: 0, moveY: 0, primaryAction: false };
const DEAD_ZONE = 0.2;
const MENU_THRESHOLD = 0.55;

/** button配列の欠損を解放として扱い、analog buttonの半押しを除く。 */
function pressed(pad: Gamepad, index: number): boolean {
  const button = pad.buttons[index];
  return button?.pressed === true || (button?.value ?? 0) > 0.5;
}

/** 端末固有の未定義配列を推測せず、ブラウザが標準化したpadだけ受理する。 */
function isStandardPad(pad: Gamepad | null): pad is Gamepad {
  return pad !== null && pad.connected && pad.mapping === 'standard'
    && pad.axes.length >= 2 && pad.buttons.length >= 16;
}

/** 非有限軸を停止値へ戻し、異常な範囲外値をclampする。 */
function readAxis(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

/** 左stickと十字を画面方向へ変換し、半径deadzoneと斜め速度上限を適用する。 */
export function readGamepadInput(pad: Gamepad): { command: DriveCommand; neutral: boolean; menu: boolean; back: boolean } {
  let moveX = readAxis(pad.axes[0]);
  let moveY = -readAxis(pad.axes[1]);
  const stickLength = Math.hypot(moveX, moveY);
  if (stickLength <= DEAD_ZONE) {
    moveX = 0;
    moveY = 0;
  } else {
    const magnitude = (Math.min(1, stickLength) - DEAD_ZONE) / (1 - DEAD_ZONE);
    moveX = moveX / stickLength * magnitude;
    moveY = moveY / stickLength * magnitude;
  }
  if ([12, 13, 14, 15].some((index) => pressed(pad, index))) {
    moveX = Number(pressed(pad, 15)) - Number(pressed(pad, 14));
    moveY = Number(pressed(pad, 12)) - Number(pressed(pad, 13));
    const length = Math.hypot(moveX, moveY);
    if (length > 1) { moveX /= length; moveY /= length; }
  }
  return {
    command: { moveX, moveY: moveY || 0, primaryAction: pressed(pad, 0) },
    neutral: stickLength <= DEAD_ZONE && !pad.buttons.some((_, index) => pressed(pad, index)),
    menu: pressed(pad, 9),
    back: pressed(pad, 1),
  };
}

/** 単一padの安全な再開と車庫menuのedgeを、DOMに依存せず管理する。 */
export class GamepadSession {
  private activePad: { index: number; id: string } | null = null;
  private seenPad = false;
  private armed = false;
  private menuVehicleId: VehicleId | null = null;
  private previous = { primaryAction: false, menu: false, back: false, direction: 0 };

  /** reset後は左stickと全buttonを離すまで運転・決定を受け付けない。 */
  public reset(): void {
    this.armed = false;
    this.menuVehicleId = null;
    this.previous = { primaryAction: false, menu: false, back: false, direction: 0 };
  }

  /** 最新pad配列から一frameを処理する。再接続では古い保持入力を引き継がない。 */
  public update(pads: readonly (Gamepad | null)[], context: GamepadContext): GamepadFrame {
    const frame: GamepadFrame = {
      command: STOP_GAMEPAD_COMMAND, status: 'waiting', menuVehicleId: null, selectVehicleId: null, resetAll: false,
    };
    let pad: Gamepad | undefined;
    const activePad = this.activePad;
    if (activePad) {
      pad = pads.find((candidate): candidate is Gamepad => isStandardPad(candidate)
        && candidate.index === activePad.index && candidate.id === activePad.id);
      if (!pad) {
        this.activePad = null;
        this.reset();
        return { ...frame, status: 'disconnected', resetAll: true };
      }
    } else {
      pad = pads.find(isStandardPad);
      if (!pad) {
        return { ...frame, status: pads.some((candidate) => candidate?.connected)
          ? 'unsupported' : this.seenPad ? 'disconnected' : 'waiting' };
      }
      this.activePad = { id: pad.id, index: pad.index };
      this.seenPad = true;
      this.reset();
    }
    const input = readGamepadInput(pad);
    if (!this.armed) {
      this.armed = input.neutral;
      return { ...frame, status: this.armed ? 'ready' : 'release' };
    }
    if (this.menuVehicleId && !context.canSwitchVehicle) {
      this.reset();
      return { ...frame, status: 'release' };
    }
    const direction = Math.abs(input.command.moveX) >= MENU_THRESHOLD ? Math.sign(input.command.moveX)
      : Math.abs(input.command.moveY) >= MENU_THRESHOLD ? -Math.sign(input.command.moveY) : 0;
    const menuPressed = input.menu && !this.previous.menu;
    const confirmPressed = input.command.primaryAction && !this.previous.primaryAction;
    const backPressed = input.back && !this.previous.back;
    const previousDirection = this.previous.direction;
    // 候補送りの境界で揺れても、中央まで戻す前に再発火させない。
    const centered = input.command.moveX === 0 && input.command.moveY === 0;
    this.previous = {
      primaryAction: input.command.primaryAction, menu: input.menu, back: input.back,
      direction: centered ? 0 : previousDirection || direction,
    };

    if (this.menuVehicleId) {
      if (menuPressed || backPressed) {
        this.reset();
        return { ...frame, status: 'release' };
      }
      if (direction && !previousDirection) {
        const index = VEHICLE_DEFINITIONS.findIndex(({ id }) => id === this.menuVehicleId);
        this.menuVehicleId = VEHICLE_DEFINITIONS[(index + direction + VEHICLE_DEFINITIONS.length) % VEHICLE_DEFINITIONS.length]!.id;
      }
      if (confirmPressed) {
        const selectVehicleId = this.menuVehicleId;
        this.reset();
        return { ...frame, status: 'release', selectVehicleId };
      }
      return { ...frame, status: 'ready', menuVehicleId: this.menuVehicleId };
    }
    if (menuPressed && context.canSwitchVehicle) {
      this.menuVehicleId = context.selectedVehicleId;
      return { ...frame, status: 'ready', menuVehicleId: this.menuVehicleId };
    }
    return { ...frame, status: 'ready', command: input.command };
  }
}

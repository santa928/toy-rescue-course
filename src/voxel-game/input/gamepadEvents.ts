import type { VoxelGameControlEventTarget } from './useVoxelGameControls';
import { GamepadSession, STOP_GAMEPAD_COMMAND, type GamepadContext, type GamepadFrame } from './gamepadControls';

export interface GamepadEventBindings {
  readonly keyboardTarget: VoxelGameControlEventTarget;
  readonly visibilityTarget: VoxelGameControlEventTarget;
  readonly isActive: () => boolean;
  readonly readGamepads: () => readonly (Gamepad | null)[];
  readonly getContext: () => GamepadContext;
  readonly requestFrame: (callback: FrameRequestCallback) => number;
  readonly cancelFrame: (id: number) => void;
  readonly onFrame: (frame: GamepadFrame) => void;
  readonly onReset: () => void;
  readonly onSelectVehicle: (vehicleId: NonNullable<GamepadFrame['selectVehicleId']>) => void;
  readonly subscribeReset: (listener: () => void) => () => void;
}

/** ブラウザframe/eventへpad入力を結び、安全停止とcleanupを保証する。 */
export function bindGamepadEvents(bindings: GamepadEventBindings): () => void {
  const session = new GamepadSession();
  let frameId: number | null = null;
  let disposed = false;
  let latest: GamepadFrame = {
    command: STOP_GAMEPAD_COMMAND, status: 'waiting', menuVehicleId: null, selectVehicleId: null, resetAll: false,
  };
  /** 入力とUIのsnapshotを同じframeに通知する。 */
  const emit = (frame: GamepadFrame): void => {
    latest = frame;
    bindings.onFrame(frame);
  };
  /** 既存control resetに追従し、padの長押しを復活させない。 */
  const resetSession = (): void => {
    session.reset();
    emit({ ...latest, command: STOP_GAMEPAD_COMMAND, menuVehicleId: null, selectVehicleId: null,
      resetAll: false, status: latest.status === 'ready' ? 'release' : latest.status });
  };
  const unsubscribe = bindings.subscribeReset(resetSession);
  /** blur/hidden/pagehideでRAFを止め、touch/keyboardを含めて停止する。 */
  const suspend = (): void => {
    if (frameId !== null) bindings.cancelFrame(frameId);
    frameId = null;
    session.reset();
    bindings.onReset();
  };
  /** activeな間だけ新しいpad snapshotを取得する。 */
  const poll = (): void => {
    frameId = null;
    if (disposed || !bindings.isActive()) { suspend(); return; }
    let next: GamepadFrame;
    try {
      next = session.update(bindings.readGamepads(), bindings.getContext());
    } catch {
      suspend();
      emit({ ...latest, command: STOP_GAMEPAD_COMMAND, status: 'unavailable', menuVehicleId: null, selectVehicleId: null, resetAll: false });
      return;
    }
    if (next.resetAll) bindings.onReset();
    emit(next);
    if (next.selectVehicleId) bindings.onSelectVehicle(next.selectVehicleId);
    frameId = bindings.requestFrame(poll);
  };
  /** 復帰時は新しいneutralを確認してから再開する。 */
  const resume = (): void => {
    if (!disposed && bindings.isActive() && frameId === null) frameId = bindings.requestFrame(poll);
  };
  /** visibilityの復帰と停止を共通経路へ渡す。 */
  const visibilityChanged = (): void => {
    if (bindings.isActive()) resume(); else suspend();
  };
  /** RAFが止まる直前の切断でも入力を即座に解放する。 */
  const disconnected = (): void => {
    bindings.onReset();
  };
  bindings.keyboardTarget.addEventListener('blur', suspend);
  bindings.keyboardTarget.addEventListener('focus', resume);
  bindings.keyboardTarget.addEventListener('pagehide', suspend);
  bindings.keyboardTarget.addEventListener('pageshow', resume);
  bindings.keyboardTarget.addEventListener('gamepaddisconnected', disconnected);
  bindings.visibilityTarget.addEventListener('visibilitychange', visibilityChanged);
  resume();
  return () => {
    disposed = true;
    bindings.keyboardTarget.removeEventListener('blur', suspend);
    bindings.keyboardTarget.removeEventListener('focus', resume);
    bindings.keyboardTarget.removeEventListener('pagehide', suspend);
    bindings.keyboardTarget.removeEventListener('pageshow', resume);
    bindings.keyboardTarget.removeEventListener('gamepaddisconnected', disconnected);
    bindings.visibilityTarget.removeEventListener('visibilitychange', visibilityChanged);
    suspend();
    unsubscribe();
  };
}

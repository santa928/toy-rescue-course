import { describe, expect, it } from 'vitest';
import { GamepadSession, readGamepadInput } from '../voxel-game/input/gamepadControls';
import { createControlState, setDigitalAction, setGamepadCommand, setPointerPrimaryAction, setTouchStick, toDriveCommand } from '../voxel-game/input/controlState';

/** ブラウザが公開する標準配列形式で仮想padのsnapshotを作る。 */
function pad(axes = [0, 0], pressed: number[] = [], options: Partial<Gamepad> = {}): Gamepad {
  return {
    id: 'virtual-standard', index: 0, mapping: 'standard', connected: true, axes,
    buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index), value: Number(pressed.includes(index)), touched: false })),
    ...options,
  } as Gamepad;
}
const context = { canSwitchVehicle: true, selectedVehicleId: 'fire-truck' as const };
const stop = { moveX: 0, moveY: 0, primaryAction: false };

describe('standard gamepad input', () => {
  it('スティックの上下を既存と同じ画面方向にし、半径deadzoneを0.2にする', () => {
    expect(readGamepadInput(pad([0.12, -0.12])).command).toEqual(stop);
    expect(readGamepadInput(pad([0, -1])).command).toEqual({ ...stop, moveY: 1 });
    const diagonal = readGamepadInput(pad([1, 1])).command;
    expect(Math.hypot(diagonal.moveX, diagonal.moveY)).toBeCloseTo(1);
    expect(diagonal.moveY).toBeLessThan(0);
    expect(readGamepadInput(pad([NaN, Infinity])).command).toEqual(stop);
  });

  it.each([[12, 0, 1], [13, 0, -1], [14, -1, 0], [15, 1, 0]])('十字button %iを画面方向へ変換する', (button, moveX, moveY) => {
    expect(readGamepadInput(pad([0.5, 0.5], [button])).command).toEqual({ moveX, moveY, primaryAction: false });
  });

  it('対向する十字を相殺し、斜め移動を正規化する', () => {
    expect(readGamepadInput(pad([0, 0], [12, 13, 14, 15])).command).toEqual(stop);
    const diagonal = readGamepadInput(pad([0, 0], [12, 15])).command;
    expect(Math.hypot(diagonal.moveX, diagonal.moveY)).toBeCloseTo(1);
  });

  it('下faceだけを長押し道具へ割り当て、他のbuttonは道具にしない', () => {
    expect(readGamepadInput(pad([0, 0], [0])).command.primaryAction).toBe(true);
    expect(readGamepadInput(pad([0, 0], [1, 9])).command.primaryAction).toBe(false);
  });

  it('全buttonを離すまでneutralとはみなさない', () => {
    expect(readGamepadInput(pad()).neutral).toBe(true);
    expect(readGamepadInput(pad([0, 0], [7])).neutral).toBe(false);
  });
});

describe('gamepad session safety and garage', () => {
  it('接続時の押しっぱなしを無視し、neutral後だけ運転を許可する', () => {
    const session = new GamepadSession();
    expect(session.update([pad([1, 0], [0])], context).command).toEqual(stop);
    expect(session.update([pad()], context).status).toBe('ready');
    expect(session.update([pad([1, 0], [0])], context).command).toEqual({ moveX: 1, moveY: 0, primaryAction: true });
    session.reset();
    expect(session.update([pad([1, 0], [0])], context).command).toEqual(stop);
  });

  it('疎配列・切断・index再利用・別padの勝手な引継ぎを安全に扱う', () => {
    const session = new GamepadSession();
    session.update([null, pad([0, 0], [], { index: 1 })], context);
    expect(session.update([null, pad([0, -1], [0], { index: 1 })], context).command.primaryAction).toBe(true);
    const lost = session.update([pad([1, 0], [0])], context);
    expect(lost.command).toEqual(stop);
    expect(lost.resetAll).toBe(true);
    expect(session.update([pad([1, 0], [0])], context).command).toEqual(stop);
    session.update([pad()], context);
    expect(session.update([pad([1, 0])], context).command.moveX).toBe(1);
    expect(session.update([pad([1, 0], [], { id: 'replacement' })], context).command).toEqual(stop);
  });

  it('非standard配列を推測せず、対応padを優先する', () => {
    const session = new GamepadSession();
    expect(session.update([pad([1, 0], [0], { mapping: '' })], context).status).toBe('unsupported');
    expect(session.update([pad([], [], { mapping: '' }), pad([0, 0], [], { index: 1 })], context).status).toBe('ready');
  });

  it('車庫menuはStartの新しい押下で開き、1倒し1車、決定も1回だけ', () => {
    const session = new GamepadSession();
    session.update([pad()], context);
    expect(session.update([pad([0, 0], [9])], context).menuVehicleId).toBe('fire-truck');
    expect(session.update([pad([0, 0], [9])], context).menuVehicleId).toBe('fire-truck');
    expect(session.update([pad([1, 0])], context).menuVehicleId).toBe('bulldozer');
    expect(session.update([pad([1, 0])], context).menuVehicleId).toBe('bulldozer');
    session.update([pad()], context);
    expect(session.update([pad([0, 1])], context).menuVehicleId).toBe('excavator');
    const confirm = session.update([pad([0, 0], [0])], context);
    expect(confirm.selectVehicleId).toBe('excavator');
    expect(confirm.command).toEqual(stop);
    expect(session.update([pad([0, 0], [0])], { ...context, selectedVehicleId: 'excavator' }).selectVehicleId).toBe(null);
    expect(session.update([pad([0, 0], [0])], context).command).toEqual(stop);
    session.update([pad()], context);
    expect(session.update([pad([0, 0], [0])], context).command.primaryAction).toBe(true);
  });

  it('候補送りの閾値付近で揺れても、中央へ戻すまでは次へ送らない', () => {
    const session = new GamepadSession();
    session.update([pad()], context);
    session.update([pad([0, 0], [9])], context);
    for (const x of [0.641, 0.639, 0.641, 0.639, 0.641]) {
      expect(session.update([pad([x, 0])], context).menuVehicleId).toBe('bulldozer');
    }
    session.update([pad()], context);
    expect(session.update([pad([1, 0])], context).menuVehicleId).toBe('excavator');
  });

  it('既に道具を押したままmenuを開いても決定せず、右faceで安全に戻れる', () => {
    const session = new GamepadSession();
    session.update([pad()], context);
    session.update([pad([0, 0], [0])], context);
    expect(session.update([pad([0, 0], [0, 9])], context).selectVehicleId).toBe(null);
    expect(session.update([pad([0, 0], [0])], context).command).toEqual(stop);
    expect(session.update([pad([0, 0], [1])], context).menuVehicleId).toBe(null);
    expect(session.update([pad([1, 0], [1])], context).command).toEqual(stop);
  });

  it('車庫を離れたらmenuを閉じ、車庫外ではStartが道具や車選びにならない', () => {
    const session = new GamepadSession();
    session.update([pad()], context);
    session.update([pad([0, 0], [9])], context);
    const away = { ...context, canSwitchVehicle: false };
    expect(session.update([pad([1, 0])], away).menuVehicleId).toBe(null);
    expect(session.update([pad([1, 0])], away).command).toEqual(stop);
    session.update([pad()], away);
    expect(session.update([pad([0, 0], [9])], away).menuVehicleId).toBe(null);
  });
});

describe('input source composition', () => {
  it('gamepadを解放してもkeyboard/pointerを消さず、touchとkeyboardの運転を優先する', () => {
    let state = setGamepadCommand(createControlState(), { moveX: 1, moveY: 0, primaryAction: true });
    expect(toDriveCommand(state).moveX).toBe(1);
    state = setDigitalAction(state, 'forward', true);
    expect(toDriveCommand(state).moveY).toBe(1);
    state = setTouchStick(state, -1, 0);
    expect(toDriveCommand(state).moveX).toBe(-1);
    state = setPointerPrimaryAction(state, true);
    state = setGamepadCommand(state, stop);
    expect(toDriveCommand(state).primaryAction).toBe(true);
    expect(toDriveCommand(createControlState())).toEqual(stop);
  });
});

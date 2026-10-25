import { useEffect, useRef, useState } from 'react';
import { bindGamepadEvents } from './gamepadEvents';
import type { GamepadContext, GamepadUiState } from './gamepadControls';
import type { VoxelGameControls } from './useVoxelGameControls';
import type { VehicleId } from '../domain/vehicleDefinitions';

/** padの接続監視をHUDの車庫条件と既存入力sourceへつなぐ。 */
export function useGamepadControls(
  controls: VoxelGameControls,
  context: GamepadContext,
  onSelectVehicle: (vehicleId: VehicleId) => void,
): GamepadUiState {
  const contextRef = useRef(context);
  const selectRef = useRef(onSelectVehicle);
  contextRef.current = context;
  selectRef.current = onSelectVehicle;
  const [state, setState] = useState<GamepadUiState>({ status: 'waiting', menuVehicleId: null });
  const { reset, setGamepadCommand, subscribeReset } = controls;
  useEffect(() => bindGamepadEvents({
    keyboardTarget: window,
    visibilityTarget: document,
    isActive: () => document.visibilityState !== 'hidden' && document.hasFocus(),
    readGamepads: () => {
      if (typeof navigator.getGamepads !== 'function') throw new Error('Gamepad API unavailable');
      return navigator.getGamepads();
    },
    getContext: () => contextRef.current,
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
    onFrame: (frame) => {
      setGamepadCommand(frame.command);
      setState((previous) => previous.status === frame.status && previous.menuVehicleId === frame.menuVehicleId
        ? previous : { status: frame.status, menuVehicleId: frame.menuVehicleId });
    },
    onReset: reset,
    onSelectVehicle: (vehicleId) => selectRef.current(vehicleId),
    subscribeReset,
  }), [reset, setGamepadCommand, subscribeReset]);
  return state;
}

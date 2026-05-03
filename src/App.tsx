import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Canvas } from '@react-three/fiber';
import { KeyboardControls, type KeyboardControlsEntry } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { Hud } from './components/Hud';
import { VEHICLES, type VehicleId } from './game/data/vehicles';
import { EMPTY_DRIVE_INPUT, setDriveAction, type DriveInput } from './game/input/actions';
import {
  applyColorEffect,
  tickColorEffect,
  type ColorEffect,
  type PaintColor,
} from './game/simulation/colorEffect';
import { ToyRescueScene, type GameTelemetry } from './scene/ToyRescueScene';

const keyboardMap: KeyboardControlsEntry<string>[] = [
  { name: 'forward', keys: ['ArrowUp', 'KeyW'] },
  { name: 'backward', keys: ['ArrowDown', 'KeyS'] },
  { name: 'left', keys: ['ArrowLeft', 'KeyA'] },
  { name: 'right', keys: ['ArrowRight', 'KeyD'] },
];

/**
 * R3F CanvasとDOM HUDを接続するゲームアプリのルート。
 */
export function App(): ReactElement {
  const [selectedVehicleId, setSelectedVehicleId] = useState<VehicleId>('ambulance');
  const [colorEffect, setColorEffect] = useState<ColorEffect | null>(null);
  const [driveInput, setDriveInput] = useState<DriveInput>(EMPTY_DRIVE_INPUT);
  const [resetToken, setResetToken] = useState(0);
  const telemetryRef = useRef<GameTelemetry>({
    vehicleId: selectedVehicleId,
    position: [0, 0, 0],
    activeBlocks: 0,
    colorEffect: null,
  });

  const selectedVehicle = useMemo(
    () => VEHICLES.find((vehicle) => vehicle.id === selectedVehicleId) ?? VEHICLES[0],
    [selectedVehicleId],
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setColorEffect((current) => tickColorEffect(current, 0.1));
    }, 100);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const keyToAction = (code: string): keyof DriveInput | null => {
      if (code === 'ArrowUp' || code === 'KeyW') return 'forward';
      if (code === 'ArrowDown' || code === 'KeyS') return 'backward';
      if (code === 'ArrowLeft' || code === 'KeyA') return 'left';
      if (code === 'ArrowRight' || code === 'KeyD') return 'right';
      return null;
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() === 'f') {
        if (!document.fullscreenElement) {
          void document.documentElement.requestFullscreen();
        } else {
          void document.exitFullscreen();
        }
      }

      const action = keyToAction(event.code);
      if (action) {
        event.preventDefault();
        setDriveInput((current) => setDriveAction(current, action, true));
      }
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      const action = keyToAction(event.code);
      if (action) {
        event.preventDefault();
        setDriveInput((current) => setDriveAction(current, action, false));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    window.render_game_to_text = () =>
      JSON.stringify({
        coordinateSystem: 'R3F world coordinates. x=right, y=up, z=forward/back.',
        ...(window.__toyRescueTelemetry ?? telemetryRef.current),
        colorEffect,
        vehicleId: selectedVehicleId,
        selectedVehicleId,
      });
    window.advanceTime = (milliseconds: number) => {
      window.dispatchEvent(new CustomEvent('toy-rescue-advance-time', { detail: { milliseconds } }));
    };

    return () => {
      delete window.render_game_to_text;
      delete window.advanceTime;
    };
  }, [colorEffect, selectedVehicleId]);

  const handleTelemetry = useCallback(
    (telemetry: GameTelemetry) => {
      telemetryRef.current = {
        ...telemetry,
        vehicleId: selectedVehicleId,
        colorEffect,
      };
    },
    [colorEffect, selectedVehicleId],
  );

  const handlePaint = useCallback((color: PaintColor) => {
    setColorEffect((current) => applyColorEffect(current, color, 5));
  }, []);

  const setActionPressed = useCallback((action: keyof DriveInput, pressed: boolean) => {
    setDriveInput((current) => setDriveAction(current, action, pressed));
  }, []);

  return (
    <main className="app-shell">
      <KeyboardControls map={keyboardMap}>
        <Canvas
          shadows
          camera={{ position: [0, 7.1, 18.2], fov: 60 }}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
        >
          <color attach="background" args={['#e9f1df']} />
          <Physics gravity={[0, -9.81, 0]}>
            <ToyRescueScene
              colorEffect={colorEffect}
              driveInput={driveInput}
              onPaint={handlePaint}
              onTelemetry={handleTelemetry}
              resetToken={resetToken}
              vehicle={selectedVehicle}
            />
          </Physics>
        </Canvas>
      </KeyboardControls>

      <Hud
        colorEffect={colorEffect}
        driveInput={driveInput}
        onReset={() => setResetToken((current) => current + 1)}
        onSelectVehicle={setSelectedVehicleId}
        onSetAction={setActionPressed}
        selectedVehicleId={selectedVehicleId}
        vehicles={VEHICLES}
      />
    </main>
  );
}

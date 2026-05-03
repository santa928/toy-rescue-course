import { Car, Droplets, RotateCcw, ShieldCheck } from 'lucide-react';
import type { CSSProperties, ReactElement } from 'react';
import type { VehicleId, VehicleSpec } from '../game/data/vehicles';
import type { DriveInput } from '../game/input/actions';
import { PAINT_COLORS, type ColorEffect } from '../game/simulation/colorEffect';

interface HudProps {
  readonly colorEffect: ColorEffect | null;
  readonly driveInput: DriveInput;
  readonly onReset: () => void;
  readonly onSelectVehicle: (vehicleId: VehicleId) => void;
  readonly onSetAction: (action: keyof DriveInput, pressed: boolean) => void;
  readonly selectedVehicleId: VehicleId;
  readonly vehicles: readonly VehicleSpec[];
}

const touchActions: Array<{ action: keyof DriveInput; label: string }> = [
  { action: 'forward', label: '↑' },
  { action: 'left', label: '←' },
  { action: 'backward', label: '↓' },
  { action: 'right', label: '→' },
];

/**
 * 3D Canvasの上に重ねる車種選択、状態表示、タッチ操作HUD。
 */
export function Hud({
  colorEffect,
  driveInput,
  onReset,
  onSelectVehicle,
  onSetAction,
  selectedVehicleId,
  vehicles,
}: HudProps): ReactElement {
  return (
    <div className="hud" aria-label="ゲーム操作">
      <section className="vehicle-strip" aria-label="働くくるまを選ぶ">
        {vehicles.map((vehicle) => (
          <button
            className={vehicle.id === selectedVehicleId ? 'vehicle-button is-selected' : 'vehicle-button'}
            key={vehicle.id}
            onClick={() => onSelectVehicle(vehicle.id)}
            style={
              {
                '--vehicle-color': vehicle.baseColor,
                '--vehicle-accent': vehicle.accentColor,
              } as CSSProperties
            }
            type="button"
          >
            <Car aria-hidden="true" size={18} strokeWidth={2.4} />
            <span>{vehicle.label}</span>
          </button>
        ))}
      </section>

      <section className="status-strip" aria-label="状態">
        <div className="status-pill">
          {colorEffect ? (
            <>
              <Droplets aria-hidden="true" size={18} />
              <span
                className="paint-dot"
                style={{ backgroundColor: PAINT_COLORS[colorEffect.color] }}
                aria-hidden="true"
              />
              <span>{colorEffect.remainingSeconds.toFixed(1)}秒</span>
            </>
          ) : (
            <>
              <ShieldCheck aria-hidden="true" size={18} />
              <span>いつもの色</span>
            </>
          )}
        </div>
        <button className="icon-button" onClick={onReset} type="button" aria-label="車と積み木を戻す">
          <RotateCcw aria-hidden="true" size={20} />
        </button>
      </section>

      <section className="touch-pad" aria-label="タッチ操作">
        {touchActions.map(({ action, label }) => (
          <button
            aria-pressed={driveInput[action]}
            className={driveInput[action] ? 'touch-button is-pressed' : 'touch-button'}
            key={action}
            onPointerDown={() => onSetAction(action, true)}
            onPointerLeave={() => onSetAction(action, false)}
            onPointerUp={() => onSetAction(action, false)}
            type="button"
          >
            {label}
          </button>
        ))}
      </section>
    </div>
  );
}

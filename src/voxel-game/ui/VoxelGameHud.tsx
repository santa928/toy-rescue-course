import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type { VehicleMissionSnapshot } from '../domain/VehicleMissionCoordinator';
import {
  getVehicleDefinition,
  VEHICLE_DEFINITIONS,
  type VehicleId,
} from '../domain/vehicleDefinitions';
import type { VoxelGameControls } from '../input/useVoxelGameControls';
import { TouchJoystick } from './TouchJoystick';

interface VoxelGameHudProps {
  readonly canSwitchVehicle: boolean;
  readonly controls: VoxelGameControls;
  readonly fullscreen: boolean;
  readonly fullscreenAvailable: boolean;
  readonly mission: VehicleMissionSnapshot;
  readonly onSelectVehicle: (vehicleId: VehicleId) => void;
  readonly onToggleFullscreen: () => void;
  readonly selectedVehicleId: VehicleId;
}

/** 車両選択、仕事、運転、主操作、fullscreenをsafe-areaへ固定する玩具操作HUD。 */
export function VoxelGameHud({
  canSwitchVehicle,
  controls,
  fullscreen,
  fullscreenAvailable,
  mission,
  onSelectVehicle,
  onToggleFullscreen,
  selectedVehicleId,
}: VoxelGameHudProps): ReactElement {
  const vehicleDefinition = getVehicleDefinition(selectedVehicleId);
  const activeActionPointerRef = useRef<number | null>(null);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const { primaryActionPressed, setPrimaryAction } = controls;

  /** active pointerとHUD同期済みの主操作commandを一括解除する。 */
  const releasePrimaryAction = useCallback((releaseCapture = true): void => {
    const pointerId = activeActionPointerRef.current;
    activeActionPointerRef.current = null;
    setPrimaryAction(false);
    const button = actionButtonRef.current;
    if (!releaseCapture || pointerId === null || !button?.hasPointerCapture(pointerId)) return;
    try {
      button.releasePointerCapture(pointerId);
    } catch {
      // browserがcaptureを先に失っていてもcommand/aria解除は上で完了している。
    }
  }, [setPrimaryAction]);

  /** 最初のpointerだけをcaptureし、HUD同期済みの主操作commandを押下へする。 */
  const handlePrimaryActionPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (activeActionPointerRef.current !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    activeActionPointerRef.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // capture非対応時もpointer終端とblur cleanupで解除する。
    }
    setPrimaryAction(true);
  }, [setPrimaryAction]);

  /** active pointerのup/cancelだけを終了する。 */
  const handlePrimaryActionPointerEnd = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (activeActionPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    releasePrimaryAction(true);
  }, [releasePrimaryAction]);

  /** pointer capture喪失でもcommandとariaを解除する。 */
  const handlePrimaryActionLostPointerCapture = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (activeActionPointerRef.current !== event.pointerId) return;
    releasePrimaryAction(false);
  }, [releasePrimaryAction]);

  useEffect(() => {
    /** blur/hiddenでlocal pressed stateもcontrolsと同時に解除する。 */
    const releaseOnBlur = (): void => releasePrimaryAction(true);
    const releaseOnVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') releasePrimaryAction(true);
    };
    window.addEventListener('blur', releaseOnBlur);
    document.addEventListener('visibilitychange', releaseOnVisibilityChange);
    return () => {
      window.removeEventListener('blur', releaseOnBlur);
      document.removeEventListener('visibilitychange', releaseOnVisibilityChange);
      releasePrimaryAction(true);
    };
  }, [releasePrimaryAction]);

  const fullscreenLabel = !fullscreenAvailable
    ? '全画面は使えません'
    : fullscreen
      ? '全画面をおわる'
      : '全画面であそぶ';

  return (
    <aside aria-label="働く車の操作パネル" className="voxel-game-hud">
      {canSwitchVehicle ? (
        <nav aria-label="のりものをえらぶ" className="vehicle-selector">
          {VEHICLE_DEFINITIONS.map((definition) => (
            <button
              aria-label={`${definition.label}をえらぶ`}
              aria-pressed={definition.id === selectedVehicleId}
              className="vehicle-selector__button"
              data-vehicle={definition.id}
              key={definition.id}
              onClick={() => onSelectVehicle(definition.id)}
              type="button"
            >
              <span aria-hidden="true" className="vehicle-selector__swatch" />
              <span>{definition.label}</span>
            </button>
          ))}
        </nav>
      ) : null}
      <p
        aria-live="polite"
        className="mission-pill"
        data-phase={mission.phase}
        data-vehicle={selectedVehicleId}
      >
        <span aria-hidden="true" className="mission-pill__vehicle">
          <span />
          <span />
          <span />
        </span>
        <span className="mission-pill__label">{mission.objectiveLabel}</span>
      </p>
      <button
        aria-label={fullscreenLabel}
        aria-pressed={fullscreen}
        className="fullscreen-button"
        disabled={!fullscreenAvailable}
        onClick={onToggleFullscreen}
        type="button"
      >
        <span aria-hidden="true" className="fullscreen-button__glyph" />
        <span>{fullscreenAvailable ? (fullscreen ? 'もどる' : '全画面') : '全画面なし'}</span>
      </button>
      <TouchJoystick controls={controls} />
      <button
        aria-label={vehicleDefinition.action.ariaLabel}
        aria-pressed={primaryActionPressed}
        className="primary-action-button"
        data-pressed={primaryActionPressed}
        data-vehicle={selectedVehicleId}
        onLostPointerCapture={handlePrimaryActionLostPointerCapture}
        onPointerCancel={handlePrimaryActionPointerEnd}
        onPointerDown={handlePrimaryActionPointerDown}
        onPointerUp={handlePrimaryActionPointerEnd}
        ref={actionButtonRef}
        type="button"
      >
        <span aria-hidden="true" className="primary-action-button__glyph">
          <span />
          <span />
          <span />
        </span>
        <span className="primary-action-button__label">{vehicleDefinition.action.label}</span>
      </button>
    </aside>
  );
}

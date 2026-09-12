import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type { VehicleMissionSnapshot } from '../domain/VehicleMissionCoordinator';
import type { VehicleMissionGuidance } from '../domain/missionGuidance';
import type { VehicleColorEffectSnapshot } from '../domain/VehicleColorEffectRuntime';
import type { ToyAudioUiState } from '../audio/useToyAudioFeedback';
import {
  getVehicleDefinition,
  VEHICLE_DEFINITIONS,
  type VehicleId,
} from '../domain/vehicleDefinitions';
import type { VoxelGameControls } from '../input/useVoxelGameControls';
import type { VehicleTelemetryRef } from '../scene/VehicleController';
import { FullscreenDrivePad } from './FullscreenDrivePad';
import { MissionMiniMap } from './MissionMiniMap';
import { VehicleIcon } from './VehicleIcon';
import { isNativeKeyboardEvent } from '../input/keyboardFocus';
import { ActionHoldProgress } from './ActionHoldProgress';
import type { ActionTargetMissionTelemetryRef } from '../scene/ActionTargetMission';

interface VoxelGameHudProps {
  readonly actionHold?: { readonly telemetryRef: ActionTargetMissionTelemetryRef; readonly requiredMilliseconds: number };
  readonly audio: ToyAudioUiState;
  readonly canSwitchVehicle: boolean;
  readonly colorEffect: VehicleColorEffectSnapshot;
  readonly controls: VoxelGameControls;
  readonly fullscreen: boolean;
  readonly fullscreenAvailable: boolean;
  readonly guidance: VehicleMissionGuidance;
  readonly mission: VehicleMissionSnapshot;
  readonly onSelectVehicle: (vehicleId: VehicleId) => void;
  readonly onToggleAudio: () => void;
  readonly onToggleFullscreen: () => void;
  readonly selectedVehicleId: VehicleId;
  readonly telemetryRef: VehicleTelemetryRef;
}

const COLOR_EFFECT_LABELS = {
  blue: 'あお',
  red: 'あか',
  yellow: 'きいろ',
} as const;

/** 車両選択、仕事、運転、主操作、fullscreenをsafe-areaへ固定する玩具操作HUD。 */
export function VoxelGameHud({
  actionHold,
  audio,
  canSwitchVehicle,
  colorEffect,
  controls,
  fullscreen,
  fullscreenAvailable,
  guidance,
  mission,
  onSelectVehicle,
  onToggleAudio,
  onToggleFullscreen,
  selectedVehicleId,
  telemetryRef,
}: VoxelGameHudProps): ReactElement {
  const vehicleDefinition = getVehicleDefinition(selectedVehicleId);
  const activeActionPointerRef = useRef<number | null>(null);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const heldActionKeysRef = useRef(new Set<string>());
  const { primaryActionPressed, setPrimaryAction } = controls;

  /** 道具ボタン自身のSpace/Enterを押している間だけ保持する。 */
  const handleActionKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!['Space', 'Enter'].includes(event.code) || isNativeKeyboardEvent(event.nativeEvent)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    heldActionKeysRef.current.add(event.code);
    setPrimaryAction(true, 'keyboard');
  }, [setPrimaryAction]);

  /** focus移動ではボタン由来のkeyboardだけを解除する。 */
  const releaseActionKeys = useCallback((): void => {
    heldActionKeysRef.current.clear();
    setPrimaryAction(false, 'keyboard');
  }, [setPrimaryAction]);

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
    /** 受理したキーの解放はfocusが変わっても取りこぼさない。 */
    const handleKeyUp = (event: KeyboardEvent): void => {
      if (!heldActionKeysRef.current.delete(event.code)) return;
      event.preventDefault();
      setPrimaryAction(heldActionKeysRef.current.size > 0, 'keyboard');
    };
    window.addEventListener('keyup', handleKeyUp);
    const unsubscribe = controls.subscribeReset(() => {
      releasePrimaryAction(true);
      releaseActionKeys();
    });
    return () => {
      window.removeEventListener('keyup', handleKeyUp);
      unsubscribe();
      releaseActionKeys();
    };
  }, [controls.subscribeReset, releaseActionKeys, releasePrimaryAction, setPrimaryAction]);

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
  const visibleColorId = colorEffect.active && colorEffect.vehicleId === selectedVehicleId
    ? colorEffect.colorId
    : null;
  const colorEffectLabel = visibleColorId === null
    ? null
    : `${COLOR_EFFECT_LABELS[visibleColorId]} ${colorEffect.remainingSeconds}びょう`;
  const missionProgressLabel = `${mission.jobCycle}しゅうめ・${guidance.completionLabel}`;
  const audioLabel = !audio.available
    ? 'おとは使えません'
    : audio.pending
      ? 'おとをきりかえています'
      : audio.enabled
        ? 'おとと振動をオフにする'
        : 'おとと振動をオンにする';
  const visibleAudioLabel = !audio.available
    ? 'おと なし'
    : audio.enabled
      ? 'おと オン'
      : 'おと オフ';

  return (
    <aside
      aria-label="働く車の操作パネル"
      className="voxel-game-hud"
      data-color-effect-active={colorEffectLabel !== null}
      data-vehicle-switch-available={canSwitchVehicle}
    >
      <FullscreenDrivePad controls={controls} />
      <div className="hud-top">
      {canSwitchVehicle ? (
        <nav aria-label="のりものをえらぶ" className="vehicle-selector">
          {VEHICLE_DEFINITIONS.map((definition) => (
            <button
              aria-label={`${definition.label}をえらぶ`}
              aria-pressed={definition.id === selectedVehicleId}
              className="vehicle-selector__button"
              data-vehicle={definition.id}
              key={definition.id}
              onClick={(event) => {
                onSelectVehicle(definition.id);
                if (event.detail > 0) event.currentTarget.blur();
              }}
              type="button"
            >
              <VehicleIcon vehicleId={definition.id} />
              <span>{definition.id === 'fire-truck' ? 'しょうぼう'
                : definition.id === 'ambulance' ? 'きゅうきゅう' : definition.label}</span>
            </button>
          ))}
        </nav>
      ) : null}
      <div className="status-stack">
        <p
          aria-label={`${mission.jobLabel}。${guidance.instructionLabel}。${missionProgressLabel}`}
          aria-live="polite"
          className="mission-pill"
          data-phase={mission.phase}
          data-vehicle={selectedVehicleId}
        >
          <span aria-hidden="true" className="mission-pill__vehicle">
            <VehicleIcon vehicleId={selectedVehicleId} />
          </span>
          <span className="mission-pill__copy">
            <span className="mission-pill__job">{mission.jobLabel}</span>
            <span className="mission-pill__details">
              <span className="mission-pill__objective">{guidance.instructionLabel}</span>
              <span aria-hidden="true" className="mission-pill__progress">
                <span className="mission-stamps">
                  {Array.from({ length: mission.progress.target }, (_, index) => (
                    <span className="mission-stamp" data-complete={index < mission.progress.current} key={index}>
                      {index < mission.progress.current ? '✓' : '○'}
                    </span>
                  ))}
                </span>
                {missionProgressLabel}
              </span>
            </span>
          </span>
        </p>
        {colorEffectLabel === null ? null : (
          <p
            aria-live="polite"
            className="color-effect-pill"
            data-color={visibleColorId}
          >
            <span aria-hidden="true" className="color-effect-pill__swatch" />
            <span>{colorEffectLabel}</span>
          </p>
        )}
      </div>
      <div className="hud-utilities">
      <button
        aria-label={fullscreenLabel}
        aria-pressed={fullscreen}
        className="fullscreen-button"
        disabled={!fullscreenAvailable}
        onClick={(event) => {
          onToggleFullscreen();
          if (event.detail > 0) event.currentTarget.blur();
        }}
        type="button"
      >
        <span aria-hidden="true" className="fullscreen-button__glyph" />
        <span>{fullscreenAvailable ? (fullscreen ? 'もどる' : '全画面') : '全画面なし'}</span>
      </button>
      <button
        aria-busy={audio.pending || undefined}
        aria-disabled={audio.pending || undefined}
        aria-label={audioLabel}
        aria-pressed={audio.enabled}
        className="audio-toggle-button"
        data-enabled={audio.enabled}
        data-state={audio.contextState}
        disabled={!audio.available}
        onClick={(event) => {
          onToggleAudio();
          if (event.detail > 0) event.currentTarget.blur();
        }}
        type="button"
      >
        <span aria-hidden="true" className="audio-toggle-button__glyph">
          <span />
          <span />
          <span />
        </span>
        <span>{visibleAudioLabel}</span>
      </button>
      <MissionMiniMap
        guidance={guidance}
        telemetryRef={telemetryRef}
        vehicleId={selectedVehicleId}
      />
      </div>
      </div>
      <button
        aria-label={vehicleDefinition.action.ariaLabel}
        aria-pressed={primaryActionPressed}
        className="primary-action-button"
        data-primary-action="true"
        data-pressed={primaryActionPressed}
        data-spectacle-action={selectedVehicleId !== 'fire-truck'}
        data-vehicle={selectedVehicleId}
        onBlur={releaseActionKeys}
        onKeyDown={handleActionKeyDown}
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
        <span className="primary-action-button__hint">おしつづける</span>
        {actionHold && <ActionHoldProgress key={selectedVehicleId + mission.jobId} {...actionHold} />}
      </button>
    </aside>
  );
}

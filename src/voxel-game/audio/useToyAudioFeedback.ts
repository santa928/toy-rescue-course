import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type { VehicleMissionCoordinator } from '../domain/VehicleMissionCoordinator';
import type { DriveCommand } from '../input/controlState';
import type { VehicleTelemetry } from '../scene/VehicleController';
import type { ActionTargetMissionTelemetry } from '../scene/ActionTargetMission';
import type { BulldozerMissionTelemetry } from '../scene/BulldozerDebrisMission';
import {
  ToyAudioDirector,
  type ToyAudioTelemetry,
} from './ToyAudioDirector';
import { deriveToyAudioEvents } from './toyAudioEvents';
import { deriveToyTargetActionActive } from './toyAudioMix';
import {
  createBrowserToyAudioBackend,
  isBrowserToyAudioAvailable,
} from './WebAudioToyEngine';

/** HUDへ渡す音と振動toggleの低頻度状態。 */
export interface ToyAudioUiState {
  readonly available: boolean;
  readonly contextState: ToyAudioTelemetry['contextState'];
  readonly enabled: boolean;
  readonly pending: boolean;
}

interface UseToyAudioFeedbackOptions {
  readonly actionTargetMissionTelemetryRef: MutableRefObject<ActionTargetMissionTelemetry>;
  readonly bulldozerMissionTelemetryRef: MutableRefObject<BulldozerMissionTelemetry>;
  readonly commandRef: RefObject<DriveCommand>;
  readonly coordinator: VehicleMissionCoordinator;
  readonly telemetryRef: MutableRefObject<VehicleTelemetry>;
}

interface ToyAudioFeedback {
  readonly audioState: ToyAudioUiState;
  readonly audioTelemetryRef: MutableRefObject<ToyAudioTelemetry>;
  readonly toggleAudio: () => void;
}

/** director telemetryをHUD用の小さなstateへ変換する。 */
function createAudioUiState(
  telemetry: ToyAudioTelemetry,
  pending = false,
): ToyAudioUiState {
  return {
    available: telemetry.available,
    contextState: telemetry.contextState,
    enabled: telemetry.enabled,
    pending,
  };
}

/** 既存refを1 RAFで読み、固定audio graphとmission cueへ接続する。 */
export function useToyAudioFeedback({
  actionTargetMissionTelemetryRef,
  bulldozerMissionTelemetryRef,
  commandRef,
  coordinator,
  telemetryRef,
}: UseToyAudioFeedbackOptions): ToyAudioFeedback {
  const directorRef = useRef<ToyAudioDirector | null>(null);
  if (directorRef.current === null) {
    const available = isBrowserToyAudioAvailable();
    const vibrate = typeof navigator !== 'undefined'
      && navigator.maxTouchPoints > 0
      && typeof navigator.vibrate === 'function'
      ? (pattern: number[]) => navigator.vibrate(pattern)
      : undefined;
    directorRef.current = new ToyAudioDirector({
      available,
      backendFactory: createBrowserToyAudioBackend,
      vibrate,
    });
  }
  const director = directorRef.current;
  const audioTelemetryRef = useRef<ToyAudioTelemetry>(director.getTelemetry());
  const pendingRef = useRef(false);
  const [audioState, setAudioState] = useState<ToyAudioUiState>(
    () => createAudioUiState(director.getTelemetry()),
  );

  /** director状態をtelemetry refと低頻度HUD stateへ同期する。 */
  const syncUiState = useCallback((pending = false): void => {
    const telemetry = director.getTelemetry();
    audioTelemetryRef.current = telemetry;
    setAudioState(createAudioUiState(telemetry, pending));
  }, [director]);

  /** 連打を直列化し、user click内でcontext生成／resumeを開始する。 */
  const toggleAudio = useCallback((): void => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    syncUiState(true);
    const nextEnabled = !director.getTelemetry().enabled;
    void director.setEnabled(nextEnabled).finally(() => {
      pendingRef.current = false;
      syncUiState(false);
    });
  }, [director, syncUiState]);

  useEffect(() => {
    let animationFrame = 0;
    /** 物理telemetryと入力refだけを読み、React stateを更新せずmixを進める。 */
    const updateAudioFrame = (elapsedMilliseconds: number): void => {
      const vehicle = telemetryRef.current;
      const command = commandRef.current;
      const targetActionActive = deriveToyTargetActionActive({
        actionTargetHoldMilliseconds:
          actionTargetMissionTelemetryRef.current.holdMilliseconds,
        bulldozerActiveChipCount: bulldozerMissionTelemetryRef.current.activeChipCount,
        primaryAction: command.primaryAction,
        vehicleId: vehicle.id,
      });
      director.update({
        elapsedSeconds: elapsedMilliseconds / 1_000,
        primaryAction: command.primaryAction,
        speed: vehicle.speed,
        targetActionActive,
        vehicleId: vehicle.id,
      });
      audioTelemetryRef.current = director.getTelemetry();
      animationFrame = window.requestAnimationFrame(updateAudioFrame);
    };
    animationFrame = window.requestAnimationFrame(updateAudioFrame);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      void director.dispose();
    };
  }, [
    actionTargetMissionTelemetryRef,
    bulldozerMissionTelemetryRef,
    commandRef,
    director,
    telemetryRef,
  ]);

  useEffect(() => {
    let previous = coordinator.getSnapshot();
    return coordinator.subscribe((current) => {
      for (const cue of deriveToyAudioEvents(previous, current)) director.playCue(cue);
      previous = current;
      audioTelemetryRef.current = director.getTelemetry();
    });
  }, [coordinator, director]);

  useEffect(() => {
    /** hidden中は停止し、表示復帰時はenabled設定を保ったまま再開する。 */
    const handleVisibilityChange = (): void => {
      void director.setVisible(document.visibilityState === 'visible').finally(() => {
        syncUiState(false);
      });
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [director, syncUiState]);

  return { audioState, audioTelemetryRef, toggleAudio };
}

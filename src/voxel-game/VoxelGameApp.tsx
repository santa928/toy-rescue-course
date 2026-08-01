import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  advanceVehicleMissionManualClock,
  VehicleMissionCoordinator,
  type VehicleMissionCoordinatorSnapshot,
} from './domain/VehicleMissionCoordinator';
import {
  canSwitchVehicle,
  getVehicleDefinition,
  VEHICLE_DEFINITIONS,
  type VehicleId,
  type VehicleSwitchContext,
} from './domain/vehicleDefinitions';
import {
  VehicleColorEffectRuntime,
  type VehicleColorEffectSnapshot,
} from './domain/VehicleColorEffectRuntime';
import { buildMissionJobTelemetry } from './domain/jobTelemetry';
import { resolveSessionJobSeed } from './domain/sessionJobSeed';
import { useVoxelGameControls } from './input/useVoxelGameControls';
import {
  bindFullscreenControls,
  isFullscreenAvailable,
  toggleFullscreen,
} from './input/fullscreenControls';
import {
  syncVehicleMissionSpatialSignals,
  VoxelGameScene,
  type VoxelGameRenderTelemetry,
} from './scene/VoxelGameScene';
import type {
  VehicleControllerHandle,
  VehicleTelemetry,
} from './scene/VehicleController';
import { createInitialVehicleTelemetry } from './scene/VehicleController';
import {
  createBulldozerMissionTelemetry,
  type BulldozerMissionTelemetry,
} from './scene/BulldozerDebrisMission';
import {
  createActionTargetMissionTelemetry,
  type ActionTargetMissionJob,
  type ActionTargetMissionTelemetry,
} from './scene/ActionTargetMission';
import type {
  ActionTargetMissionRuntime,
  ActionTargetMissionSnapshot,
} from './domain/ActionTargetMissionRuntime';
import {
  createFireJobSceneLayout,
  getFireLayerCount,
  isFireHazardEnabled,
  type MissionTelemetry,
} from './scene/WaterAndFire';
import { getActiveFireVoxelCount } from './scene/fireVfx';
import { createWaterFlowFrame } from './scene/waterFlow';
import type { WorldCameraTelemetry } from './scene/WorldFixedCamera';
import {
  BREAKABLE_FRAGMENT_POOL_SLOT_IDS,
  BREAKABLE_FRAGMENT_SLOT_INDICES_BY_BLOCK,
  type BreakablePoolHandle,
  type BreakableTelemetry,
} from './scene/BreakableBlockPlaza';
import { CHIP_POOL_SIZE } from './scene/breakableVfx';
import { PRODUCTION_WORLD_MAP } from './scene/productionWorldMap';
import {
  COLOR_PLAY_POOL_SLOT_COUNT,
  COLOR_PLAY_SHOWER_SLOT_COUNT,
  COLOR_PLAY_STATION_DRAW_CALLS,
  COLOR_PLAY_TOTAL_CUBE_COUNT,
} from './scene/colorPlayVfx';
import { WORLD_SOLID_BOXES } from './scene/worldCollisionLayout';
import {
  BLOCK_PLAZA,
  BREAKABLE_BLOCKS,
  COLOR_PLAY_SOURCES,
  GARAGE_POSITION,
  WORLD_BOUNDS,
  isInsideGarageRestartArea,
  resolveVehicleDistrict,
} from './scene/worldLayout';
import { VoxelGameHud } from './ui/VoxelGameHud';
import { useToyAudioFeedback } from './audio/useToyAudioFeedback';
import { PhysicalGpuProbe } from './performance/PhysicalGpuCertificationProbe';
import { isPhysicalGpuProbeEnabled } from './performance/physicalGpuProbe';

const INITIAL_VEHICLE_ID: VehicleId = 'fire-truck';

/** 車両位置と静的map定義からE2E向けの簡潔なworld状態を返す。 */
export function buildWorldTelemetry(
  vehiclePosition: readonly [number, number, number],
  destinationDistrict: VehicleMissionCoordinatorSnapshot['mission']['destinationDistrict'] = 'fire',
): VoxelGameTextState['world'] {
  return {
    bounds: PRODUCTION_WORLD_MAP.bounds,
    currentDistrict: resolveVehicleDistrict(vehiclePosition),
    destinationDistrict,
    districts: PRODUCTION_WORLD_MAP.districts.map(({ id, label }) => ({ id, label })),
  };
}

/** 車種選択成功時だけ一時色runtimeへ所有車両変更を通知する。 */
export function selectVehicleWithColorEffect(
  coordinator: VehicleMissionCoordinator,
  colorEffectRuntime: VehicleColorEffectRuntime,
  vehicleId: VehicleId,
  context: VehicleSwitchContext,
): boolean {
  const switched = coordinator.selectVehicle(vehicleId, context);
  if (switched) colorEffectRuntime.handleSuccessfulVehicleSwitch(vehicleId);
  return switched;
}

/** 選択中の追加車両へ対応する共通アクション仕事snapshotを返す。 */
function getActionTargetMissionSnapshot(
  snapshot: VehicleMissionCoordinatorSnapshot,
): ActionTargetMissionSnapshot {
  if (snapshot.selectedVehicleId === 'ambulance') return snapshot.ambulance;
  if (snapshot.selectedVehicleId === 'police') return snapshot.police;
  return snapshot.excavator;
}

/** 選択中の追加車両へ対応する共通アクション仕事定義を返す。 */
function getActionTargetMissionJob(
  snapshot: VehicleMissionCoordinatorSnapshot,
): ActionTargetMissionJob {
  if (snapshot.selectedVehicleId === 'ambulance') return snapshot.currentJobs.ambulance;
  if (snapshot.selectedVehicleId === 'police') return snapshot.currentJobs.police;
  return snapshot.currentJobs.excavator;
}

/** 選択中の追加車両へ対応する共通アクションruntimeを返す。 */
function getActionTargetRuntime(
  coordinator: VehicleMissionCoordinator,
  vehicleId: VehicleId,
): ActionTargetMissionRuntime {
  if (vehicleId === 'ambulance') return coordinator.ambulanceRuntime;
  if (vehicleId === 'police') return coordinator.policeRuntime;
  return coordinator.excavatorRuntime;
}

/** 運転可能な箱庭Canvas、入力、段階的な自動検証hookを構成する。 */
export function VoxelGameApp(): ReactElement {
  const controls = useVoxelGameControls();
  const breakablePoolHandleRef = useRef<BreakablePoolHandle>(null);
  const breakableTelemetryRef = useRef<BreakableTelemetry>({
    activeFragments: [],
    activeFragmentCount: 0,
    chipPoolSlotCount: CHIP_POOL_SIZE,
    chips: Array.from({ length: CHIP_POOL_SIZE }, (_, slot) => ({
      active: false,
      position: [0, -40, 0] as const,
      scale: 0,
      slot,
    })),
    blocks: BREAKABLE_BLOCKS.map(({ id }, blockIndex) => ({
      bodyHandles: [],
      colliderHandles: [],
      collisionEnabledFragmentCount: 0,
      fragmentVisibleCount: 0,
      id,
      impactCount: 0,
      intactBodyEnabledCount: 0,
      intactBodyHandle: null,
      intactColliderEnabledCount: 0,
      intactColliderHandle: null,
      intactEnabledCountAtFragmentActivation: null,
      intactVisible: true,
      maxImpactSpeed: 0,
      maxEventRelativeSpeed: 0,
      maxVehiclePreviousStepSpeed: 0,
      meshUuids: [],
      slotIds: (BREAKABLE_FRAGMENT_SLOT_INDICES_BY_BLOCK[blockIndex] ?? []).map(
        (slotIndex) => BREAKABLE_FRAGMENT_POOL_SLOT_IDS[slotIndex] ?? '',
      ),
      vehicleImpactCount: 0,
    })),
    bodyHandles: [],
    colliderHandles: [],
    collisionEnabledFragmentCount: 0,
    enabledBodyCount: 0,
    meshUuids: [],
    mountedBodyCount: 0,
    mountedColliderCount: 0,
    mountedMeshCount: 0,
    poolSlotCount: 0,
    poolSlotIds: BREAKABLE_FRAGMENT_POOL_SLOT_IDS,
    rapierSleepingFragmentCount: 0,
    sleepingFragmentCount: 0,
    uniqueBodyHandleCount: 0,
    uniqueColliderHandleCount: 0,
    uniqueMeshUuidCount: 0,
  });
  const controllerRef = useRef<VehicleControllerHandle>(null);
  const cameraTelemetryRef = useRef<WorldCameraTelemetry>({
    lookTarget: [GARAGE_POSITION[0], GARAGE_POSITION[1] + 0.8, GARAGE_POSITION[2] - 1.5],
    position: [GARAGE_POSITION[0] + 10, GARAGE_POSITION[1] + 12, GARAGE_POSITION[2] + 12],
    viewport: { height: 0, width: 0 },
    zoom: 56,
  });
  const coordinatorRef = useRef<VehicleMissionCoordinator | null>(null);
  if (coordinatorRef.current === null) {
    const entropy = new Uint32Array(1);
    window.crypto.getRandomValues(entropy);
    const { seed } = resolveSessionJobSeed(window.location.search, entropy[0]);
    coordinatorRef.current = new VehicleMissionCoordinator(
      BREAKABLE_BLOCKS.map(({ id }) => id),
      { jobSeed: seed, rotateJobsOnCompletion: true },
    );
  }
  const coordinator = coordinatorRef.current;
  const colorEffectRuntimeRef = useRef<VehicleColorEffectRuntime | null>(null);
  if (colorEffectRuntimeRef.current === null) {
    colorEffectRuntimeRef.current = new VehicleColorEffectRuntime(COLOR_PLAY_SOURCES);
  }
  const colorEffectRuntime = colorEffectRuntimeRef.current;
  const bulldozerMissionSnapshotRef = useRef(coordinator.getSnapshot().bulldozer);
  const bulldozerJobRef = useRef(coordinator.getSnapshot().currentJobs.bulldozer);
  const bulldozerMissionTelemetryRef = useRef<BulldozerMissionTelemetry>(
    createBulldozerMissionTelemetry(),
  );
  const actionTargetMissionSnapshotRef = useRef(coordinator.getSnapshot().excavator);
  const actionTargetMissionTelemetryRef = useRef<ActionTargetMissionTelemetry>(
    createActionTargetMissionTelemetry(),
  );
  const manualClockRef = useRef(false);
  const missionTelemetryRef = useRef<MissionTelemetry>({
    direction: [0, 0, 1],
    distance: Number.POSITIVE_INFINITY,
    nozzleOrigin: [GARAGE_POSITION[0], GARAGE_POSITION[1] + 2.15, GARAGE_POSITION[2] + 1.7],
    sprayActive: false,
    sprayElapsedSeconds: 0,
    sprayOnFire: false,
    splashElapsedSeconds: 0,
    targeted: false,
    waterPath: {
      controlX: GARAGE_POSITION[0],
      controlY: GARAGE_POSITION[1] + 2.15,
      controlZ: GARAGE_POSITION[2] + 4.7,
      endX: GARAGE_POSITION[0],
      endY: GARAGE_POSITION[1] + 2.15,
      endZ: GARAGE_POSITION[2] + 7.7,
      startX: GARAGE_POSITION[0],
      startY: GARAGE_POSITION[1] + 2.15,
      startZ: GARAGE_POSITION[2] + 1.7,
    },
  });
  const renderTelemetryRef = useRef<VoxelGameRenderTelemetry>({
    renderedFrames: 0,
    rendererCalls: 0,
    rendererName: 'unknown',
    rendererVendor: 'unknown',
    vehicleDrawCalls: 0,
  });
  const [coordinatorSnapshot, setCoordinatorSnapshot] = useState<VehicleMissionCoordinatorSnapshot>(
    () => coordinator.getSnapshot(),
  );
  const [colorEffectSnapshot, setColorEffectSnapshot] = useState<VehicleColorEffectSnapshot>(
    () => colorEffectRuntime.getSnapshot(),
  );
  const [vehicleSwitchAvailable, setVehicleSwitchAvailable] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenAvailable = isFullscreenAvailable(document);
  const telemetryRef = useRef<VehicleTelemetry>(
    createInitialVehicleTelemetry(INITIAL_VEHICLE_ID),
  );
  const { audioState, audioTelemetryRef, toggleAudio } = useToyAudioFeedback({
    commandRef: controls.commandRef,
    coordinator,
    telemetryRef,
  });
  const physicalGpuProbeEnabled = isPhysicalGpuProbeEnabled(window.location.search);

  /** 実際の車庫・速度条件を再確認し、成功時だけ車体と入力を選択車両へ同期する。 */
  const handleSelectVehicle = useCallback((vehicleId: VehicleId): boolean => {
    const vehicle = telemetryRef.current;
    const switched = selectVehicleWithColorEffect(coordinator, colorEffectRuntime, vehicleId, {
      atGarage: isInsideGarageRestartArea(vehicle.position),
      speed: vehicle.speed,
    });
    if (!switched) return false;

    controls.reset();
    telemetryRef.current = createInitialVehicleTelemetry(vehicleId);
    const snapshot = coordinator.getSnapshot();
    actionTargetMissionSnapshotRef.current = getActionTargetMissionSnapshot(snapshot);
    bulldozerMissionSnapshotRef.current = snapshot.bulldozer;
    bulldozerJobRef.current = snapshot.currentJobs.bulldozer;
    setCoordinatorSnapshot(snapshot);
    return true;
  }, [colorEffectRuntime, controls.reset, coordinator]);

  /** physics frameから届く切替可否を境界変化時だけReact HUDへ反映する。 */
  const handleVehicleSwitchAvailabilityChange = useCallback((available: boolean): void => {
    setVehicleSwitchAvailable((current) => current === available ? current : available);
  }, []);

  /** click user activation内でfullscreen切替を開始し、拒否はhelper内で安全に吸収する。 */
  const handleToggleFullscreen = useCallback((): void => {
    void toggleFullscreen(document);
  }, []);

  useEffect(() => bindFullscreenControls({
    documentTarget: document,
    keyboardTarget: window,
    onFullscreenChange: setFullscreen,
  }), []);

  useEffect(() => {
    const unsubscribe = coordinator.subscribe((snapshot) => {
      actionTargetMissionSnapshotRef.current = getActionTargetMissionSnapshot(snapshot);
      bulldozerMissionSnapshotRef.current = snapshot.bulldozer;
      bulldozerJobRef.current = snapshot.currentJobs.bulldozer;
      setCoordinatorSnapshot(snapshot);
    });
    const unsubscribeColorEffect = colorEffectRuntime.subscribe((snapshot) => {
      setColorEffectSnapshot(snapshot);
    });
    window.render_game_to_text = () => {
      const coordinatorState = coordinator.getSnapshot();
      const runtime = coordinatorState.fire;
      const currentMission = coordinatorState.mission;
      const currentJob = buildMissionJobTelemetry(coordinatorState);
      const fireJob = coordinatorState.currentJobs.fire;
      const fireSceneLayout = createFireJobSceneLayout(fireJob);
      const command = controls.commandRef.current;
      const missionTelemetry = missionTelemetryRef.current;
      const bulldozerTelemetry = bulldozerMissionTelemetryRef.current;
      const actionTargetTelemetry = actionTargetMissionTelemetryRef.current;
      const ambulanceActionActive = coordinatorState.selectedVehicleId === 'ambulance';
      const excavatorActionActive = coordinatorState.selectedVehicleId === 'excavator';
      const policeActionActive = coordinatorState.selectedVehicleId === 'police';
      const waterFrame = createWaterFlowFrame({
        path: missionTelemetry.waterPath,
        splashElapsedSeconds: missionTelemetry.splashElapsedSeconds,
        sprayActive: missionTelemetry.sprayActive,
        sprayElapsedSeconds: missionTelemetry.sprayElapsedSeconds,
        targeted: missionTelemetry.targeted,
      });
      const vehicle = telemetryRef.current;
      const fireLayerCount = getFireLayerCount(runtime.fireIntensity);
      const vehicleDefinition = getVehicleDefinition(coordinatorState.selectedVehicleId);
      const colorEffect = colorEffectRuntime.getSnapshot();
      const breakables = breakablePoolHandleRef.current?.readActualTelemetry()
        ?? breakableTelemetryRef.current;
      const payload: VoxelGameTextState = {
        audio: { ...audioTelemetryRef.current },
        ambulance: {
          activeParticleCount: ambulanceActionActive
            ? actionTargetTelemetry.activeParticleCount
            : 0,
          completedCount: coordinatorState.ambulance.completedCount,
          contactPoint: ambulanceActionActive
            ? [...actionTargetTelemetry.contactPoint]
            : [0, -40, 0],
          holdMilliseconds: ambulanceActionActive
            ? [...actionTargetTelemetry.holdMilliseconds]
            : [0, 0, 0],
          missionPhase: coordinatorState.ambulance.missionPhase,
          routeMarkerCount: ambulanceActionActive
            ? actionTargetTelemetry.routeMarkerCount
            : 0,
          starVoxelCount: ambulanceActionActive
            ? actionTargetTelemetry.starVoxelCount
            : 0,
          targetAccentVoxelCount: ambulanceActionActive
            ? actionTargetTelemetry.targetAccentVoxelCount
            : 0,
          targetBodyVoxelCount: ambulanceActionActive
            ? actionTargetTelemetry.targetBodyVoxelCount
            : 0,
          targetCount: coordinatorState.ambulance.targetCount,
          targets: coordinatorState.ambulance.targets.map((target) => ({ ...target })),
        },
        blocks: runtime.blocks.map((block) => ({ ...block })),
        bulldozer: {
          activeChipCount: bulldozerTelemetry.activeChipCount,
          bladeCenter: [...bulldozerTelemetry.bladeCenter],
          clearedCount: coordinatorState.bulldozer.clearedCount,
          debris: coordinatorState.bulldozer.debris.map((debris) => ({ ...debris })),
          debrisVisibleVoxelCount: bulldozerTelemetry.debrisVisibleVoxelCount,
          missionPhase: coordinatorState.bulldozer.missionPhase,
          routeMarkerCount: bulldozerTelemetry.routeMarkerCount,
          starVoxelCount: bulldozerTelemetry.starVoxelCount,
          targetCount: coordinatorState.bulldozer.targetCount,
        },
        excavator: {
          activeParticleCount: excavatorActionActive
            ? actionTargetTelemetry.activeParticleCount
            : 0,
          completedCount: coordinatorState.excavator.completedCount,
          contactPoint: excavatorActionActive
            ? [...actionTargetTelemetry.contactPoint]
            : [0, -40, 0],
          holdMilliseconds: excavatorActionActive
            ? [...actionTargetTelemetry.holdMilliseconds]
            : [0, 0, 0],
          missionPhase: coordinatorState.excavator.missionPhase,
          routeMarkerCount: excavatorActionActive
            ? actionTargetTelemetry.routeMarkerCount
            : 0,
          starVoxelCount: excavatorActionActive
            ? actionTargetTelemetry.starVoxelCount
            : 0,
          targetAccentVoxelCount: excavatorActionActive
            ? actionTargetTelemetry.targetAccentVoxelCount
            : 0,
          targetBodyVoxelCount: excavatorActionActive
            ? actionTargetTelemetry.targetBodyVoxelCount
            : 0,
          targetCount: coordinatorState.excavator.targetCount,
          targets: coordinatorState.excavator.targets.map((target) => ({ ...target })),
        },
        police: {
          activeParticleCount: policeActionActive
            ? actionTargetTelemetry.activeParticleCount
            : 0,
          completedCount: coordinatorState.police.completedCount,
          contactPoint: policeActionActive
            ? [...actionTargetTelemetry.contactPoint]
            : [0, -40, 0],
          holdMilliseconds: policeActionActive
            ? [...actionTargetTelemetry.holdMilliseconds]
            : [0, 0, 0],
          missionPhase: coordinatorState.police.missionPhase,
          routeMarkerCount: policeActionActive
            ? actionTargetTelemetry.routeMarkerCount
            : 0,
          starVoxelCount: policeActionActive
            ? actionTargetTelemetry.starVoxelCount
            : 0,
          targetAccentVoxelCount: policeActionActive
            ? actionTargetTelemetry.targetAccentVoxelCount
            : 0,
          targetBodyVoxelCount: policeActionActive
            ? actionTargetTelemetry.targetBodyVoxelCount
            : 0,
          targetCount: coordinatorState.police.targetCount,
          targets: coordinatorState.police.targets.map((target) => ({ ...target })),
        },
        coordinateSystem: 'origin=world-center, +x=east, +y=up, +z=south',
        colorEffect,
        controls: { ...command },
        fire: {
          intensity: runtime.fireIntensity,
          position: [...fireSceneLayout.firePosition],
          targeted: missionTelemetry.targeted,
        },
        landmarks: {
          breakableBlocks: BREAKABLE_BLOCKS.map(({ id, position }) => ({ id, position })),
          blockPlaza: BLOCK_PLAZA,
          bulldozerDebris: coordinatorState.currentJobs.bulldozer.debris.map(
            ({ id, position, radius }) => ({ id, position, radius }),
          ),
          ambulanceTargets: coordinatorState.currentJobs.ambulance.targets.map(
            ({ id, position, radius }) => ({ id, position, radius }),
          ),
          excavatorTargets: coordinatorState.currentJobs.excavator.targets.map(
            ({ id, position, radius }) => ({ id, position, radius }),
          ),
          policeTargets: coordinatorState.currentJobs.police.targets.map(
            ({ id, position, radius }) => ({ id, position, radius }),
          ),
          colorPlaySources: COLOR_PLAY_SOURCES.map((source) => ({
            ...source,
            position: [...source.position],
            triggerBounds: { ...source.triggerBounds },
          })),
          construction: PRODUCTION_WORLD_MAP.landmarks.construction,
          fire: fireSceneLayout.firePosition,
          fireSprayTarget: fireJob.sprayTarget,
          garage: GARAGE_POSITION,
          town: PRODUCTION_WORLD_MAP.landmarks.town,
        },
        mode: 'drive-ready',
        renderer: { ...renderTelemetryRef.current },
        camera: {
          ...cameraTelemetryRef.current,
          lookTarget: [...cameraTelemetryRef.current.lookTarget],
          position: [...cameraTelemetryRef.current.position],
          viewport: { ...cameraTelemetryRef.current.viewport },
        },
        breakables,
        mission: {
          ...missionTelemetry,
          destinationDistrict: currentMission.destinationDistrict,
          direction: [...missionTelemetry.direction],
          id: currentMission.id,
          ...currentJob,
          nozzleOrigin: [...missionTelemetry.nozzleOrigin],
          objectiveLabel: currentMission.objectiveLabel,
          phase: currentMission.phase,
          progress: { ...currentMission.progress },
          routeVisible: currentMission.routeVisible,
          vehicleId: currentMission.vehicleId,
          waterPath: {
            control: [
              missionTelemetry.waterPath.controlX,
              missionTelemetry.waterPath.controlY,
              missionTelemetry.waterPath.controlZ,
            ],
            end: [
              missionTelemetry.waterPath.endX,
              missionTelemetry.waterPath.endY,
              missionTelemetry.waterPath.endZ,
            ],
            start: [
              missionTelemetry.waterPath.startX,
              missionTelemetry.waterPath.startY,
              missionTelemetry.waterPath.startZ,
            ],
          },
        },
        runtime,
        vehicle: {
          ...vehicle,
          forward: [...vehicle.forward],
          position: [...vehicle.position],
        },
        visualLayout: {
          fireHazard: fireSceneLayout.hazardBox,
          fireLayers: fireSceneLayout.layerBoxes,
          routeMarkers: fireSceneLayout.routeBoxes,
          starGroups: fireSceneLayout.starGroups,
          vehicleBounds: vehicleDefinition.visualBounds,
          worldSolids: WORLD_SOLID_BOXES.map(({ id, position, rotation, scale }) => ({
            id,
            position,
            rotation,
            scale,
          })),
        },
        visuals: {
          colorPoolCubeCount: COLOR_PLAY_POOL_SLOT_COUNT * 3,
          colorShowerCubeCount: COLOR_PLAY_SHOWER_SLOT_COUNT * 3,
          colorStationCubeCount: COLOR_PLAY_TOTAL_CUBE_COUNT,
          colorStationDrawCalls: COLOR_PLAY_STATION_DRAW_CALLS,
          fireHazardEnabled: isFireHazardEnabled(runtime.fireIntensity),
          fireLayerCount,
          fireVoxelCount: getActiveFireVoxelCount(fireLayerCount),
          bulldozerChipCubeCount: bulldozerTelemetry.activeChipCount,
          bulldozerDebrisCubeCount: bulldozerTelemetry.debrisVisibleVoxelCount,
          actionTargetParticleCubeCount: actionTargetTelemetry.activeParticleCount,
          actionTargetTargetCubeCount: actionTargetTelemetry.targetBodyVoxelCount
            + actionTargetTelemetry.targetAccentVoxelCount,
          routeCubeCount: coordinatorState.selectedVehicleId === 'fire-truck'
            ? (runtime.routeVisible ? fireSceneLayout.routeBoxes.length : 0)
            : coordinatorState.selectedVehicleId === 'bulldozer'
              ? bulldozerTelemetry.routeMarkerCount
              : actionTargetTelemetry.routeMarkerCount,
          starCubeCount: coordinatorState.selectedVehicleId === 'fire-truck'
            ? (runtime.missionPhase === 'celebrating' ? 30 : 0)
            : coordinatorState.selectedVehicleId === 'bulldozer'
              ? bulldozerTelemetry.starVoxelCount
              : actionTargetTelemetry.starVoxelCount,
          waterCubeCount: waterFrame.instances.filter(({ active }) => active).length,
          waterInstances: waterFrame.instances.map(({ active, kind, position, scale, slot }) => ({
            active,
            kind,
            position: [...position] as [number, number, number],
            scale,
            slot,
          })),
          intactBlockCount: breakables.blocks.filter(({ intactVisible }) => intactVisible).length,
          fragmentVisibleCount: breakables.activeFragmentCount,
          fragmentCollisionEnabledCount: breakables.collisionEnabledFragmentCount,
          fragmentPoolSlotCount: breakables.poolSlotCount,
        },
        vehicleSelection: {
          available: VEHICLE_DEFINITIONS.map(({ id }) => id),
          canSwitch: canSwitchVehicle({
            atGarage: isInsideGarageRestartArea(vehicle.position),
            speed: vehicle.speed,
          }),
          selected: coordinatorState.selectedVehicleId,
        },
        world: buildWorldTelemetry(vehicle.position, currentMission.destinationDistrict),
        worldBounds: WORLD_BOUNDS,
      };
      return JSON.stringify(payload);
    };
    window.reset_voxel_game_vehicle = () => controllerRef.current?.resetVehicle();
    window.select_voxel_game_vehicle = handleSelectVehicle;
    window.advanceTime = (milliseconds: number) => {
      colorEffectRuntime.syncVehiclePosition(
        coordinator.getSnapshot().selectedVehicleId,
        telemetryRef.current.position,
      );
      colorEffectRuntime.advance(milliseconds);
      advanceVehicleMissionManualClock(
        coordinator,
        manualClockRef,
        milliseconds,
        () => syncVehicleMissionSpatialSignals(coordinator, telemetryRef.current.position),
      );
      breakablePoolHandleRef.current?.syncAfterRuntimeAdvance();
    };

    return () => {
      unsubscribe();
      unsubscribeColorEffect();
      delete window.render_game_to_text;
      delete window.reset_voxel_game_vehicle;
      delete window.select_voxel_game_vehicle;
      delete window.advanceTime;
    };
  }, [colorEffectRuntime, controls.commandRef, coordinator, handleSelectVehicle]);

  return (
    <main className="voxel-game-shell">
      <section className="voxel-game-canvas" aria-label="純ボクセル働く車の箱庭">
        <Canvas dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: 'high-performance' }}>
          <VoxelGameScene
            actionTargetJob={getActionTargetMissionJob(coordinatorSnapshot)}
            actionTargetMissionSnapshotRef={actionTargetMissionSnapshotRef}
            actionTargetMissionTelemetryRef={actionTargetMissionTelemetryRef}
            actionTargetRuntime={getActionTargetRuntime(
              coordinator,
              coordinatorSnapshot.selectedVehicleId,
            )}
            breakablePoolHandleRef={breakablePoolHandleRef}
            breakableTelemetryRef={breakableTelemetryRef}
            bulldozerJobRef={bulldozerJobRef}
            bulldozerMissionSnapshotRef={bulldozerMissionSnapshotRef}
            bulldozerMissionTelemetryRef={bulldozerMissionTelemetryRef}
            cameraTelemetryRef={cameraTelemetryRef}
            commandRef={controls.commandRef}
            colorEffectRuntime={colorEffectRuntime}
            coordinator={coordinator}
            controllerRef={controllerRef}
            fireJob={coordinatorSnapshot.currentJobs.fire}
            manualClockRef={manualClockRef}
            missionTelemetryRef={missionTelemetryRef}
            onVehicleSwitchAvailabilityChange={handleVehicleSwitchAvailabilityChange}
            paintColor={colorEffectSnapshot.active
              && colorEffectSnapshot.vehicleId === coordinatorSnapshot.selectedVehicleId
              ? colorEffectSnapshot.colorHex
              : null}
            renderTelemetryRef={renderTelemetryRef}
            telemetryRef={telemetryRef}
            vehicleId={coordinatorSnapshot.selectedVehicleId}
          />
        </Canvas>
      </section>
      <VoxelGameHud
        audio={audioState}
        canSwitchVehicle={vehicleSwitchAvailable}
        colorEffect={colorEffectSnapshot}
        controls={controls}
        fullscreen={fullscreen}
        fullscreenAvailable={fullscreenAvailable}
        mission={coordinatorSnapshot.mission}
        onSelectVehicle={handleSelectVehicle}
        onToggleAudio={toggleAudio}
        onToggleFullscreen={handleToggleFullscreen}
        selectedVehicleId={coordinatorSnapshot.selectedVehicleId}
      />
      <PhysicalGpuProbe
        enabled={physicalGpuProbeEnabled}
        renderTelemetryRef={renderTelemetryRef}
      />
    </main>
  );
}

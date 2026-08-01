import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  advanceManualClock,
  VoxelGameRuntime,
} from './domain/VoxelGameRuntime';
import {
  getVehicleDefinition,
  type VehicleId,
} from './domain/vehicleDefinitions';
import { useVoxelGameControls } from './input/useVoxelGameControls';
import {
  bindFullscreenControls,
  isFullscreenAvailable,
  toggleFullscreen,
} from './input/fullscreenControls';
import {
  syncRuntimeSpatialSignals,
  VoxelGameScene,
  type VoxelGameRenderTelemetry,
} from './scene/VoxelGameScene';
import type {
  VehicleControllerHandle,
  VehicleTelemetry,
} from './scene/VehicleController';
import { createInitialVehicleTelemetry } from './scene/VehicleController';
import {
  CELEBRATION_STAR_GROUPS,
  FIRE_HAZARD_BOX,
  FIRE_LAYER_BOXES,
  ROUTE_BOXES,
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
import { WORLD_SOLID_BOXES } from './scene/worldCollisionLayout';
import {
  BLOCK_PLAZA,
  BREAKABLE_BLOCKS,
  FIRE_POSITION,
  FIRE_SPRAY_TARGET_POSITION,
  GARAGE_POSITION,
  WORLD_BOUNDS,
  resolveVehicleDistrict,
} from './scene/worldLayout';
import { VoxelGameHud } from './ui/VoxelGameHud';

const INITIAL_VEHICLE_ID: VehicleId = 'fire-truck';
const VEHICLE_VISUAL_BOUNDS = getVehicleDefinition(INITIAL_VEHICLE_ID).visualBounds;

/** 車両位置と静的map定義からE2E向けの簡潔なworld状態を返す。 */
export function buildWorldTelemetry(
  vehiclePosition: readonly [number, number, number],
): VoxelGameTextState['world'] {
  return {
    bounds: PRODUCTION_WORLD_MAP.bounds,
    currentDistrict: resolveVehicleDistrict(vehiclePosition),
    destinationDistrict: 'fire',
    districts: PRODUCTION_WORLD_MAP.districts.map(({ id, label }) => ({ id, label })),
  };
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
  const runtimeRef = useRef(new VoxelGameRuntime(BREAKABLE_BLOCKS.map(({ id }) => id)));
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
  });
  const [missionPhase, setMissionPhase] = useState(runtimeRef.current.getSnapshot().missionPhase);
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenAvailable = isFullscreenAvailable(document);
  const telemetryRef = useRef<VehicleTelemetry>(
    createInitialVehicleTelemetry(INITIAL_VEHICLE_ID),
  );

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
    const unsubscribe = runtimeRef.current.subscribe((snapshot) => {
      setMissionPhase((current) => current === snapshot.missionPhase ? current : snapshot.missionPhase);
    });
    window.render_game_to_text = () => {
      const runtime = runtimeRef.current.getSnapshot();
      const command = controls.commandRef.current;
      const missionTelemetry = missionTelemetryRef.current;
      const waterFrame = createWaterFlowFrame({
        path: missionTelemetry.waterPath,
        splashElapsedSeconds: missionTelemetry.splashElapsedSeconds,
        sprayActive: missionTelemetry.sprayActive,
        sprayElapsedSeconds: missionTelemetry.sprayElapsedSeconds,
        targeted: missionTelemetry.targeted,
      });
      const vehicle = telemetryRef.current;
      const fireLayerCount = getFireLayerCount(runtime.fireIntensity);
      const breakables = breakablePoolHandleRef.current?.readActualTelemetry()
        ?? breakableTelemetryRef.current;
      const payload: VoxelGameTextState = {
        blocks: runtime.blocks.map((block) => ({ ...block })),
        coordinateSystem: 'origin=world-center, +x=east, +y=up, +z=south',
        controls: { ...command },
        fire: {
          intensity: runtime.fireIntensity,
          position: [...FIRE_POSITION],
          targeted: missionTelemetry.targeted,
        },
        landmarks: {
          breakableBlocks: BREAKABLE_BLOCKS.map(({ id, position }) => ({ id, position })),
          blockPlaza: BLOCK_PLAZA,
          fire: FIRE_POSITION,
          fireSprayTarget: FIRE_SPRAY_TARGET_POSITION,
          garage: GARAGE_POSITION,
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
          direction: [...missionTelemetry.direction],
          nozzleOrigin: [...missionTelemetry.nozzleOrigin],
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
          phase: runtime.missionPhase,
          routeVisible: runtime.routeVisible,
        },
        runtime,
        vehicle: {
          ...vehicle,
          forward: [...vehicle.forward],
          position: [...vehicle.position],
        },
        visualLayout: {
          fireHazard: FIRE_HAZARD_BOX,
          fireLayers: FIRE_LAYER_BOXES,
          routeMarkers: ROUTE_BOXES,
          starGroups: CELEBRATION_STAR_GROUPS,
          vehicleBounds: VEHICLE_VISUAL_BOUNDS,
          worldSolids: WORLD_SOLID_BOXES.map(({ id, position, rotation, scale }) => ({
            id,
            position,
            rotation,
            scale,
          })),
        },
        visuals: {
          fireHazardEnabled: isFireHazardEnabled(runtime.fireIntensity),
          fireLayerCount,
          fireVoxelCount: getActiveFireVoxelCount(fireLayerCount),
          routeCubeCount: runtime.routeVisible ? ROUTE_BOXES.length : 0,
          starCubeCount: runtime.missionPhase === 'celebrating' ? 30 : 0,
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
        world: buildWorldTelemetry(vehicle.position),
        worldBounds: WORLD_BOUNDS,
      };
      return JSON.stringify(payload);
    };
    window.reset_voxel_game_vehicle = () => controllerRef.current?.resetVehicle();
    window.advanceTime = (milliseconds: number) => {
      advanceManualClock(
        runtimeRef.current,
        manualClockRef,
        milliseconds,
        () => syncRuntimeSpatialSignals(runtimeRef.current, telemetryRef.current.position),
      );
      breakablePoolHandleRef.current?.syncAfterRuntimeAdvance();
    };

    return () => {
      unsubscribe();
      delete window.render_game_to_text;
      delete window.reset_voxel_game_vehicle;
      delete window.advanceTime;
    };
  }, [controls.commandRef]);

  return (
    <main className="voxel-game-shell">
      <section className="voxel-game-canvas" aria-label="純ボクセル消防車の箱庭">
        <Canvas dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: 'high-performance' }}>
          <VoxelGameScene
            breakablePoolHandleRef={breakablePoolHandleRef}
            breakableTelemetryRef={breakableTelemetryRef}
            cameraTelemetryRef={cameraTelemetryRef}
            commandRef={controls.commandRef}
            controllerRef={controllerRef}
            manualClockRef={manualClockRef}
            missionTelemetryRef={missionTelemetryRef}
            renderTelemetryRef={renderTelemetryRef}
            runtime={runtimeRef.current}
            telemetryRef={telemetryRef}
            vehicleId={INITIAL_VEHICLE_ID}
          />
        </Canvas>
      </section>
      <VoxelGameHud
        controls={controls}
        fullscreen={fullscreen}
        fullscreenAvailable={fullscreenAvailable}
        missionPhase={missionPhase}
        onToggleFullscreen={handleToggleFullscreen}
      />
    </main>
  );
}

export {};

declare global {
  /** 自動操作と目視状態を一致させるVoxel Gameの完成版text-state契約。 */
  interface VoxelGameTextState {
    readonly blocks: readonly import('./voxel-game/domain/VoxelGameRuntime').BreakableSnapshot[];
    readonly breakables: import('./voxel-game/scene/BreakableBlockPlaza').BreakableTelemetry;
    readonly bulldozer: {
      readonly activeChipCount: number;
      readonly bladeCenter: readonly [number, number, number];
      readonly clearedCount: number;
      readonly debris: readonly import('./voxel-game/domain/BulldozerMissionRuntime').BulldozerDebrisSnapshot[];
      readonly debrisVisibleVoxelCount: number;
      readonly missionPhase: import('./voxel-game/domain/VoxelGameRuntime').MissionPhase;
      readonly routeMarkerCount: number;
      readonly starVoxelCount: number;
      readonly targetCount: number;
    };
    readonly camera: import('./voxel-game/scene/WorldFixedCamera').WorldCameraTelemetry;
    readonly controls: import('./voxel-game/input/controlState').DriveCommand;
    readonly coordinateSystem: 'origin=world-center, +x=east, +y=up, +z=south';
    readonly fire: {
      readonly intensity: number;
      readonly position: readonly [number, number, number];
      readonly targeted: boolean;
    };
    readonly landmarks: {
      readonly breakableBlocks: readonly {
        readonly id: string;
        readonly position: readonly [number, number, number];
      }[];
      readonly blockPlaza: {
        readonly position: readonly [number, number, number];
        readonly scale: readonly [number, number, number];
      };
      readonly bulldozerDebris: readonly {
        readonly id: string;
        readonly position: readonly [number, number, number];
        readonly radius: number;
      }[];
      readonly fire: readonly [number, number, number];
      readonly fireSprayTarget: readonly [number, number, number];
      readonly garage: readonly [number, number, number];
    };
    readonly mission: import('./voxel-game/domain/VehicleMissionCoordinator').VehicleMissionSnapshot & Omit<
      import('./voxel-game/scene/WaterAndFire').MissionTelemetry,
      'waterPath'
    > & {
      readonly waterPath: {
        readonly control: readonly [number, number, number];
        readonly end: readonly [number, number, number];
        readonly start: readonly [number, number, number];
      };
    };
    readonly mode: 'drive-ready';
    readonly renderer: import('./voxel-game/scene/VoxelGameScene').VoxelGameRenderTelemetry;
    readonly runtime: import('./voxel-game/domain/VoxelGameRuntime').VoxelGameSnapshot;
    readonly vehicle: import('./voxel-game/scene/VehicleController').VehicleTelemetry;
    readonly visualLayout: {
      readonly fireHazard: import('./voxel-game/scene/WaterAndFire').VoxelBox;
      readonly fireLayers: readonly unknown[];
      readonly routeMarkers: readonly import('./voxel-game/scene/WaterAndFire').VoxelBox[];
      readonly starGroups: readonly unknown[];
      readonly vehicleBounds: {
        readonly offset: readonly [number, number, number];
        readonly scale: readonly [number, number, number];
      };
      readonly worldSolids: readonly {
        readonly id: string;
        readonly position: readonly [number, number, number];
        readonly rotation?: readonly [number, number, number];
        readonly scale: readonly [number, number, number];
      }[];
    };
    readonly visuals: {
      readonly bulldozerChipCubeCount: number;
      readonly bulldozerDebrisCubeCount: number;
      readonly fireHazardEnabled: boolean;
      readonly fireLayerCount: number;
      readonly fireVoxelCount: number;
      readonly fragmentCollisionEnabledCount: number;
      readonly fragmentPoolSlotCount: number;
      readonly fragmentVisibleCount: number;
      readonly intactBlockCount: number;
      readonly routeCubeCount: number;
      readonly starCubeCount: number;
      readonly waterCubeCount: number;
      readonly waterInstances: readonly {
        readonly active: boolean;
        readonly kind: 'stream' | 'splash';
        readonly position: readonly [number, number, number];
        readonly scale: number;
        readonly slot: number;
      }[];
    };
    readonly vehicleSelection: {
      readonly available: readonly import('./voxel-game/domain/vehicleDefinitions').VehicleId[];
      readonly canSwitch: boolean;
      readonly selected: import('./voxel-game/domain/vehicleDefinitions').VehicleId;
    };
    readonly worldBounds: {
      readonly maxX: number;
      readonly maxZ: number;
      readonly minX: number;
      readonly minZ: number;
    };
    readonly world: {
      readonly bounds: import('./voxel-game/scene/productionWorldMap').WorldBounds2D;
      readonly currentDistrict:
        import('./voxel-game/scene/productionWorldMap').ResolvedWorldDistrictId;
      readonly destinationDistrict: 'fire' | 'blocks';
      readonly districts: readonly {
        readonly id: import('./voxel-game/scene/productionWorldMap').WorldDistrictId;
        readonly label: string;
      }[];
    };
  }

  interface Window {
    render_game_to_text?: () => string;
    reset_voxel_game_vehicle?: () => void;
    select_voxel_game_vehicle?: (
      vehicleId: import('./voxel-game/domain/vehicleDefinitions').VehicleId,
    ) => boolean;
    advanceTime?: (milliseconds: number) => void;
    render_vehicle_lab_to_text?: () => string;
    set_vehicle_lab_view?: (
      view: import('./vehicle-lab/scene/VehicleShowroom').VehicleLabView,
    ) => void;
    __vehicleLabTelemetry?: {
      cameraPosition: readonly [number, number, number];
      cameraZoom: number;
      renderedFrames: number;
      rendererCalls: number;
      vehicleDrawCalls: number;
      view: import('./vehicle-lab/scene/VehicleShowroom').VehicleLabView;
      voxelCount: number;
    };
  }
}

export {};

declare global {
  /** 自動操作と目視状態を一致させるVoxel Gameの完成版text-state契約。 */
  interface VoxelGameTextState {
    readonly blocks: readonly import('./voxel-game/domain/VoxelGameRuntime').BreakableSnapshot[];
    readonly breakables: import('./voxel-game/scene/BreakableBlockPlaza').BreakableTelemetry;
    readonly camera: import('./voxel-game/scene/WorldFixedCamera').WorldCameraTelemetry;
    readonly controls: import('./voxel-game/input/controlState').DriveCommand;
    readonly coordinateSystem: 'origin=center, +x=right, +y=up, +z=toward-garage';
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
      readonly fire: readonly [number, number, number];
      readonly garage: readonly [number, number, number];
    };
    readonly mission: import('./voxel-game/scene/WaterAndFire').MissionTelemetry & {
      readonly phase: import('./voxel-game/domain/VoxelGameRuntime').MissionPhase;
      readonly routeVisible: boolean;
    };
    readonly mode: 'drive-ready';
    readonly renderer: import('./voxel-game/scene/VoxelGameScene').VoxelGameRenderTelemetry;
    readonly runtime: import('./voxel-game/domain/VoxelGameRuntime').VoxelGameSnapshot;
    readonly vehicle: import('./voxel-game/scene/VehicleController').VehicleTelemetry;
    readonly visualLayout: {
      readonly fireLayers: readonly unknown[];
      readonly starGroups: readonly unknown[];
      readonly vehicleBounds: {
        readonly offset: readonly [number, number, number];
        readonly scale: readonly [number, number, number];
      };
    };
    readonly visuals: {
      readonly fireLayerCount: number;
      readonly fragmentCollisionEnabledCount: number;
      readonly fragmentPoolSlotCount: number;
      readonly fragmentVisibleCount: number;
      readonly intactBlockCount: number;
      readonly routeCubeCount: number;
      readonly starCubeCount: number;
      readonly waterCubeCount: number;
    };
    readonly worldBounds: {
      readonly maxX: number;
      readonly maxZ: number;
      readonly minX: number;
      readonly minZ: number;
    };
  }

  interface Window {
    render_game_to_text?: () => string;
    reset_voxel_game_vehicle?: () => void;
    advanceTime?: (milliseconds: number) => void;
    render_vehicle_lab_to_text?: () => string;
    set_vehicle_lab_view?: (
      view: import('./vehicle-lab/scene/VehicleShowroom').VehicleLabView,
    ) => void;
    __toyRescueTelemetry?: {
      vehicleId: string;
      position: readonly [number, number, number];
      speed?: number;
      activeBlocks: number;
      terrain?: 'table' | 'sand' | 'water' | 'paintPool';
      colorEffect: import('./game/simulation/colorEffect').ColorEffect | null;
    };
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

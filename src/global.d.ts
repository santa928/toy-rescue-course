export {};

declare global {
  interface Window {
    render_game_to_text?: () => string;
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

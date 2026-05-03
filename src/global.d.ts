export {};

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (milliseconds: number) => void;
    __toyRescueTelemetry?: {
      vehicleId: string;
      position: readonly [number, number, number];
      speed?: number;
      activeBlocks: number;
      terrain?: 'table' | 'sand' | 'water' | 'paintPool';
      colorEffect: import('./game/simulation/colorEffect').ColorEffect | null;
    };
  }
}

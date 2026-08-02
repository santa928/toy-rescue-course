/** 自動render前に物理、車体visual、cameraの順序を固定するR3F frame priority。 */
export const WORLD_FRAME_UPDATE_PRIORITIES = Object.freeze({
  camera: -10,
  physics: -100,
  vehicleVisualSync: -50,
});

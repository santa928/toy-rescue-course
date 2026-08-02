/** 車両位置から固定camera位置へ足すworld offset。 */
export const WORLD_CAMERA_OFFSET = [10, 12, 12] as const;

/** 車両位置から固定camera注視点へ足すworld offset。 */
export const WORLD_CAMERA_LOOK_OFFSET = [0, 0.8, -1.5] as const;

/** 平坦な箱庭で車体の上下接触補正を追わないcamera anchor高。 */
export const WORLD_CAMERA_ANCHOR_Y = 0;

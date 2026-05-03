export interface DriveInput {
  readonly forward: boolean;
  readonly backward: boolean;
  readonly left: boolean;
  readonly right: boolean;
}

export const EMPTY_DRIVE_INPUT: DriveInput = {
  forward: false,
  backward: false,
  left: false,
  right: false,
};

/**
 * 指定した操作だけを切り替えた新しい入力状態を返す。
 */
export function setDriveAction(input: DriveInput, action: keyof DriveInput, pressed: boolean): DriveInput {
  return {
    ...input,
    [action]: pressed,
  };
}

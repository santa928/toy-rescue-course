import { describe, expect, it } from 'vitest';
import { createControlState, setDigitalAction, setTouchStick, toDriveCommand } from '../voxel-game/input/controlState';

describe('voxel game controls', () => {
  it('前後と左右を-1から1へ正規化する', () => {
    let state = createControlState();
    state = setDigitalAction(state, 'forward', true);
    state = setDigitalAction(state, 'left', true);

    expect(toDriveCommand(state)).toEqual({ spray: false, steer: -1, throttle: 1 });
  });

  it('touch stickをkeyboardより優先し、dead zone内を0にする', () => {
    const state = setTouchStick(createControlState(), 0.8, -0.6);

    expect(toDriveCommand(state)).toEqual({ spray: false, steer: 0.8, throttle: 0.6 });
    expect(toDriveCommand(setTouchStick(state, 0.05, 0.05))).toEqual({ spray: false, steer: 0, throttle: 0 });
  });

  it('touch stickを入力可能な範囲へclampする', () => {
    const state = setTouchStick(createControlState(), 2, -3);

    expect(toDriveCommand(state)).toEqual({ spray: false, steer: 1, throttle: 1 });
  });
});

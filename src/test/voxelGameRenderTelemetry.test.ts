import { describe, expect, it } from 'vitest';
import { advanceRenderTelemetry } from '../voxel-game/scene/VoxelGameScene';

describe('advanceRenderTelemetry', () => {
  it('実描画frame数を単調増加させ、最新draw call数を保持する', () => {
    expect(advanceRenderTelemetry({ renderedFrames: 9, rendererCalls: 31 }, 34)).toEqual({
      renderedFrames: 10,
      rendererCalls: 34,
    });
  });
});

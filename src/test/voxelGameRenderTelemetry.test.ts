import { describe, expect, it } from 'vitest';
import { buildWorldTelemetry } from '../voxel-game/VoxelGameApp';
import { advanceRenderTelemetry } from '../voxel-game/scene/VoxelGameScene';

describe('advanceRenderTelemetry', () => {
  it('実描画frame数を単調増加させ、最新draw call数を保持する', () => {
    expect(advanceRenderTelemetry({ renderedFrames: 9, rendererCalls: 31 }, 34)).toEqual({
      renderedFrames: 10,
      rendererCalls: 34,
    });
  });
});

describe('buildWorldTelemetry', () => {
  it('現在地区、目的地区、bounds、地区一覧を公開する', () => {
    expect(buildWorldTelemetry([0, 0.8, 6])).toEqual({
      bounds: { maxX: 36, maxZ: 36, minX: -36, minZ: -36 },
      currentDistrict: 'hub',
      destinationDistrict: 'fire',
      districts: [
        { id: 'hub', label: 'ちゅうおうしゃこ' },
        { id: 'park', label: 'こうえん' },
        { id: 'fire', label: 'かさいげんば' },
        { id: 'blocks', label: 'つみきひろば' },
        { id: 'south', label: 'じゆうそうこう' },
      ],
    });
  });
});

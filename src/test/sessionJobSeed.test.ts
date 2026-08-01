import { describe, expect, it } from 'vitest';
import {
  parseJobSeedQuery,
  resolveSessionJobSeed,
} from '../voxel-game/domain/sessionJobSeed';

describe('session job seed', () => {
  it.each([
    ['?job-seed=42', 42],
    ['?view=map&job-seed=-1', 0xffff_ffff],
    ['?job-seed=0', 0x6d2b_79f5],
  ] as const)('%sを再現可能なuint32 seedへ解析する', (search, expected) => {
    expect(parseJobSeedQuery(search)).toBe(expected);
  });

  it.each([
    '',
    '?job-seed=',
    '?job-seed=12.5',
    '?job-seed=1e3',
    '?job-seed=12x',
    '?job-seed=9007199254740992',
  ])('%sに有効な整数seedがなければnullを返す', (search) => {
    expect(parseJobSeedQuery(search)).toBeNull();
  });

  it('queryがあればentropyより優先し、なければentropyを正規化してsession seedにする', () => {
    expect(resolveSessionJobSeed('?job-seed=77', 123)).toEqual({
      seed: 77,
      source: 'query',
    });
    expect(resolveSessionJobSeed('?mode=play', 123)).toEqual({
      seed: 123,
      source: 'session',
    });
    expect(resolveSessionJobSeed('?job-seed=bad', 0)).toEqual({
      seed: 0x6d2b_79f5,
      source: 'session',
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  JobDeck,
  normalizeJobSeed,
} from '../voxel-game/domain/JobDeck';

const JOBS = [
  { id: 'job-a' },
  { id: 'job-b' },
  { id: 'job-c' },
] as const;

/** 指定回数だけdeckを引き、比較しやすいID列へ変換する。 */
function drawIds(deck: JobDeck<(typeof JOBS)[number]>, count: number): string[] {
  return Array.from({ length: count }, () => deck.draw().id);
}

describe('JobDeck', () => {
  it('同じseedから同じ仕事順を再現し、入力配列を変更しない', () => {
    const original = [...JOBS];
    const first = drawIds(new JobDeck(JOBS, 0x1234_5678), 12);
    const second = drawIds(new JobDeck(JOBS, 0x1234_5678), 12);

    expect(first).toEqual(second);
    expect(JOBS).toEqual(original);
  });

  it('異なる検証seedでは異なる最初の巡回順を作る', () => {
    const first = drawIds(new JobDeck(JOBS, 1), JOBS.length);
    const second = drawIds(new JobDeck(JOBS, 0x9e37_79b9), JOBS.length);

    expect(first).not.toEqual(second);
  });

  it('1巡内で重複せず、bag補充境界でも直前仕事を連続させない', () => {
    const sequence = drawIds(new JobDeck(JOBS, 42), JOBS.length * 8);

    for (let offset = 0; offset < sequence.length; offset += JOBS.length) {
      expect(new Set(sequence.slice(offset, offset + JOBS.length))).toEqual(
        new Set(JOBS.map(({ id }) => id)),
      );
      if (offset > 0) expect(sequence[offset]).not.toBe(sequence[offset - 1]);
    }
  });

  it.each([
    [0, 0x6d2b_79f5],
    [-1, 0xffff_ffff],
    [0x1_0000_0001, 1],
    [Number.NaN, 0x6d2b_79f5],
    [Number.POSITIVE_INFINITY, 0x6d2b_79f5],
  ] as const)('seed %sをuint32の%sへ正規化する', (seed, expected) => {
    expect(normalizeJobSeed(seed)).toBe(expected);
  });

  it('2件未満、重複ID、空IDの候補を明確に拒否する', () => {
    expect(() => new JobDeck([{ id: 'only' }], 1)).toThrowError(
      'JobDeck requires at least two jobs',
    );
    expect(() => new JobDeck([{ id: 'same' }, { id: 'same' }], 1)).toThrowError(
      'JobDeck requires unique non-empty job ids',
    );
    expect(() => new JobDeck([{ id: '' }, { id: 'valid' }], 1)).toThrowError(
      'JobDeck requires unique non-empty job ids',
    );
  });
});

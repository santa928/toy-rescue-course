import { normalizeJobSeed } from './JobDeck';

const DECIMAL_INTEGER_PATTERN = /^[+-]?\d+$/;

/** session seedの由来を含む、App初期化時のpureな解決結果。 */
export interface SessionJobSeedResolution {
  readonly seed: number;
  readonly source: 'query' | 'session';
}

/** `?job-seed=`の安全な10進整数だけをuint32へ正規化し、それ以外はnullにする。 */
export function parseJobSeedQuery(search: string): number | null {
  const rawValue = new URLSearchParams(search).get('job-seed');
  if (rawValue === null) return null;
  const value = rawValue.trim();
  if (!DECIMAL_INTEGER_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? normalizeJobSeed(parsed) : null;
}

/** query seedを優先し、未指定・不正時は外部entropyから1 sessionのseedをpureに決める。 */
export function resolveSessionJobSeed(
  search: string,
  entropy: unknown,
): SessionJobSeedResolution {
  const querySeed = parseJobSeedQuery(search);
  return querySeed === null
    ? { seed: normalizeJobSeed(entropy), source: 'session' }
    : { seed: querySeed, source: 'query' };
}

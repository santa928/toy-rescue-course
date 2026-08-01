/** shuffle bagへ格納できる、一意な文字列IDを持つ仕事。 */
export interface JobDeckEntry {
  readonly id: string;
}

const DEFAULT_JOB_SEED = 0x6d2b_79f5;
const UINT32_RANGE = 0x1_0000_0000;

/** 外部seedをxorshift32が停止しない非0のuint32へ正規化する。 */
export function normalizeJobSeed(seed: unknown): number {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) return DEFAULT_JOB_SEED;
  const normalized = Math.trunc(seed) >>> 0;
  return normalized === 0 ? DEFAULT_JOB_SEED : normalized;
}

/** xorshift32を1step進め、非0のuint32 stateを返す。 */
function advanceJobRandomState(state: number): number {
  let next = state >>> 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return next >>> 0;
}

/**
 * seed付きFisher-Yatesで仕事を1巡ずつ引くpure-domain shuffle bag。
 * 入力候補は変更せず、bag補充境界でも直前と同じ仕事を先頭にしない。
 */
export class JobDeck<Job extends JobDeckEntry> {
  public readonly seed: number;
  private bag: Job[] = [];
  private readonly jobs: readonly Job[];
  private lastJobId: string | null = null;
  private randomState: number;

  /** 一意な2件以上の仕事と再現用seedから空のdeckを作る。 */
  public constructor(jobs: readonly Job[], seed: unknown) {
    if (jobs.length < 2) throw new Error('JobDeck requires at least two jobs');
    const ids = jobs.map(({ id }) => id);
    if (ids.some((id) => id.trim().length === 0) || new Set(ids).size !== ids.length) {
      throw new Error('JobDeck requires unique non-empty job ids');
    }
    this.jobs = [...jobs];
    this.seed = normalizeJobSeed(seed);
    this.randomState = this.seed;
  }

  /** 現在巡回から次仕事を1件返し、空なら非連続な新巡回を補充する。 */
  public draw(): Job {
    if (this.bag.length === 0) this.refill();
    const job = this.bag.pop();
    if (!job) throw new Error('JobDeck could not draw a job');
    this.lastJobId = job.id;
    return job;
  }

  /** 候補をseed付きで並べ替え、次に引く末尾が直前仕事なら先頭と交換する。 */
  private refill(): void {
    const nextBag = [...this.jobs];
    for (let index = nextBag.length - 1; index > 0; index -= 1) {
      this.randomState = advanceJobRandomState(this.randomState);
      const swapIndex = Math.floor((this.randomState / UINT32_RANGE) * (index + 1));
      [nextBag[index], nextBag[swapIndex]] = [nextBag[swapIndex], nextBag[index]];
    }

    const nextDrawIndex = nextBag.length - 1;
    if (this.lastJobId !== null && nextBag[nextDrawIndex]?.id === this.lastJobId) {
      [nextBag[0], nextBag[nextDrawIndex]] = [nextBag[nextDrawIndex], nextBag[0]];
    }
    this.bag = nextBag;
  }
}

import { ABSENT, MS_PER_SEC } from "./constants";
import { isNonEmpty, regionUrl, type NonEmpty, type RegionPolicy } from "./config";

export type Probe = (base: string) => Promise<number | typeof ABSENT>;

type Pick = { readonly base: string; readonly at: number };
type Timing = { readonly base: string; readonly elapsed: number | typeof ABSENT };
type Reachable = { readonly base: string; readonly elapsed: number };

const picked = new Map<string, Pick>();
const penalisedAt = new Map<string, number>();

export class RegionSelector {
  private selecting: Promise<string> | typeof ABSENT = ABSENT;
  private readonly key: string;

  constructor(
    private readonly policy: RegionPolicy,
    private readonly pinned: string | typeof ABSENT,
    private readonly probe: Probe,
  ) {
    this.key = Object.entries(policy.regions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, base]) => `${name}=${base}`)
      .join(",");
  }

  current(): Promise<string> {
    if (this.pinned !== ABSENT) return Promise.resolve(this.pinned);
    if (this.selecting === ABSENT) {
      this.selecting = this.select().finally(() => {
        this.selecting = ABSENT;
      });
    }
    return this.selecting;
  }

  reportFailure(base: string): void {
    if (this.pinned !== ABSENT) return;
    penalisedAt.set(base, performance.now());
    picked.delete(this.key);
  }

  private healthy(base: string, now: number): boolean {
    const since = penalisedAt.get(base) ?? ABSENT;
    return since === ABSENT || now - since > this.policy.failoverPenaltySecs * MS_PER_SEC;
  }

  private cachedPick(candidates: NonEmpty<string>, now: number): string | typeof ABSENT {
    const cached = picked.get(this.key) ?? ABSENT;
    const fresh = cached !== ABSENT && now - cached.at < this.policy.cacheTtlSecs * MS_PER_SEC;
    return fresh && candidates.includes(cached.base) ? cached.base : ABSENT;
  }

  private fallback(candidates: NonEmpty<string>): string {
    const preferred = regionUrl(this.policy.regions, this.policy.defaultRegion);
    return preferred !== ABSENT && candidates.includes(preferred) ? preferred : candidates[0];
  }

  private async select(): Promise<string> {
    const now = performance.now();
    const healthy = this.policy.bases.filter((base) => this.healthy(base, now));
    const candidates: NonEmpty<string> = isNonEmpty(healthy) ? healthy : this.policy.bases;
    if (candidates.length === 1) return candidates[0];
    const cached = this.cachedPick(candidates, now);
    if (cached !== ABSENT) return cached;
    const timings: readonly Timing[] = await Promise.all(
      candidates.map(async (base) => ({ base, elapsed: await this.probe(base) })),
    );
    const reachable = timings
      .filter((timing): timing is Reachable => timing.elapsed !== ABSENT)
      .sort((a, b) => a.elapsed - b.elapsed);
    const chosen = isNonEmpty(reachable) ? reachable[0].base : this.fallback(candidates);
    picked.set(this.key, { base: chosen, at: now });
    return chosen;
  }
}

package rustbox

import (
	"cmp"
	"context"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
)

type regionPick struct {
	base string
	at   time.Time
}

type processRegions struct {
	mu          sync.Mutex
	picked      map[string]regionPick
	penalisedAt map[string]time.Time
}

var process = &processRegions{picked: map[string]regionPick{}, penalisedAt: map[string]time.Time{}}

type probeFunc func(ctx context.Context, base string) (time.Duration, bool)

type timing struct {
	base    string
	elapsed time.Duration
	ok      bool
}

type regionSelector struct {
	policy    RegionPolicy
	pinned    *string
	key       string
	bases     []string
	selecting sync.Mutex
}

func newRegionSelector(policy RegionPolicy, pinned *string) *regionSelector {
	names := make([]string, 0, len(policy.Regions))
	for name := range policy.Regions {
		names = append(names, name)
	}
	sort.Strings(names)
	pairs := make([]string, 0, len(names))
	bases := make([]string, 0, len(names))
	for _, name := range names {
		pairs = append(pairs, name+"="+policy.Regions[name])
		bases = append(bases, policy.Regions[name])
	}
	return &regionSelector{policy: policy, pinned: pinned, key: strings.Join(pairs, ","), bases: bases}
}

func (r *regionSelector) current(ctx context.Context, probe probeFunc) string {
	if r.pinned != nil {
		return *r.pinned
	}
	r.selecting.Lock()
	defer r.selecting.Unlock()
	return r.selectRegion(ctx, probe)
}

func (r *regionSelector) reportFailure(base string) {
	if r.pinned != nil {
		return
	}
	process.mu.Lock()
	defer process.mu.Unlock()
	process.penalisedAt[base] = time.Now()
	delete(process.picked, r.key)
}

func (r *regionSelector) candidates(now time.Time) []string {
	process.mu.Lock()
	defer process.mu.Unlock()
	healthy := make([]string, 0, len(r.bases))
	for _, base := range r.bases {
		since, penalised := process.penalisedAt[base]
		if !penalised || now.Sub(since) > r.policy.FailoverPenalty {
			healthy = append(healthy, base)
		}
	}
	if len(healthy) == 0 {
		return r.bases
	}
	return healthy
}

func (r *regionSelector) cached(candidates []string, now time.Time) (string, bool) {
	process.mu.Lock()
	defer process.mu.Unlock()
	pick, ok := process.picked[r.key]
	if !ok || now.Sub(pick.at) >= r.policy.CacheTTL || !slices.Contains(candidates, pick.base) {
		return "", false
	}
	return pick.base, true
}

func (r *regionSelector) fallback(candidates []string) string {
	if slices.Contains(candidates, r.policy.Fallback) {
		return r.policy.Fallback
	}
	return candidates[0]
}

func (r *regionSelector) selectRegion(ctx context.Context, probe probeFunc) string {
	now := time.Now()
	candidates := r.candidates(now)
	if len(candidates) == 1 {
		return candidates[0]
	}
	if cached, ok := r.cached(candidates, now); ok {
		return cached
	}
	timings := make([]timing, len(candidates))
	var probes sync.WaitGroup
	for index, base := range candidates {
		probes.Add(1)
		go func(index int, base string) {
			defer probes.Done()
			elapsed, ok := probe(ctx, base)
			timings[index] = timing{base: base, elapsed: elapsed, ok: ok}
		}(index, base)
	}
	probes.Wait()
	reachable := slices.DeleteFunc(timings, func(t timing) bool { return !t.ok })
	chosen := r.fallback(candidates)
	if len(reachable) > 0 {
		chosen = slices.MinFunc(reachable, func(a, b timing) int { return cmp.Compare(a.elapsed, b.elapsed) }).base
	}
	process.mu.Lock()
	process.picked[r.key] = regionPick{base: chosen, at: now}
	process.mu.Unlock()
	return chosen
}

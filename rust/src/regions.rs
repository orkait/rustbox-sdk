use std::collections::HashMap;
use std::future::Future;
use std::sync::{LazyLock, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use futures_util::future::join_all;

use crate::config::RegionPolicy;

#[derive(Default)]
struct ProcessRegions {
    picked: HashMap<String, (String, Instant)>,
    penalised_at: HashMap<String, Instant>,
}

static PROCESS: LazyLock<Mutex<ProcessRegions>> = LazyLock::new(Mutex::default);

fn process() -> MutexGuard<'static, ProcessRegions> {
    PROCESS.lock().unwrap_or_else(PoisonError::into_inner)
}

pub(crate) struct RegionSelector {
    policy: RegionPolicy,
    pinned: Option<String>,
    selecting: tokio::sync::Mutex<()>,
    key: String,
}

impl RegionSelector {
    pub fn new(policy: RegionPolicy, pinned: Option<String>) -> Self {
        let key = policy
            .regions
            .iter()
            .map(|(name, base)| format!("{name}={base}"))
            .collect::<Vec<_>>()
            .join(",");
        Self {
            policy,
            pinned,
            selecting: tokio::sync::Mutex::new(()),
            key,
        }
    }

    pub async fn current<F, Fut>(&self, probe: F) -> String
    where
        F: Fn(String) -> Fut,
        Fut: Future<Output = Option<Duration>>,
    {
        if let Some(pinned) = &self.pinned {
            return pinned.clone();
        }
        let _selecting = self.selecting.lock().await;
        self.select(probe).await
    }

    pub fn report_failure(&self, base: &str) {
        if self.pinned.is_some() {
            return;
        }
        let mut state = process();
        state.penalised_at.insert(base.to_string(), Instant::now());
        state.picked.remove(&self.key);
    }

    fn candidates(&self, now: Instant) -> Vec<String> {
        let state = process();
        let everyone: Vec<String> = self.policy.regions.values().cloned().collect();
        let healthy: Vec<String> = everyone
            .iter()
            .filter(|base| {
                state
                    .penalised_at
                    .get(*base)
                    .is_none_or(|since| now.duration_since(*since) > self.policy.failover_penalty)
            })
            .cloned()
            .collect();
        if healthy.is_empty() {
            everyone
        } else {
            healthy
        }
    }

    fn cached(&self, candidates: &[String], now: Instant) -> Option<String> {
        process()
            .picked
            .get(&self.key)
            .filter(|(base, at)| {
                candidates.contains(base) && now.duration_since(*at) < self.policy.cache_ttl
            })
            .map(|(base, _)| base.clone())
    }

    fn fallback(&self, candidates: &[String]) -> String {
        if candidates.contains(&self.policy.fallback) {
            return self.policy.fallback.clone();
        }
        candidates
            .first()
            .cloned()
            .unwrap_or_else(|| self.policy.fallback.clone())
    }

    async fn select<F, Fut>(&self, probe: F) -> String
    where
        F: Fn(String) -> Fut,
        Fut: Future<Output = Option<Duration>>,
    {
        let now = Instant::now();
        let candidates = self.candidates(now);
        if let [only] = candidates.as_slice() {
            return only.clone();
        }
        if let Some(cached) = self.cached(&candidates, now) {
            return cached;
        }
        let timings = join_all(candidates.iter().cloned().map(&probe)).await;
        let chosen = candidates
            .iter()
            .zip(timings)
            .filter_map(|(base, elapsed)| elapsed.map(|elapsed| (elapsed, base)))
            .min_by_key(|(elapsed, _)| *elapsed)
            .map(|(_, base)| base.clone())
            .unwrap_or_else(|| self.fallback(&candidates));
        process()
            .picked
            .insert(self.key.clone(), (chosen.clone(), now));
        chosen
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    use super::RegionSelector;
    use crate::config::{ClientConfig, Options};

    #[tokio::test]
    async fn an_expired_pick_is_probed_again() {
        let regions = BTreeMap::from(
            ["a", "b"].map(|name| (name.to_string(), format!("https://{name}.expiry.test"))),
        );
        let options = Options {
            regions,
            ..Options::default()
        };
        let mut policy = ClientConfig::load("rb_test", options, |_: &str| None)
            .expect("valid config")
            .region;
        policy.cache_ttl = Duration::ZERO;
        let selector = RegionSelector::new(policy, None);
        let probes = AtomicUsize::new(0);
        let counter = &probes;
        for _ in 0..2 {
            selector
                .current(|_| async move {
                    counter.fetch_add(1, Ordering::SeqCst);
                    Some(Duration::ZERO)
                })
                .await;
        }
        assert_eq!(probes.load(Ordering::SeqCst), 4);
    }
}

//! 메모리 기반 슬라이딩 윈도우(1분) 요청 제한기

use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
    time::{Duration, Instant},
};

const WINDOW: Duration = Duration::from_secs(60);
/// 키가 이 개수를 넘으면 오래된 키를 정리 (메모리 증가 방지)
const MAX_KEYS: usize = 10_000;

pub struct RateLimiter {
    limit: usize,
    hits: Mutex<HashMap<String, VecDeque<Instant>>>,
}

impl RateLimiter {
    pub fn new(limit_per_minute: usize) -> Self {
        Self {
            limit: limit_per_minute,
            hits: Mutex::new(HashMap::new()),
        }
    }

    /// 허용되면 기록하고 true, 한도 초과면 false
    pub fn allow(&self, key: &str) -> bool {
        self.allow_at(key, Instant::now())
    }

    fn allow_at(&self, key: &str, now: Instant) -> bool {
        let mut map = self.hits.lock().unwrap_or_else(|e| e.into_inner());
        if map.len() > MAX_KEYS {
            map.retain(|_, q| q.back().is_some_and(|t| now.duration_since(*t) < WINDOW));
        }
        let q = map.entry(key.to_string()).or_default();
        while q.front().is_some_and(|t| now.duration_since(*t) >= WINDOW) {
            q.pop_front();
        }
        if q.len() >= self.limit {
            return false;
        }
        q.push_back(now);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_after_limit_and_recovers_after_window() {
        let l = RateLimiter::new(2);
        let t0 = Instant::now();
        assert!(l.allow_at("a", t0));
        assert!(l.allow_at("a", t0));
        assert!(!l.allow_at("a", t0));
        // 다른 키는 독립
        assert!(l.allow_at("b", t0));
        // 1분 뒤에는 다시 허용
        assert!(l.allow_at("a", t0 + Duration::from_secs(61)));
    }
}

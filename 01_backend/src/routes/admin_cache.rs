//! 관리자 화면(대시보드·성장 분석) 응답 캐시 — "먼저 보여 주고 뒤에서 새로 고침".
//!
//! - `FRESH` 안: 저장한 응답을 그대로
//! - `FRESH` ~ `MAX_STALE`: 저장한 응답을 바로 돌려주고, 새 집계는 뒤에서 한 번만 (응답에 집계 시각이 있음)
//! - 그 뒤 또는 처음: 기다려서 새로 집계
//!
//! Amplitude 조회는 몇 초씩 걸리므로, 관리자가 화면을 열 때마다 기다리지 않게 합니다.

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

pub const FRESH: Duration = Duration::from_secs(300);
pub const MAX_STALE: Duration = Duration::from_secs(3600);

pub struct SwrCache<T> {
    inner: Mutex<Option<HashMap<String, Entry<T>>>>,
}

struct Entry<T> {
    at: Instant,
    value: T,
    refreshing: bool,
}

#[derive(Debug, PartialEq)]
pub enum Hit<T> {
    /// 그대로 써도 됨
    Fresh(T),
    /// 오래됨: 이걸 돌려주고 호출한 쪽이 뒤에서 새로 집계 (`put` 또는 실패 시 `release`)
    Stale(T),
    Miss,
}

impl<T: Clone> SwrCache<T> {
    pub const fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    pub fn lookup(&self, key: &str) -> Hit<T> {
        self.lookup_with(key, FRESH, MAX_STALE)
    }

    pub fn lookup_with(&self, key: &str, fresh: Duration, max_stale: Duration) -> Hit<T> {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let Some(e) = guard.get_or_insert_with(HashMap::new).get_mut(key) else {
            return Hit::Miss;
        };
        let age = e.at.elapsed();
        if age < fresh {
            Hit::Fresh(e.value.clone())
        } else if age < max_stale {
            if e.refreshing {
                // 이미 누가 새로 집계 중
                Hit::Fresh(e.value.clone())
            } else {
                e.refreshing = true;
                Hit::Stale(e.value.clone())
            }
        } else {
            Hit::Miss
        }
    }

    pub fn put(&self, key: &str, value: T) {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let map = guard.get_or_insert_with(HashMap::new);
        map.retain(|_, e| e.at.elapsed() < MAX_STALE);
        map.insert(
            key.to_string(),
            Entry {
                at: Instant::now(),
                value,
                refreshing: false,
            },
        );
    }

    /// 뒤에서 새로 집계하다 실패: 다음 요청이 다시 시도하게
    pub fn release(&self, key: &str) {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(e) = guard.as_mut().and_then(|m| m.get_mut(key)) {
            e.refreshing = false;
        }
    }
}

impl<T: Clone> Default for SwrCache<T> {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_then_stale_once_then_miss() {
        let c: SwrCache<i32> = SwrCache::new();
        assert_eq!(c.lookup("a"), Hit::Miss);
        c.put("a", 1);
        assert_eq!(c.lookup("a"), Hit::Fresh(1));
        // 오래됨 → 처음 한 번만 Stale (새로 집계 맡김), 그다음은 그대로
        let z = Duration::ZERO;
        let h = Duration::from_secs(3600);
        assert_eq!(c.lookup_with("a", z, h), Hit::Stale(1));
        assert_eq!(c.lookup_with("a", z, h), Hit::Fresh(1));
        c.release("a");
        assert_eq!(c.lookup_with("a", z, h), Hit::Stale(1));
        c.put("a", 2);
        assert_eq!(c.lookup("a"), Hit::Fresh(2));
        assert_eq!(c.lookup_with("a", z, z), Hit::Miss);
    }
}

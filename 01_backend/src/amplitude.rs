//! Amplitude Dashboard REST API 클라이언트 (관리자 대시보드·성장 분석용, 읽기 전용).
//!
//! - 프로젝트 API 키 + Secret 키(Basic 인증)는 서버 `.env` 에만 둡니다 (`AMPLITUDE_API_KEY`, `AMPLITUDE_SECRET_KEY`).
//!   브라우저용 키(`VITE_AMPLITUDE_API_KEY`)와 같은 프로젝트여야 하지만, Secret 키는 절대 프론트에 넣지 않습니다.
//! - 날짜는 Amplitude 프로젝트 시간대 기준입니다. 프로젝트 설정의 시간대를 Asia/Seoul 로 맞춰 두세요.
//! - 사용 API: 이벤트 세그먼트(`/api/2/events/segmentation`), 퍼널(`/api/2/funnels`), 리텐션(`/api/2/retention`)
//!
//! 속도 (예전에는 조회 20여 개를 하나씩 차례로 보내 첫 화면이 수십 초 걸렸음)
//! - 동시에 최대 `MAX_CONCURRENT` 개까지 보냅니다. 무료 플랜의 "동시 조회 비용" 한도(429)를 넘지 않는 선
//! - 같은 조회는 결과를 재사용합니다: 오늘이 들어간 조회는 5분, 이미 지난 날짜만 보는 조회는 6시간
//!   (대시보드와 성장 분석이 같은 조회를 나눠 쓰고, "이전 기간" 숫자는 바뀌지 않으므로 다시 받지 않음)

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use chrono::{FixedOffset, NaiveDate, Utc};
use serde_json::{Value, json};
use tokio::sync::Semaphore;

/// 미국 데이터센터 기본 주소. EU 프로젝트는 `https://analytics.eu.amplitude.com`
pub const DEFAULT_BASE_URL: &str = "https://amplitude.com";
/// 동시에 보내는 조회 수 (기간 31일 이하 조회 기준으로 429 가 나지 않는 수준)
const MAX_CONCURRENT: usize = 3;
/// 오늘이 들어간 조회 결과 재사용 시간
const LIVE_TTL: Duration = Duration::from_secs(300);
/// 지난 날짜만 보는 조회 결과 재사용 시간 (늦게 들어오는 이벤트가 드물게 있어 무한히 두지는 않음)
const PAST_TTL: Duration = Duration::from_secs(6 * 3600);

pub struct AmplitudeClient {
    http: reqwest::Client,
    base_url: String,
    api_key: String,
    secret_key: String,
    limit: Semaphore,
    cache: Mutex<HashMap<String, (Instant, Duration, Value)>>,
}

/// 이벤트 세그먼트 결과 (그룹이 없으면 시리즈 1개)
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Segmentation {
    /// Amplitude 에 이 이벤트(속성)가 있는지. 한 번도 수집되지 않았으면 false (값은 모두 0)
    pub found: bool,
    /// x 축 원래 값 (일별 `2026-11-20`, 시간별 `2026-11-20T13:00:00`)
    pub x: Vec<String>,
    /// 날짜 (YYYY-MM-DD)
    pub dates: Vec<String>,
    /// 그룹(시리즈)별 이름. 그룹이 없으면 빈 문자열 하나. 그룹 기준이 둘이면 `값1; 값2`
    pub labels: Vec<String>,
    /// 그룹별 날짜별 값
    pub series: Vec<Vec<f64>>,
    /// 그룹별 기간 전체 값 (uniques 면 기간 중 중복 없는 사용자 수)
    pub totals: Vec<f64>,
}

impl Segmentation {
    pub fn total(&self) -> f64 {
        self.totals.first().copied().unwrap_or(0.0)
    }
}

#[derive(Debug, Clone, Copy)]
pub enum Metric {
    /// 고유 사용자 수
    Uniques,
    /// 이벤트 발생 횟수
    Totals,
}

impl Metric {
    fn as_str(self) -> &'static str {
        match self {
            Metric::Uniques => "uniques",
            Metric::Totals => "totals",
        }
    }
}

/// 그래프 단위
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Interval {
    Hour,
    Day,
}

impl Interval {
    fn as_param(self) -> &'static str {
        match self {
            Interval::Hour => "-3600000",
            Interval::Day => "1",
        }
    }
}

/// 리텐션 코호트 한 줄 (그날 시작 이벤트를 한 사용자)
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RetentionCohort {
    /// YYYY-MM-DD
    pub date: String,
    /// 코호트 크기 (0일째)
    pub size: f64,
    /// N일째(0, 1, 2, …) 다시 온 사용자 수
    pub counts: Vec<f64>,
    /// N일째가 아직 끝나지 않았는지 (오늘 이후)
    pub incomplete: Vec<bool>,
}

// ---------- 이벤트 조건 (REST API 형식) ----------

/// 이벤트 하나 `{"event_type": …}`. `_active`(아무 이벤트), `_new`(처음 온 사용자) 도 됨
pub fn ev(event_type: &str) -> Value {
    json!({ "event_type": event_type })
}

/// 이벤트 속성 조건 (속성 = 값들 중 하나)
pub fn where_is(mut e: Value, prop: &str, values: &[&str]) -> Value {
    let f = json!({
        "subprop_type": "event",
        "subprop_key": prop,
        "subprop_op": "is",
        "subprop_value": values,
    });
    match e.get_mut("filters").and_then(Value::as_array_mut) {
        Some(a) => a.push(f),
        None => e["filters"] = json!([f]),
    }
    e
}

/// 나누기 기준. `kind` = event | user. 직접 넣은 사용자 속성(utm 등)은 `gp:` 를 붙여야 함
pub fn group_by(mut e: Value, kind: &str, prop: &str) -> Value {
    let g = json!({ "type": kind, "value": prop });
    match e.get_mut("group_by").and_then(Value::as_array_mut) {
        Some(a) => a.push(g),
        None => e["group_by"] = json!([g]),
    }
    e
}

pub fn today_kst() -> NaiveDate {
    let kst = FixedOffset::east_opt(9 * 3600).expect("KST");
    Utc::now().with_timezone(&kst).date_naive()
}

impl AmplitudeClient {
    pub fn new(api_key: &str, secret_key: &str, base_url: Option<&str>) -> anyhow::Result<Self> {
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(20))
                .build()?,
            base_url: base_url
                .unwrap_or(DEFAULT_BASE_URL)
                .trim_end_matches('/')
                .to_string(),
            api_key: api_key.to_string(),
            secret_key: secret_key.to_string(),
            limit: Semaphore::new(MAX_CONCURRENT),
            cache: Mutex::new(HashMap::new()),
        })
    }

    /// `end` = 조회 마지막 날짜 (재사용 시간 결정)
    async fn get(
        &self,
        path: &str,
        query: &[(&str, String)],
        end: NaiveDate,
    ) -> Result<Value, String> {
        let key = format!(
            "{path}?{}",
            query
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join("&")
        );
        let ttl = if end < today_kst() {
            PAST_TTL
        } else {
            LIVE_TTL
        };
        if let Some(v) = self.cached(&key) {
            return Ok(v);
        }

        let _permit = self
            .limit
            .acquire()
            .await
            .map_err(|_| "Amplitude 조회 대기열이 닫혔습니다".to_string())?;
        // 기다리는 사이 같은 조회가 끝났으면 그 결과를 씀
        if let Some(v) = self.cached(&key) {
            return Ok(v);
        }
        // 429(동시 조회 비용 초과)는 앞 조회가 끝나면 풀리므로 잠깐 기다렸다 다시 시도 (최대 3번)
        let mut attempt = 0u64;
        let res = loop {
            let res = self
                .http
                .get(format!("{}{path}", self.base_url))
                .basic_auth(&self.api_key, Some(&self.secret_key))
                .query(query)
                .send()
                .await
                .map_err(|e| format!("Amplitude 요청 실패: {e}"))?;
            if res.status() == reqwest::StatusCode::TOO_MANY_REQUESTS && attempt < 3 {
                attempt += 1;
                tokio::time::sleep(Duration::from_millis(1500 * attempt)).await;
                continue;
            }
            break res;
        };
        let status = res.status();
        if !status.is_success() {
            // 응답 본문에 키가 들어가지 않지만, 길 수 있어 앞부분만 로그용으로 남김
            let body = res.text().await.unwrap_or_default();
            let short: String = body.chars().take(400).collect();
            return Err(format!("Amplitude 응답 {status}: {short}"));
        }
        let v: Value = res
            .json()
            .await
            .map_err(|e| format!("Amplitude 응답 해석 실패: {e}"))?;
        let mut cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        cache.retain(|_, (at, ttl, _)| at.elapsed() < *ttl);
        cache.insert(key, (Instant::now(), ttl, v.clone()));
        Ok(v)
    }

    fn cached(&self, key: &str) -> Option<Value> {
        let cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        cache
            .get(key)
            .filter(|(at, ttl, _)| at.elapsed() < *ttl)
            .map(|(_, _, v)| v.clone())
    }

    /// 이벤트 하나의 일별 값. `group_by` 는 이벤트 속성 이름 (예: hospital_id)
    pub async fn segmentation(
        &self,
        event: &str,
        metric: Metric,
        start: NaiveDate,
        end: NaiveDate,
        group: Option<&str>,
    ) -> Result<Segmentation, String> {
        let mut e = ev(event);
        if let Some(prop) = group {
            e = group_by(e, "event", prop);
        }
        self.segment(&e, metric, start, end, Interval::Day).await
    }

    /// 이벤트 조건(`ev`·`where_is`·`group_by` 로 만든 값) 그대로 조회
    pub async fn segment(
        &self,
        e: &Value,
        metric: Metric,
        start: NaiveDate,
        end: NaiveDate,
        interval: Interval,
    ) -> Result<Segmentation, String> {
        let mut query = vec![
            ("e", e.to_string()),
            ("m", metric.as_str().to_string()),
            ("start", ymd(start)),
            ("end", ymd(end)),
            ("i", interval.as_param().to_string()),
        ];
        if e.get("group_by").is_some() {
            query.push(("limit", "50".to_string()));
        }
        match self.get("/api/2/events/segmentation", &query, end).await {
            Ok(v) => parse_segmentation(&v),
            // 아직 한 번도 들어오지 않은 이벤트 = 값 0 (새 프로젝트·새 이벤트)
            Err(e) if is_event_not_found(&e) => Ok(Segmentation::default()),
            Err(e) => Err(e),
        }
    }

    /// 순서 퍼널. 단계별 누적 사용자 수 (첫 값 = 1단계 사용자).
    /// 아직 들어온 적 없는 이벤트가 있으면 앞 단계부터 들어온 데까지만 계산하고 나머지는 0
    /// (예: 방문은 있고 AI 상담은 아직 없음 → [방문자, 0, 0, 0, 0])
    pub async fn funnel(
        &self,
        events: &[&str],
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<Vec<f64>, String> {
        let events: Vec<Value> = events.iter().map(|e| ev(e)).collect();
        Ok(self.funnel_events(&events, start, end).await?.0)
    }

    /// `funnel` 과 같고, 계산할 수 있었던 앞 단계 수(`reach`)도 돌려줌.
    /// reach 뒤 단계는 이벤트가 아직 수집되지 않아 0 으로 채운 값
    pub async fn funnel_events(
        &self,
        events: &[Value],
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<(Vec<f64>, usize), String> {
        for n in (1..=events.len()).rev() {
            match self.funnel_steps(&events[..n], start, end).await {
                Ok(mut v) => {
                    v.resize(events.len(), 0.0);
                    return Ok((v, n));
                }
                Err(e) if is_event_not_found(&e) => continue,
                Err(e) => return Err(e),
            }
        }
        Ok((vec![0.0; events.len()], 0))
    }

    async fn funnel_steps(
        &self,
        events: &[Value],
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<Vec<f64>, String> {
        // 한 단계짜리 퍼널은 Amplitude 가 받지 않을 수 있어 이벤트 세그먼트(고유 사용자)로 대신
        if events.len() == 1 {
            let query = vec![
                ("e", events[0].to_string()),
                ("m", "uniques".to_string()),
                ("start", ymd(start)),
                ("end", ymd(end)),
                ("i", "1".to_string()),
            ];
            let v = self.get("/api/2/events/segmentation", &query, end).await?;
            return Ok(vec![parse_segmentation(&v)?.total()]);
        }
        let mut query: Vec<(&str, String)> = events.iter().map(|e| ("e", e.to_string())).collect();
        query.extend([
            ("start", ymd(start)),
            ("end", ymd(end)),
            ("mode", "ordered".to_string()),
            ("n", "active".to_string()),
        ]);
        let v = self.get("/api/2/funnels", &query, end).await?;
        parse_funnel(&v, events.len())
    }

    /// N일 리텐션 (`start`~`end` 에 시작 이벤트를 한 사용자를 처음 한 날로 묶고, N일째 돌아온 사용자)
    pub async fn retention(
        &self,
        start_event: &Value,
        return_event: &Value,
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<Vec<RetentionCohort>, String> {
        let query = vec![
            ("se", start_event.to_string()),
            ("re", return_event.to_string()),
            ("start", ymd(start)),
            ("end", ymd(end)),
            ("i", "1".to_string()),
        ];
        match self.get("/api/2/retention", &query, end).await {
            Ok(v) => parse_retention(&v),
            Err(e) if is_event_not_found(&e) => Ok(Vec::new()),
            Err(e) => Err(e),
        }
    }
}

/// Amplitude 가 "그런 이벤트·속성 없음"(400 event_type_not_found / event_property_not_found)으로 답했는지.
/// 트래킹 플랜에만 있고 아직 수집되지 않은 이벤트나, 그 이벤트에 아직 들어온 적 없는
/// 속성(예: hospital_id 로 나누기)을 조회하면 이렇게 옵니다. 값 0 으로 봅니다.
fn is_event_not_found(err: &str) -> bool {
    err.contains("event_type_not_found")
        || err.contains("event_property_not_found")
        || err.contains("user_property_not_found")
}

fn ymd(d: NaiveDate) -> String {
    d.format("%Y%m%d").to_string()
}

fn num(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(0.0),
        Value::Object(o) => o
            .get("value")
            .or_else(|| o.get("count"))
            .map(num)
            .unwrap_or(0.0),
        Value::String(s) => s.parse().unwrap_or(0.0),
        _ => 0.0,
    }
}

/// 그룹 이름: 문자열이면 그대로, `[0, "값"]` 같은 배열이면 문자열들을 `; ` 로 이음
fn label(v: &Value) -> String {
    match v {
        Value::String(s) => s.trim().to_string(),
        Value::Array(a) => a
            .iter()
            .filter_map(|x| x.as_str().map(str::trim))
            .collect::<Vec<_>>()
            .join("; "),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

pub fn parse_segmentation(v: &Value) -> Result<Segmentation, String> {
    let data = v.get("data").ok_or("Amplitude 응답에 data 가 없습니다")?;
    let arr = |k: &str| {
        data.get(k)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    let x: Vec<String> = arr("xValues")
        .iter()
        .map(|d| d.as_str().unwrap_or_default().replace(' ', "T"))
        .collect();
    let dates = x.iter().map(|d| d.chars().take(10).collect()).collect();
    let series: Vec<Vec<f64>> = arr("series")
        .iter()
        .map(|s| {
            s.as_array()
                .map(|a| a.iter().map(num).collect())
                .unwrap_or_default()
        })
        .collect();
    let collapsed = arr("seriesCollapsed");
    let totals = series
        .iter()
        .enumerate()
        .map(|(i, s)| match collapsed.get(i) {
            Some(Value::Array(a)) => a.first().map(num).unwrap_or(0.0),
            Some(other) => num(other),
            None => s.iter().sum(),
        })
        .collect();
    let mut labels: Vec<String> = arr("seriesLabels").iter().map(label).collect();
    labels.resize(series.len(), String::new());
    Ok(Segmentation {
        found: true,
        x,
        dates,
        labels,
        series,
        totals,
    })
}

/// JSON 안에서 이름이 `key` 인 첫 값 (깊이 우선)
fn find_key<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    match v {
        Value::Object(m) => m
            .get(key)
            .or_else(|| m.values().find_map(|x| find_key(x, key))),
        Value::Array(a) => a.iter().find_map(|x| find_key(x, key)),
        _ => None,
    }
}

/// 퍼널 응답에서 단계별 누적 사용자 수(`cumulativeRaw`)를 꺼냄.
/// 응답 모양(`data` 가 배열/객체, 그룹별 2차원 배열)에 덜 민감하게 어디에 있든 찾습니다.
pub fn parse_funnel(v: &Value, steps: usize) -> Result<Vec<f64>, String> {
    // 그 기간에 퍼널에 들어온 사용자가 없으면 Amplitude 는 "data": [] 로 답함 → 모두 0
    if v.get("data")
        .and_then(Value::as_array)
        .is_some_and(Vec::is_empty)
    {
        return Ok(vec![0.0; steps]);
    }
    let raw = find_key(v, "cumulativeRaw")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            // 다음에 원인을 바로 알 수 있게 응답 앞부분을 남김 (키·개인정보 없음)
            let snippet: String = v.to_string().chars().take(300).collect();
            format!("Amplitude 퍼널 응답에서 cumulativeRaw 를 찾지 못했습니다: {snippet}")
        })?;
    // 그룹별 [[...]] 이면 첫 그룹(전체)
    let raw = match raw.first() {
        Some(Value::Array(inner)) => inner,
        _ => raw,
    };
    let mut out: Vec<f64> = raw.iter().map(num).collect();
    out.resize(steps, 0.0);
    Ok(out)
}

/// 리텐션 응답: `data.series[0].values = { "2026-11-20": [{count, outof, incomplete}, …] }`
/// (배열 순서 = 0일째, 1일째, …)
pub fn parse_retention(v: &Value) -> Result<Vec<RetentionCohort>, String> {
    let values = v
        .get("data")
        .and_then(|d| d.get("series"))
        .and_then(Value::as_array)
        .and_then(|s| s.first())
        .and_then(|s| s.get("values"))
        .and_then(Value::as_object);
    let Some(values) = values else {
        // 데이터가 하나도 없으면 series 가 비어 있음
        if v.get("data")
            .and_then(|d| d.get("series"))
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty)
        {
            return Ok(Vec::new());
        }
        let snippet: String = v.to_string().chars().take(300).collect();
        return Err(format!(
            "Amplitude 리텐션 응답에서 series.values 를 찾지 못했습니다: {snippet}"
        ));
    };
    let mut out: Vec<RetentionCohort> = values
        .iter()
        .map(|(date, days)| {
            let days = days.as_array().cloned().unwrap_or_default();
            let counts: Vec<f64> = days.iter().map(num).collect();
            let size = days
                .first()
                .and_then(|d| d.get("outof"))
                .map(num)
                .or_else(|| counts.first().copied())
                .unwrap_or(0.0);
            RetentionCohort {
                date: date.chars().take(10).collect(),
                size,
                incomplete: days
                    .iter()
                    .map(|d| {
                        d.get("incomplete")
                            .and_then(Value::as_bool)
                            .unwrap_or(false)
                    })
                    .collect(),
                counts,
            }
        })
        .collect();
    out.sort_by(|a, b| a.date.cmp(&b.date));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_segmentation_with_and_without_groups() {
        let v = json!({"data": {
            "xValues": ["2026-11-20", "2026-11-21"],
            "series": [[3, 5]],
            "seriesLabels": [0],
            "seriesCollapsed": [[{"setId": "", "value": 7}]]
        }});
        let s = parse_segmentation(&v).unwrap();
        assert!(s.found);
        assert_eq!(s.dates, vec!["2026-11-20", "2026-11-21"]);
        assert_eq!(s.series, vec![vec![3.0, 5.0]]);
        assert_eq!(s.totals, vec![7.0]);

        let g = json!({"data": {
            "xValues": ["2026-11-20T00:00:00"],
            "series": [[4], [1]],
            "seriesLabels": [[0, "12"], [0, "(none)"]],
            "seriesCollapsed": [[{"value": 4}], [{"value": 1}]]
        }});
        let s = parse_segmentation(&g).unwrap();
        assert_eq!(s.dates, vec!["2026-11-20"]);
        assert_eq!(s.x, vec!["2026-11-20T00:00:00"]);
        assert_eq!(s.labels, vec!["12", "(none)"]);
        assert_eq!(s.totals, vec![4.0, 1.0]);

        // 나누기 기준 2개
        let two = json!({"data": {
            "xValues": ["2026-11-20 13:00:00"],
            "series": [[2]],
            "seriesLabels": [[0, "share; (none)"]],
            "seriesCollapsed": [[{"value": 2}]]
        }});
        let s = parse_segmentation(&two).unwrap();
        assert_eq!(s.labels, vec!["share; (none)"]);
        assert_eq!(s.x, vec!["2026-11-20T13:00:00"]);
    }

    #[test]
    fn missing_event_error_is_recognized() {
        assert!(is_event_not_found(
            r#"Amplitude 응답 400 Bad Request: {"error": {"metadata": {"reason": "event_type_not_found"}}}"#
        ));
        assert!(is_event_not_found(
            r#"Amplitude 응답 400 Bad Request: {"error": {"metadata": {"reason": "event_property_not_found"}}}"#
        ));
        assert!(!is_event_not_found(
            "Amplitude 응답 401 Unauthorized: invalid api key"
        ));
    }

    #[test]
    fn parses_funnel_and_pads_missing_steps() {
        let v = json!({"data": [{"cumulativeRaw": [100, 40, 10]}]});
        assert_eq!(parse_funnel(&v, 4).unwrap(), vec![100.0, 40.0, 10.0, 0.0]);
        assert!(parse_funnel(&json!({}), 2).is_err());
        // data 가 객체이거나 그룹별 2차원 배열이어도 읽음
        let obj = json!({"data": {"cumulativeRaw": [5, 2]}});
        assert_eq!(parse_funnel(&obj, 2).unwrap(), vec![5.0, 2.0]);
        let nested = json!({"data": [{"meta": {}, "cumulativeRaw": [[7, 3]]}]});
        assert_eq!(parse_funnel(&nested, 3).unwrap(), vec![7.0, 3.0, 0.0]);
        // 실제 운영에서 본 응답: 그 기간 퍼널 사용자가 없으면 data 가 빈 배열
        let empty = json!({"allQueriesCached": true, "backend": "novaV2", "data": []});
        assert_eq!(parse_funnel(&empty, 3).unwrap(), vec![0.0, 0.0, 0.0]);
    }

    #[test]
    fn parses_retention_cohorts_in_date_order() {
        let v = json!({"data": {"series": [{
            "dates": ["2026-11-21", "2026-11-20"],
            "values": {
                "2026-11-21": [{"count": 4, "outof": 4, "incomplete": false}, {"count": 0, "outof": 4, "incomplete": true}],
                "2026-11-20": [{"count": 10, "outof": 10, "incomplete": false}, {"count": 3, "outof": 10, "incomplete": false}]
            }
        }], "seriesMeta": [{"segmentIndex": 0}]}});
        let r = parse_retention(&v).unwrap();
        assert_eq!(r[0].date, "2026-11-20");
        assert_eq!(r[0].size, 10.0);
        assert_eq!(r[0].counts, vec![10.0, 3.0]);
        assert_eq!(r[1].incomplete, vec![false, true]);
        assert!(
            parse_retention(&json!({"data": {"series": []}}))
                .unwrap()
                .is_empty()
        );
        assert!(parse_retention(&json!({"x": 1})).is_err());
    }

    #[test]
    fn event_conditions_use_rest_format() {
        let e = group_by(
            where_is(ev("hospital_clicked"), "click_type", &["call"]),
            "user",
            "gp:utm_source",
        );
        assert_eq!(e["filters"][0]["subprop_key"], "click_type");
        assert_eq!(e["filters"][0]["subprop_value"][0], "call");
        assert_eq!(e["group_by"][0]["value"], "gp:utm_source");
    }
}

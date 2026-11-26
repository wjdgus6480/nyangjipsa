//! Amplitude Dashboard REST API 클라이언트 (관리자 대시보드용, 읽기 전용).
//!
//! - 프로젝트 API 키 + Secret 키(Basic 인증)는 서버 `.env` 에만 둡니다 (`AMPLITUDE_API_KEY`, `AMPLITUDE_SECRET_KEY`).
//!   브라우저용 키(`VITE_AMPLITUDE_API_KEY`)와 같은 프로젝트여야 하지만, Secret 키는 절대 프론트에 넣지 않습니다.
//! - 날짜는 Amplitude 프로젝트 시간대 기준입니다. 프로젝트 설정의 시간대를 Asia/Seoul 로 맞춰 두세요.
//! - 사용 API: 이벤트 세그먼트(`/api/2/events/segmentation`), 퍼널(`/api/2/funnels`)
//!
//! Amplitude 는 요청 비용·동시 요청 수 제한이 있어, 대시보드 응답은 `routes::admin_dashboard` 에서 캐시합니다.

use std::time::Duration;

use chrono::NaiveDate;
use serde_json::{Value, json};

/// 미국 데이터센터 기본 주소. EU 프로젝트는 `https://analytics.eu.amplitude.com`
pub const DEFAULT_BASE_URL: &str = "https://amplitude.com";

pub struct AmplitudeClient {
    http: reqwest::Client,
    base_url: String,
    api_key: String,
    secret_key: String,
}

/// 이벤트 세그먼트 결과 (그룹이 없으면 시리즈 1개)
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Segmentation {
    /// 날짜 (YYYY-MM-DD)
    pub dates: Vec<String>,
    /// 그룹(시리즈)별 이름. 그룹이 없으면 빈 문자열 하나
    pub labels: Vec<String>,
    /// 그룹별 날짜별 값
    pub series: Vec<Vec<f64>>,
    /// 그룹별 기간 전체 값 (uniques 면 기간 중 중복 없는 사용자 수)
    pub totals: Vec<f64>,
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
        })
    }

    async fn get(&self, path: &str, query: &[(&str, String)]) -> Result<Value, String> {
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
        res.json()
            .await
            .map_err(|e| format!("Amplitude 응답 해석 실패: {e}"))
    }

    /// 이벤트 하나의 일별 값. `group_by` 는 이벤트 속성 이름 (예: hospital_id)
    pub async fn segmentation(
        &self,
        event: &str,
        metric: Metric,
        start: NaiveDate,
        end: NaiveDate,
        group_by: Option<&str>,
    ) -> Result<Segmentation, String> {
        let mut e = json!({ "event_type": event });
        if let Some(prop) = group_by {
            e["group_by"] = json!([{ "type": "event", "value": prop }]);
        }
        let mut query = vec![
            ("e", e.to_string()),
            ("m", metric.as_str().to_string()),
            ("start", ymd(start)),
            ("end", ymd(end)),
            ("i", "1".to_string()),
        ];
        if group_by.is_some() {
            query.push(("limit", "50".to_string()));
        }
        match self.get("/api/2/events/segmentation", &query).await {
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
        for n in (1..=events.len()).rev() {
            match self.funnel_steps(&events[..n], start, end).await {
                Ok(mut v) => {
                    v.resize(events.len(), 0.0);
                    return Ok(v);
                }
                Err(e) if is_event_not_found(&e) => continue,
                Err(e) => return Err(e),
            }
        }
        Ok(vec![0.0; events.len()])
    }

    async fn funnel_steps(
        &self,
        events: &[&str],
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<Vec<f64>, String> {
        // 한 단계짜리 퍼널은 Amplitude 가 받지 않을 수 있어 이벤트 세그먼트(고유 사용자)로 대신
        if events.len() == 1 {
            let s = self
                .segmentation(events[0], Metric::Uniques, start, end, None)
                .await?;
            return Ok(vec![s.totals.first().copied().unwrap_or(0.0)]);
        }
        let mut query: Vec<(&str, String)> = events
            .iter()
            .map(|ev| ("e", json!({ "event_type": ev }).to_string()))
            .collect();
        query.extend([
            ("start", ymd(start)),
            ("end", ymd(end)),
            ("mode", "ordered".to_string()),
            ("n", "active".to_string()),
        ]);
        let v = self.get("/api/2/funnels", &query).await?;
        parse_funnel(&v, events.len())
    }
}

/// Amplitude 가 "그런 이벤트·속성 없음"(400 event_type_not_found / event_property_not_found)으로 답했는지.
/// 트래킹 플랜에만 있고 아직 수집되지 않은 이벤트나, 그 이벤트에 아직 들어온 적 없는
/// 속성(예: hospital_id 로 나누기)을 조회하면 이렇게 옵니다. 값 0 으로 봅니다.
fn is_event_not_found(err: &str) -> bool {
    err.contains("event_type_not_found") || err.contains("event_property_not_found")
}

fn ymd(d: NaiveDate) -> String {
    d.format("%Y%m%d").to_string()
}

fn num(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(0.0),
        Value::Object(o) => o.get("value").map(num).unwrap_or(0.0),
        Value::String(s) => s.parse().unwrap_or(0.0),
        _ => 0.0,
    }
}

/// 그룹 이름: 문자열이면 그대로, `[0, "값"]` 같은 배열이면 마지막 문자열
fn label(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(a) => a
            .iter()
            .rev()
            .find_map(|x| x.as_str().map(str::to_string))
            .unwrap_or_default(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
    .split(';')
    .next()
    .unwrap_or_default()
    .trim()
    .to_string()
}

pub fn parse_segmentation(v: &Value) -> Result<Segmentation, String> {
    let data = v.get("data").ok_or("Amplitude 응답에 data 가 없습니다")?;
    let arr = |k: &str| {
        data.get(k)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    let dates = arr("xValues")
        .iter()
        .map(|d| d.as_str().unwrap_or_default().chars().take(10).collect())
        .collect();
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
        assert_eq!(s.labels, vec!["12", "(none)"]);
        assert_eq!(s.totals, vec![4.0, 1.0]);
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
    }
}

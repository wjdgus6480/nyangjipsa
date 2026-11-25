//! 길찾기: 카카오맵 경로 조회 REST API(도보·대중교통) → 우리 응답 형식.
//!
//! - 지도는 네이버를 쓰고, 카카오에서는 **경로 데이터만** 받아 옵니다 (좌표는 WGS84, [경도, 위도]).
//! - 카카오 REST API 키는 서버에만 둡니다 (`.env` 의 `KAKAO_REST_API_KEY`).
//! - 무료 쿼터(도보·대중교통 각 하루 1,000건)를 아끼려고 같은 요청은 잠시 캐시합니다.
//! - 대중교통 응답은 정류장·역 사이 구간만 들어 있고, 출발지→첫 정류장, 마지막 정류장→도착지 도보는 없습니다.

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use serde::Serialize;
use serde_json::Value;

use crate::{chat::limiter::RateLimiter, coordinate::Coordinate};

const BASE_URL: &str = "https://dapi.kakao.com";
const CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const CACHE_MAX: usize = 500;
/// 대중교통 경로 후보는 앞에서부터 이만큼만
const MAX_TRANSIT_OPTIONS: usize = 5;

pub const ROUTE_NOTICE: &str =
    "경로·소요 시간·요금 정보: 카카오맵. 실제 교통 상황과 다를 수 있습니다.";
pub const TRANSIT_WALK_NOTICE: &str =
    "출발지에서 첫 정류장(역)까지, 마지막 정류장(역)에서 병원까지 걷는 구간은 포함되지 않았어요.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Mode {
    Walk,
    Transit,
}

impl Mode {
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim() {
            "walk" => Some(Self::Walk),
            "transit" => Some(Self::Transit),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Walk => "walk",
            Self::Transit => "transit",
        }
    }
    fn path(self) -> &'static str {
        match self {
            Self::Walk => "/v2/routing/walk",
            Self::Transit => "/v2/routing/publictraffic",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RouteResponse {
    pub mode: &'static str,
    /// 경로 후보 (도보는 1개, 대중교통은 최대 5개). 결과가 없으면 빈 배열 + message
    pub routes: Vec<RouteOption>,
    /// 카카오맵에서 같은 길찾기를 여는 링크 (있을 때만)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub landing_url: Option<String>,
    /// 결과가 없을 때 사용자 안내
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub notices: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RouteOption {
    /// WALK / BUS / SUBWAY / BUS_AND_SUBWAY
    pub kind: String,
    pub time_s: i64,
    pub distance_m: i64,
    /// 대중교통 요금(원). 도보는 없음
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fare: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transfers: Option<i64>,
    pub steps: Vec<RouteStep>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RouteStep {
    /// WALKING / BUS / SUBWAY
    pub kind: String,
    pub guidance: String,
    pub distance_m: i64,
    pub time_s: i64,
    /// 대중교통 노선명 (예: 708, 3호선)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub vehicles: Vec<String>,
    /// 지나는 정류장·역 이름 (대중교통)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub stops: Vec<String>,
    /// 경로 좌표 [[경도, 위도], ...]
    pub path: Vec<[f64; 2]>,
}

#[derive(Debug, thiserror::Error)]
pub enum RoutingError {
    #[error("길찾기 사용 한도를 초과했어요. 잠시 후 다시 시도하거나 카카오맵에서 확인해 주세요")]
    QuotaExceeded,
    #[error("길찾기 서버에 연결하지 못했어요: {0}")]
    Upstream(String),
}

pub struct RouteService {
    http: reqwest::Client,
    base_url: String,
    api_key: String,
    per_client: RateLimiter,
    cache: Mutex<HashMap<String, (Instant, RouteResponse)>>,
}

impl RouteService {
    pub fn new(api_key: impl Into<String>, client_rpm: usize) -> reqwest::Result<Self> {
        Self::with_base_url(api_key, client_rpm, BASE_URL)
    }

    /// 테스트에서 모의 서버를 쓰기 위한 생성자
    pub fn with_base_url(
        api_key: impl Into<String>,
        client_rpm: usize,
        base_url: impl Into<String>,
    ) -> reqwest::Result<Self> {
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .build()?,
            base_url: base_url.into(),
            api_key: api_key.into(),
            per_client: RateLimiter::new(client_rpm),
            cache: Mutex::new(HashMap::new()),
        })
    }

    pub fn allow_client(&self, client: &str) -> bool {
        self.per_client.allow(client)
    }

    pub async fn route(
        &self,
        mode: Mode,
        from: Coordinate,
        to: Coordinate,
    ) -> Result<RouteResponse, RoutingError> {
        // 좌표는 소수 5자리(약 1m)로 맞춰 캐시 키로 사용
        let key = format!(
            "{}|{:.5},{:.5}|{:.5},{:.5}",
            mode.as_str(),
            from.lon,
            from.lat,
            to.lon,
            to.lat
        );
        if let Some(hit) = self.cache_get(&key) {
            return Ok(hit);
        }

        let res = self
            .http
            .get(format!("{}{}", self.base_url, mode.path()))
            .header("Authorization", format!("KakaoAK {}", self.api_key))
            .query(&[
                ("start_x", format!("{:.6}", from.lon)),
                ("start_y", format!("{:.6}", from.lat)),
                ("end_x", format!("{:.6}", to.lon)),
                ("end_y", format!("{:.6}", to.lat)),
            ])
            .send()
            .await
            .map_err(|e| RoutingError::Upstream(e.without_url().to_string()))?;

        let status = res.status();
        let body: Value = res.json().await.unwrap_or(Value::Null);
        if status.as_u16() == 429 || body["code"].as_i64() == Some(-10) {
            return Err(RoutingError::QuotaExceeded);
        }
        if !status.is_success() {
            return Err(RoutingError::Upstream(format!("HTTP {status}")));
        }

        let parsed = match mode {
            Mode::Walk => parse_walk(&body),
            Mode::Transit => parse_transit(&body),
        };
        self.cache_put(key, parsed.clone());
        Ok(parsed)
    }

    fn cache_get(&self, key: &str) -> Option<RouteResponse> {
        let map = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        map.get(key)
            .filter(|(at, _)| at.elapsed() < CACHE_TTL)
            .map(|(_, r)| r.clone())
    }

    fn cache_put(&self, key: String, value: RouteResponse) {
        let mut map = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        if map.len() >= CACHE_MAX {
            map.retain(|_, (at, _)| at.elapsed() < CACHE_TTL);
            if map.len() >= CACHE_MAX {
                map.clear();
            }
        }
        map.insert(key, (Instant::now(), value));
    }
}

fn int(v: &Value) -> i64 {
    v.as_i64()
        .or_else(|| v.as_f64().map(|f| f.round() as i64))
        .unwrap_or(0)
}

fn text(v: &Value) -> String {
    v.as_str().unwrap_or_default().trim().to_owned()
}

fn points(v: &Value) -> Vec<[f64; 2]> {
    v["path"]["points"]
        .as_array()
        .map(|pts| {
            pts.iter()
                .filter_map(|p| Some([p.get(0)?.as_f64()?, p.get(1)?.as_f64()?]))
                .collect()
        })
        .unwrap_or_default()
}

/// 카카오 상태 코드 → 사용자 안내
fn status_message(status: &str) -> String {
    match status {
        "SAME_POINT" | "EQUAL_POINTS" => "출발지와 도착지가 같아요.",
        "TOO_FAR_AWAY" => "거리가 너무 멀어 도보 경로를 찾을 수 없어요. 대중교통을 이용해 보세요.",
        "START_LINK_NOT_FOUND" | "STARTNODES_NULL" => "출발지 근처에서 길을 찾지 못했어요.",
        "END_LINK_NOT_FOUND" | "ENDNODES_NULL" => "도착지 근처에서 길을 찾지 못했어요.",
        "NO_RESULTS" => {
            "이용할 수 있는 대중교통 경로가 없어요. 가까운 거리라면 도보 경로를 확인해 보세요."
        }
        _ => "경로를 찾지 못했어요. 카카오맵에서 확인해 주세요.",
    }
    .to_owned()
}

/// 도보 경로 응답 정리
pub fn parse_walk(body: &Value) -> RouteResponse {
    let status = text(&body["status"]);
    let route = &body["route"];
    let mut response = RouteResponse {
        mode: Mode::Walk.as_str(),
        routes: vec![],
        landing_url: Some(text(&route["properties"]["landingUrl"])).filter(|s| !s.is_empty()),
        message: None,
        notices: vec![ROUTE_NOTICE],
    };
    if status != "OK" {
        response.message = Some(status_message(&status));
        return response;
    }
    let steps: Vec<RouteStep> = route["legs"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|leg| leg["steps"].as_array().cloned().unwrap_or_default())
        .map(|s| RouteStep {
            kind: "WALKING".into(),
            guidance: text(&s["properties"]["guidance"]),
            distance_m: int(&s["properties"]["distance"]),
            time_s: int(&s["properties"]["time"]),
            vehicles: vec![],
            stops: vec![],
            path: points(&s),
        })
        .collect();
    response.routes.push(RouteOption {
        kind: "WALK".into(),
        time_s: int(&route["properties"]["totalTime"]),
        distance_m: int(&route["properties"]["totalDistance"]),
        fare: None,
        transfers: None,
        steps,
    });
    response
}

/// 대중교통 경로 응답 정리 (앞에서부터 최대 5개)
pub fn parse_transit(body: &Value) -> RouteResponse {
    let status = text(&body["status"]);
    let mut response = RouteResponse {
        mode: Mode::Transit.as_str(),
        routes: vec![],
        landing_url: Some(text(&body["properties"]["landingURL"])).filter(|s| !s.is_empty()),
        message: None,
        notices: vec![ROUTE_NOTICE, TRANSIT_WALK_NOTICE],
    };
    if status != "OK" {
        response.message = Some(status_message(&status));
        return response;
    }
    for r in body["routes"]
        .as_array()
        .into_iter()
        .flatten()
        .take(MAX_TRANSIT_OPTIONS)
    {
        let p = &r["properties"];
        let steps = r["steps"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|s| {
                let sp = &s["properties"];
                RouteStep {
                    kind: text(&sp["type"]),
                    guidance: text(&sp["guidance"]),
                    distance_m: int(&sp["distance"]),
                    time_s: int(&sp["time"]),
                    vehicles: sp["vehicles"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|v| text(&v["name"]))
                        .filter(|n| !n.is_empty())
                        .collect(),
                    stops: sp["stops"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|v| text(&v["name"]))
                        .filter(|n| !n.is_empty())
                        .collect(),
                    path: points(s),
                }
            })
            .collect();
        response.routes.push(RouteOption {
            kind: text(&p["type"]),
            time_s: int(&p["totalTime"]),
            distance_m: int(&p["totalDistance"]),
            fare: p["fare"]["value"].as_i64(),
            transfers: p["transfers"].as_i64(),
            steps,
        });
    }
    if response.routes.is_empty() {
        response.message = Some(status_message("NO_RESULTS"));
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_walk_route() {
        let body = json!({ "status": "OK", "route": {
            "properties": { "totalDistance": 1656, "totalTime": 1620, "landingUrl": "https://map.kakao.com/x" },
            "legs": [{ "properties": {}, "steps": [
                { "properties": { "distance": 122, "time": 100, "guidance": "122m 이동(세종대로20길)" },
                  "path": { "points": [[126.978, 37.567], [126.977, 37.568]] } },
                { "properties": { "distance": 50, "time": 40, "guidance": "우회전" },
                  "path": { "points": [[126.977, 37.568]] } }
            ]}]
        }});
        let r = parse_walk(&body);
        assert_eq!(r.mode, "walk");
        assert_eq!(r.routes.len(), 1);
        assert_eq!((r.routes[0].time_s, r.routes[0].distance_m), (1620, 1656));
        assert_eq!(r.routes[0].steps.len(), 2);
        assert_eq!(r.routes[0].steps[0].path[0], [126.978, 37.567]);
        assert_eq!(r.landing_url.as_deref(), Some("https://map.kakao.com/x"));
    }

    #[test]
    fn parses_transit_routes_with_fare_vehicles_and_stops() {
        let body = json!({ "status": "OK",
            "properties": { "total": 1, "landingURL": "https://map.kakao.com/t" },
            "routes": [{ "properties": { "type": "SUBWAY", "totalDistance": 12941, "totalTime": 1851, "transfers": 1, "fare": { "value": 2350 } },
                "steps": [
                    { "properties": { "type": "SUBWAY", "guidance": "3호선", "distance": 10200, "time": 1110,
                        "stops": [{ "name": "신사" }, { "name": "경복궁" }], "vehicles": [{ "type": "일반", "name": "3호선" }] },
                      "path": { "points": [[127.02, 37.51], [126.97, 37.57]] } },
                    { "properties": { "type": "WALKING", "guidance": "환승", "distance": 98, "time": 128, "stops": [], "vehicles": [] },
                      "path": { "points": [[126.97, 37.57]] } }
                ]}]
        });
        let r = parse_transit(&body);
        let o = &r.routes[0];
        assert_eq!(
            (o.kind.as_str(), o.fare, o.transfers),
            ("SUBWAY", Some(2350), Some(1))
        );
        assert_eq!(o.steps[0].vehicles, vec!["3호선"]);
        assert_eq!(o.steps[0].stops, vec!["신사", "경복궁"]);
        assert!(o.steps[1].vehicles.is_empty());
        assert!(r.notices.contains(&TRANSIT_WALK_NOTICE));
    }

    #[test]
    fn non_ok_status_gives_friendly_message() {
        let r = parse_walk(&json!({ "status": "TOO_FAR_AWAY" }));
        assert!(r.routes.is_empty());
        assert!(r.message.unwrap().contains("너무 멀어"));
        let t = parse_transit(&json!({ "status": "NO_RESULTS", "properties": {} }));
        assert!(t.message.unwrap().contains("대중교통 경로가 없어요"));
    }

    #[test]
    fn mode_parsing() {
        assert_eq!(Mode::parse("walk"), Some(Mode::Walk));
        assert_eq!(Mode::parse("transit"), Some(Mode::Transit));
        assert_eq!(Mode::parse("car"), None);
    }
}

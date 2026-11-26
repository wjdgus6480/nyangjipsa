//! `GET /api/admin/growth?period=1d|7d|30d|custom&start=YYYY-MM-DD&end=YYYY-MM-DD` — 성장 분석 (관리자만)
//!
//! 노스스타 = 진료비 조회 사용자(`cost_viewed` 고유 사용자). 모든 숫자는 Amplitude 에서만 옵니다.
//! 정의와 이벤트는 `04_docs/08_분석_이벤트_Amplitude.md` "성장 분석" 표.
//!
//! - 기간: 최근 1일(오늘, 시간별 그래프) / 7일 / 30일 / 직접 설정(최대 31일, 일별). 90일은 없음
//! - 이전 기간 = 바로 앞의 같은 길이 기간. 비교할 값이 없으면(이전 0) 증감률을 만들지 않음 (화면이 "비교 불가")
//! - 아직 수집되지 않은 이벤트는 `collected = false` 로 알려 줌 (0 과 구분). 가짜 숫자는 만들지 않음
//! - 섹션(유입·퍼널·병원 이용·유지율)은 따로 실패할 수 있고, 실패한 섹션만 `error` 를 채움
//! - 사용자 = Amplitude 사용자(익명 device_id, 로그인하면 user_id 로 합쳐짐). 로그인 전후가 한 사람으로 세어짐
//!
//! 대시보드(`admin_dashboard.rs`)와 같은 Amplitude 조회는 클라이언트 캐시로 함께 씁니다.

use std::{collections::HashMap, sync::Arc};

use axum::{
    Json,
    extract::{Query, State},
};
use chrono::{DateTime, Days, NaiveDate, Timelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    AppState,
    amplitude::{
        AmplitudeClient, Interval, Metric, RetentionCohort, Segmentation, ev, group_by, today_kst,
        where_is,
    },
    auth::extract::AdminUser,
    error::AppError,
    routes::admin_cache::{Hit, SwrCache},
};

/// 직접 설정 기간 최대 길이 (Amplitude 무료 플랜 조회 비용)
pub const MAX_CUSTOM_DAYS: u64 = 31;
/// 직접 설정 시작일은 이 일수 안 (리텐션 조회 비용)
pub const MAX_LOOKBACK_DAYS: u64 = 180;

/// 진료비 조회 완료 (노스스타)
pub const LOOKUP_EVENT: &str = "cost_viewed";
/// 진료비 조회 전환 퍼널 (서비스 방문 → 진료비 메뉴 진입 → 조회 조건 선택 → 진료비 조회 완료)
pub const FUNNEL_EVENTS: [&str; 4] = [
    "session_start",
    "fee_menu_viewed",
    "fee_filter_selected",
    LOOKUP_EVENT,
];
/// 병원 이용 단계 (hospital_clicked 의 click_type)
pub const HOSPITAL_STEPS: [&str; 3] = ["detail", "call", "route"];

#[derive(Debug, Deserialize)]
pub struct GrowthQuery {
    pub period: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GrowthPeriod {
    pub key: &'static str,
    pub days: u64,
    pub start: NaiveDate,
    pub end: NaiveDate,
    pub prev_start: NaiveDate,
    pub prev_end: NaiveDate,
    /// 그래프 단위: hour(1일) | day
    pub unit: &'static str,
}

impl GrowthPeriod {
    pub fn new(
        key: &str,
        start: Option<&str>,
        end: Option<&str>,
        today: NaiveDate,
    ) -> Result<Self, AppError> {
        let bad = |m: &str| AppError::Validation(m.into());
        let (key, start, end) = match key {
            "1d" => ("1d", today, today),
            "7d" => ("7d", today - Days::new(6), today),
            "30d" => ("30d", today - Days::new(29), today),
            "custom" => {
                let parse = |v: Option<&str>| {
                    v.and_then(|s| NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok())
                        .ok_or_else(|| bad("start, end 는 YYYY-MM-DD 형식이어야 합니다"))
                };
                let (s, e) = (parse(start)?, parse(end)?);
                if s > e {
                    return Err(bad("시작일이 종료일보다 늦습니다"));
                }
                if e > today {
                    return Err(bad("종료일은 오늘 이후일 수 없습니다"));
                }
                if (e - s).num_days() as u64 + 1 > MAX_CUSTOM_DAYS {
                    return Err(bad("직접 설정 기간은 최대 31일입니다"));
                }
                if s < today - Days::new(MAX_LOOKBACK_DAYS) {
                    return Err(bad("시작일은 최근 180일 안이어야 합니다"));
                }
                ("custom", s, e)
            }
            _ => {
                return Err(bad("period 는 1d, 7d, 30d, custom 중 하나여야 합니다"));
            }
        };
        let days = (end - start).num_days() as u64 + 1;
        let prev_end = start - Days::new(1);
        let prev_start = prev_end - Days::new(days - 1);
        Ok(Self {
            key,
            days,
            start,
            end,
            prev_start,
            prev_end,
            unit: if days == 1 { "hour" } else { "day" },
        })
    }

    fn interval(&self) -> Interval {
        if self.unit == "hour" {
            Interval::Hour
        } else {
            Interval::Day
        }
    }

    /// 그래프 칸 키: 일별 `YYYY-MM-DD`, 시간별 `YYYY-MM-DDTHH` (오늘이면 지금 시각까지)
    pub fn buckets(&self, now_hour_kst: u32, today: NaiveDate) -> Vec<String> {
        if self.unit == "hour" {
            let last = if self.end == today { now_hour_kst } else { 23 };
            (0..=last)
                .map(|h| format!("{}T{h:02}", self.start))
                .collect()
        } else {
            self.start
                .iter_days()
                .take_while(|d| *d <= self.end)
                .map(|d| d.to_string())
                .collect()
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq)]
pub struct Compare {
    pub current: f64,
    pub previous: f64,
}

/// 비율 비교 (0~1). 분모(방문자)가 0 이면 None
#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq)]
pub struct RateCompare {
    pub current: Option<f64>,
    pub previous: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Kpis {
    /// 진료비 조회 사용자 (노스스타)
    pub lookup_users: Compare,
    /// 조회 전환율 = 진료비 조회 사용자 ÷ 방문자
    pub conversion: RateCompare,
    /// 진료비 조회 횟수
    pub lookups: Compare,
    /// 재조회 사용자 = 이전 날에 진료비를 본 적 있는 사용자가 다시 조회 (cost_viewed.repeat_view = true)
    pub repeat_users: Compare,
    /// repeat_view 속성이 Amplitude 에 들어온 적 있는지 (false 면 아직 수집 전)
    pub repeat_collected: bool,
    /// 방문자 (아무 이벤트든 보낸 사용자, Amplitude `_active`)
    pub visitors: Compare,
}

#[derive(Debug, Clone, Serialize)]
pub struct Trend {
    /// 그래프 칸 (일별 YYYY-MM-DD, 시간별 YYYY-MM-DDTHH)
    pub buckets: Vec<String>,
    pub lookup_users: Vec<f64>,
    pub visitors: Vec<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Channel {
    /// search | direct | sns | share | referral | campaign
    pub key: &'static str,
    pub users: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Acquisition {
    /// 실제로 사용자가 있는 채널만, 많은 순
    pub channels: Vec<Channel>,
    pub channels_error: Option<String>,
    pub new_users: Compare,
    pub returning_users: Compare,
    pub new_daily: Vec<f64>,
    pub returning_daily: Vec<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Step {
    pub key: &'static str,
    pub users: f64,
    /// 이 단계 이벤트를 계산할 수 있는지 (false = 아직 수집 전이라 0)
    pub collected: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Funnel {
    pub steps: Vec<Step>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HospitalUse {
    /// 상세 조회·전화·길찾기를 한 고유 사용자 (이 기간)
    pub steps: Vec<Step>,
    /// 진료비 조회 후(순서대로) 전화 또는 길찾기까지 한 사용자
    pub after_lookup: Option<f64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct CohortCells {
    pub size: f64,
    /// N일째 다시 온 사용자. None = 아직 그날이 지나지 않음
    pub d1: Option<f64>,
    pub d7: Option<f64>,
    pub d30: Option<f64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CohortRow {
    pub date: String,
    pub new: CohortCells,
    pub returning: CohortCells,
}

#[derive(Debug, Clone, Serialize)]
pub struct Retention {
    pub cohorts: Vec<CohortRow>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GrowthData {
    pub kpis: Kpis,
    pub trend: Trend,
    pub acquisition: Acquisition,
    pub funnel: Funnel,
    pub hospital: HospitalUse,
    pub retention: Retention,
}

#[derive(Debug, Clone, Serialize)]
pub struct GrowthResponse {
    pub period: GrowthPeriod,
    pub generated_at: DateTime<Utc>,
    /// connected | not_configured | error
    pub status: &'static str,
    pub message: Option<String>,
    pub data: Option<GrowthData>,
}

static CACHE: SwrCache<GrowthResponse> = SwrCache::new();

pub async fn growth(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(q): Query<GrowthQuery>,
) -> Result<Json<GrowthResponse>, AppError> {
    let today = today_kst();
    let period = GrowthPeriod::new(
        q.period.as_deref().unwrap_or("7d"),
        q.start.as_deref(),
        q.end.as_deref(),
        today,
    )?;
    let Some(client) = state.amplitude.clone() else {
        return Ok(Json(GrowthResponse {
            period,
            generated_at: Utc::now(),
            status: "not_configured",
            message: Some(
                "서버 .env 에 AMPLITUDE_API_KEY 와 AMPLITUDE_SECRET_KEY 를 넣으면 성장 분석이 표시됩니다".into(),
            ),
            data: None,
        }));
    };
    let key = format!("{}:{}:{}:{}", period.key, period.start, period.end, today);
    match CACHE.lookup(&key) {
        Hit::Fresh(r) => return Ok(Json(r)),
        Hit::Stale(r) => {
            tokio::spawn(async move {
                let fresh = build(client, period).await;
                if fresh.status == "connected" {
                    CACHE.put(&key, fresh);
                } else {
                    CACHE.release(&key);
                }
            });
            return Ok(Json(r));
        }
        Hit::Miss => {}
    }
    let res = build(client, period).await;
    if res.status == "connected" {
        CACHE.put(&key, res.clone());
    }
    Ok(Json(res))
}

async fn build(client: Arc<AmplitudeClient>, period: GrowthPeriod) -> GrowthResponse {
    let data = load(&client, &period).await;
    let (status, message, data) = match data {
        Ok(d) => ("connected", None, Some(d)),
        Err(detail) => {
            tracing::warn!(%detail, "Amplitude 성장 분석 조회 실패");
            (
                "error",
                Some(
                    "Amplitude 에서 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요"
                        .into(),
                ),
                None,
            )
        }
    };
    GrowthResponse {
        period,
        generated_at: Utc::now(),
        status,
        message,
        data,
    }
}

fn kst_hour() -> u32 {
    (Utc::now() + chrono::Duration::hours(9)).hour()
}

/// 칸 키: 시간별은 앞 13자(YYYY-MM-DDTHH), 일별은 앞 10자
fn bucket_values(buckets: &[String], seg: &Segmentation, series: usize) -> Vec<f64> {
    let n = buckets.first().map_or(10, String::len);
    let mut by: HashMap<String, f64> = HashMap::new();
    if let Some(values) = seg.series.get(series) {
        for (x, v) in seg.x.iter().zip(values) {
            *by.entry(x.chars().take(n).collect()).or_default() += v;
        }
    }
    buckets
        .iter()
        .map(|b| by.get(b).copied().unwrap_or(0.0))
        .collect()
}

fn section_err(what: &str, detail: &str) -> Option<String> {
    tracing::warn!(%detail, "Amplitude 성장 분석 {what} 조회 실패 (나머지는 표시)");
    Some(format!(
        "{what} 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요"
    ))
}

async fn load(c: &AmplitudeClient, p: &GrowthPeriod) -> Result<GrowthData, String> {
    let iv = p.interval();
    let (cs, ce, ps, pe) = (p.start, p.end, p.prev_start, p.prev_end);
    let active = ev("_active");
    let new = ev("_new");
    let lookup = ev(LOOKUP_EVENT);
    let repeat = where_is(ev(LOOKUP_EVENT), "repeat_view", &["true"]);
    let channels_q = group_by(
        group_by(ev("_active"), "user", "gp:utm_source"),
        "user",
        "gp:referring_domain",
    );
    let hospital_q = group_by(ev("hospital_clicked"), "event", "click_type");
    let funnel_q: Vec<Value> = FUNNEL_EVENTS.iter().map(|e| ev(e)).collect();
    let after_q = vec![
        ev(LOOKUP_EVENT),
        where_is(ev("hospital_clicked"), "click_type", &["call", "route"]),
    ];
    // 리텐션: 기간 안 코호트 + D30 까지 보려면 기간 끝 + 30일 (오늘을 넘지 않게)
    let today = today_kst();
    let ret_end = (ce + Days::new(30)).min(today);

    // 모두 한꺼번에 요청 (AmplitudeClient 가 동시에 3개까지만 보내고, 이전 기간 결과는 재사용)
    let (
        (active_cur, active_prev, new_cur, new_prev),
        (lookup_cur, lookup_prev, totals_cur, totals_prev),
        (repeat_cur, repeat_prev),
        (channels, funnel, hospital, after),
        (ret_new, ret_all),
    ) = tokio::join!(
        async {
            tokio::join!(
                c.segment(&active, Metric::Uniques, cs, ce, iv),
                c.segment(&active, Metric::Uniques, ps, pe, Interval::Day),
                c.segment(&new, Metric::Uniques, cs, ce, iv),
                c.segment(&new, Metric::Uniques, ps, pe, Interval::Day),
            )
        },
        async {
            tokio::join!(
                c.segment(&lookup, Metric::Uniques, cs, ce, iv),
                c.segment(&lookup, Metric::Uniques, ps, pe, Interval::Day),
                c.segment(&lookup, Metric::Totals, cs, ce, Interval::Day),
                c.segment(&lookup, Metric::Totals, ps, pe, Interval::Day),
            )
        },
        async {
            tokio::join!(
                c.segment(&repeat, Metric::Uniques, cs, ce, Interval::Day),
                c.segment(&repeat, Metric::Uniques, ps, pe, Interval::Day),
            )
        },
        async {
            tokio::join!(
                c.segment(&channels_q, Metric::Uniques, cs, ce, Interval::Day),
                c.funnel_events(&funnel_q, cs, ce),
                c.segment(&hospital_q, Metric::Uniques, cs, ce, Interval::Day),
                c.funnel_events(&after_q, cs, ce),
            )
        },
        async {
            tokio::join!(
                c.retention(&new, &active, cs, ret_end),
                c.retention(&active, &active, cs, ret_end),
            )
        },
    );

    // 핵심 지표가 실패하면 화면 전체를 오류로 (나머지는 섹션별)
    let (active_cur, active_prev, new_cur, new_prev) =
        (active_cur?, active_prev?, new_cur?, new_prev?);
    let (lookup_cur, lookup_prev, totals_cur, totals_prev) =
        (lookup_cur?, lookup_prev?, totals_cur?, totals_prev?);
    let (repeat_cur, repeat_prev) = (repeat_cur?, repeat_prev?);

    let visitors = Compare {
        current: active_cur.total(),
        previous: active_prev.total(),
    };
    let lookup_users = Compare {
        current: lookup_cur.total(),
        previous: lookup_prev.total(),
    };
    let rate = |num: f64, den: f64| (den > 0.0).then(|| num / den);
    let kpis = Kpis {
        lookup_users,
        conversion: RateCompare {
            current: rate(lookup_users.current, visitors.current),
            previous: rate(lookup_users.previous, visitors.previous),
        },
        lookups: Compare {
            current: totals_cur.total(),
            previous: totals_prev.total(),
        },
        repeat_users: Compare {
            current: repeat_cur.total(),
            previous: repeat_prev.total(),
        },
        repeat_collected: repeat_cur.found || repeat_prev.found,
        visitors,
    };

    let buckets = p.buckets(kst_hour(), today);
    let visitors_daily = bucket_values(&buckets, &active_cur, 0);
    let new_daily = bucket_values(&buckets, &new_cur, 0);
    let returning_daily = visitors_daily
        .iter()
        .zip(&new_daily)
        .map(|(a, n)| (a - n).max(0.0))
        .collect();
    let trend = Trend {
        lookup_users: bucket_values(&buckets, &lookup_cur, 0),
        visitors: visitors_daily,
        buckets,
    };

    let (channels, channels_error) = match channels {
        Ok(seg) => (classify_channels(&seg), None),
        Err(e) => (Vec::new(), section_err("유입 채널", &e)),
    };
    let acquisition = Acquisition {
        channels,
        channels_error,
        new_users: Compare {
            current: new_cur.total(),
            previous: new_prev.total(),
        },
        // 기간 안 방문자 중 신규가 아닌 사람 (신규는 기간 안에 처음 온 사람이라 겹치지 않음)
        returning_users: Compare {
            current: (visitors.current - new_cur.total()).max(0.0),
            previous: (visitors.previous - new_prev.total()).max(0.0),
        },
        new_daily,
        returning_daily,
    };

    let funnel = match funnel {
        Ok((values, reach)) => Funnel {
            steps: FUNNEL_EVENTS
                .iter()
                .enumerate()
                .map(|(i, key)| Step {
                    key,
                    users: values.get(i).copied().unwrap_or(0.0),
                    collected: i < reach,
                })
                .collect(),
            error: None,
        },
        Err(e) => Funnel {
            steps: Vec::new(),
            error: section_err("퍼널", &e),
        },
    };

    let hospital = match (hospital, after) {
        (Ok(seg), after) => {
            let by: HashMap<&str, f64> = seg
                .labels
                .iter()
                .map(String::as_str)
                .zip(seg.totals.iter().copied())
                .collect();
            HospitalUse {
                steps: HOSPITAL_STEPS
                    .iter()
                    .map(|key| Step {
                        key,
                        users: by.get(key).copied().unwrap_or(0.0),
                        collected: seg.found,
                    })
                    .collect(),
                after_lookup: after
                    .ok()
                    .filter(|(_, reach)| *reach == 2)
                    .map(|(v, _)| v[1]),
                error: None,
            }
        }
        (Err(e), _) => HospitalUse {
            steps: Vec::new(),
            after_lookup: None,
            error: section_err("병원 이용", &e),
        },
    };

    let retention = match (ret_new, ret_all) {
        (Ok(n), Ok(a)) => Retention {
            cohorts: cohort_rows(&n, &a, p, today),
            error: None,
        },
        (Err(e), _) | (_, Err(e)) => Retention {
            cohorts: Vec::new(),
            error: section_err("유지율", &e),
        },
    };

    Ok(GrowthData {
        kpis,
        trend,
        acquisition,
        funnel,
        hospital,
        retention,
    })
}

/// 유입 채널 분류: utm_source 가 있으면 그것으로, 없으면 들어온 사이트(referring_domain)로
pub fn channel_of(utm_source: &str, referring_domain: &str) -> &'static str {
    let none = |s: &str| {
        let s = s.trim();
        s.is_empty() || s == "(none)" || s == "null" || s == "EMPTY"
    };
    const SEARCH: [&str; 6] = ["naver", "google", "daum", "bing", "zum", "yahoo"];
    const SNS: [&str; 12] = [
        "instagram",
        "facebook",
        "kakao",
        "kakaotalk",
        "youtube",
        "tiktok",
        "twitter",
        "x",
        "threads",
        "band",
        "blog",
        "cafe",
    ];
    if !none(utm_source) {
        let u = utm_source.trim().to_lowercase();
        return if u == "share" {
            "share"
        } else if SEARCH.contains(&u.as_str()) {
            "search"
        } else if SNS.contains(&u.as_str()) {
            "sns"
        } else {
            "campaign"
        };
    }
    if none(referring_domain) {
        return "direct";
    }
    let d = referring_domain.trim().to_lowercase();
    let d = d.trim_start_matches("www.").trim_start_matches("m.");
    let is = |host: &str| d == host || d.ends_with(&format!(".{host}"));
    // 네이버 블로그·카페는 검색보다 SNS(커뮤니티)에 가까움
    if is("blog.naver.com") || is("cafe.naver.com") || is("cafe.daum.net") || is("tistory.com") {
        "sns"
    } else if is("naver.com")
        || d.starts_with("google.")
        || d.contains(".google.")
        || is("daum.net")
        || is("bing.com")
        || is("zum.com")
        || is("yahoo.com")
    {
        "search"
    } else if is("instagram.com")
        || is("facebook.com")
        || is("kakao.com")
        || is("youtube.com")
        || is("youtu.be")
        || is("t.co")
        || is("x.com")
        || is("twitter.com")
        || is("threads.net")
        || is("tiktok.com")
        || is("band.us")
    {
        "sns"
    } else {
        "referral"
    }
}

/// `utm_source; referring_domain` 그룹별 사용자를 채널별로 합침 (0 인 채널은 뺌, 많은 순)
fn classify_channels(seg: &Segmentation) -> Vec<Channel> {
    let mut sum: Vec<(&'static str, f64)> = Vec::new();
    for (label, users) in seg.labels.iter().zip(&seg.totals) {
        if *users <= 0.0 {
            continue;
        }
        let mut parts = label.split(';').map(str::trim);
        let key = channel_of(parts.next().unwrap_or(""), parts.next().unwrap_or(""));
        match sum.iter_mut().find(|(k, _)| *k == key) {
            Some((_, v)) => *v += users,
            None => sum.push((key, *users)),
        }
    }
    sum.sort_by(|a, b| b.1.total_cmp(&a.1));
    sum.into_iter()
        .map(|(key, users)| Channel { key, users })
        .collect()
}

/// 기간 안 코호트별 D1·D7·D30. 재방문 사용자 = 전체 활성 코호트 − 신규 코호트
/// (활성 코호트는 기간 안에서 처음 활동한 날로 묶이고, 신규 사용자는 처음 온 날 = 그날이라 그 부분집합)
fn cohort_rows(
    new: &[RetentionCohort],
    all: &[RetentionCohort],
    p: &GrowthPeriod,
    today: NaiveDate,
) -> Vec<CohortRow> {
    let by_new: HashMap<&str, &RetentionCohort> =
        new.iter().map(|c| (c.date.as_str(), c)).collect();
    let by_all: HashMap<&str, &RetentionCohort> =
        all.iter().map(|c| (c.date.as_str(), c)).collect();
    let empty = RetentionCohort::default();
    p.start
        .iter_days()
        .take_while(|d| *d <= p.end)
        .map(|date| {
            let key = date.to_string();
            let n = by_new.get(key.as_str()).copied().unwrap_or(&empty);
            let a = by_all.get(key.as_str()).copied().unwrap_or(&empty);
            // N일째가 오늘까지 다 지나야 값이 있음
            let day = |c: &RetentionCohort, k: usize| -> Option<f64> {
                if date + Days::new(k as u64) >= today {
                    return None;
                }
                match (c.counts.get(k), c.incomplete.get(k)) {
                    (_, Some(true)) => None,
                    (Some(v), _) => Some(*v),
                    // 코호트가 비었거나 응답에 그날 칸이 없음 = 돌아온 사람 0
                    (None, _) => Some(0.0),
                }
            };
            let cells = |c: &RetentionCohort| CohortCells {
                size: c.size,
                d1: day(c, 1),
                d7: day(c, 7),
                d30: day(c, 30),
            };
            let nc = cells(n);
            let ac = cells(a);
            let minus = |x: Option<f64>, y: Option<f64>| x.zip(y).map(|(x, y)| (x - y).max(0.0));
            CohortRow {
                date: key,
                returning: CohortCells {
                    size: (ac.size - nc.size).max(0.0),
                    d1: minus(ac.d1, nc.d1),
                    d7: minus(ac.d7, nc.d7),
                    d30: minus(ac.d30, nc.d30),
                },
                new: nc,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        s.parse().unwrap()
    }

    #[test]
    fn periods_and_previous_same_length() {
        let t = d("2026-11-26");
        let p = GrowthPeriod::new("7d", None, None, t).unwrap();
        assert_eq!((p.start, p.end, p.days), (d("2026-11-20"), t, 7));
        assert_eq!(
            (p.prev_start, p.prev_end),
            (d("2026-11-13"), d("2026-11-19"))
        );
        assert_eq!(p.unit, "day");

        let one = GrowthPeriod::new("1d", None, None, t).unwrap();
        assert_eq!(
            (one.start, one.prev_start, one.unit),
            (t, d("2026-11-25"), "hour")
        );
        assert_eq!(one.buckets(13, t).len(), 14); // 0~13시
        assert_eq!(one.buckets(13, t)[13], "2026-11-26T13");

        let c = GrowthPeriod::new("custom", Some("2026-11-01"), Some("2026-11-10"), t).unwrap();
        assert_eq!(
            (c.days, c.prev_start, c.prev_end),
            (10, d("2026-10-22"), d("2026-10-31"))
        );
        assert_eq!(c.buckets(0, t).len(), 10);

        // 90일·잘못된 날짜·31일 초과·미래는 거절
        assert!(GrowthPeriod::new("90d", None, None, t).is_err());
        assert!(GrowthPeriod::new("custom", Some("2026-11-10"), Some("2026-11-01"), t).is_err());
        assert!(GrowthPeriod::new("custom", Some("2026-10-01"), Some("2026-11-10"), t).is_err());
        assert!(GrowthPeriod::new("custom", Some("2026-11-20"), Some("2026-11-27"), t).is_err());
        assert!(GrowthPeriod::new("custom", Some("x"), None, t).is_err());
    }

    #[test]
    fn channels_by_utm_then_referrer() {
        assert_eq!(channel_of("share", ""), "share");
        assert_eq!(channel_of("naver", "(none)"), "search");
        assert_eq!(channel_of("instagram", ""), "sns");
        assert_eq!(channel_of("newsletter", ""), "campaign");
        assert_eq!(channel_of("(none)", "(none)"), "direct");
        assert_eq!(channel_of("", "search.naver.com"), "search");
        assert_eq!(channel_of("", "m.blog.naver.com"), "sns");
        assert_eq!(channel_of("", "www.google.co.kr"), "search");
        assert_eq!(channel_of("", "l.instagram.com"), "sns");
        assert_eq!(channel_of("", "example.org"), "referral");

        let seg = Segmentation {
            found: true,
            labels: vec![
                "(none); (none)".into(),
                "(none); search.naver.com".into(),
                "naver; (none)".into(),
                "share; (none)".into(),
                "(none); instagram.com".into(),
            ],
            totals: vec![5.0, 2.0, 1.0, 0.0, 4.0],
            ..Default::default()
        };
        let ch = classify_channels(&seg);
        let pairs: Vec<(&str, f64)> = ch.iter().map(|c| (c.key, c.users)).collect();
        // 0 명인 공유 채널은 빠짐
        assert_eq!(pairs, vec![("direct", 5.0), ("sns", 4.0), ("search", 3.0)]);
    }

    #[test]
    fn buckets_align_hourly_and_daily_values() {
        let seg = Segmentation {
            found: true,
            x: vec!["2026-11-26T01:00:00".into(), "2026-11-26T03:00:00".into()],
            series: vec![vec![2.0, 5.0]],
            totals: vec![6.0],
            ..Default::default()
        };
        let b: Vec<String> = (0..4).map(|h| format!("2026-11-26T{h:02}")).collect();
        assert_eq!(bucket_values(&b, &seg, 0), vec![0.0, 2.0, 0.0, 5.0]);
        let days = vec!["2026-11-26".to_string()];
        assert_eq!(bucket_values(&days, &seg, 0), vec![7.0]);
    }

    #[test]
    fn cohorts_split_new_and_returning_and_hide_unfinished_days() {
        let today = d("2026-11-26");
        let p = GrowthPeriod::new("custom", Some("2026-11-24"), Some("2026-11-25"), today).unwrap();
        let c = |date: &str, counts: Vec<f64>| RetentionCohort {
            date: date.into(),
            size: counts[0],
            incomplete: vec![false; counts.len()],
            counts,
        };
        let new = vec![c("2026-11-24", vec![4.0, 1.0])];
        let all = vec![c("2026-11-24", vec![10.0, 5.0]), c("2026-11-25", vec![3.0])];
        let rows = cohort_rows(&new, &all, &p, today);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].new.size, 4.0);
        assert_eq!(rows[0].new.d1, Some(1.0));
        assert_eq!(rows[0].returning.size, 6.0);
        assert_eq!(rows[0].returning.d1, Some(4.0));
        // 7일째·30일째는 아직 오지 않음
        assert_eq!(rows[0].new.d7, None);
        // 11/25 코호트의 1일째 = 오늘 → 아직 집계 전
        assert_eq!(rows[1].new.d1, None);
        assert_eq!(rows[1].returning.size, 3.0);
    }
}

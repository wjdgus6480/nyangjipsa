//! `GET /api/admin/dashboard?period=today|7d|30d|90d` — 관리자 대시보드 숫자 (관리자만)
//!
//! - Amplitude: 핵심 이벤트 5개(+ 활성 사용자)의 고유 사용자 수·일별 추이·퍼널·유입 경로·병원 순위
//!   (`AMPLITUDE_API_KEY`·`AMPLITUDE_SECRET_KEY` 가 없으면 `status = not_configured` 로 비워서 보냄)
//! - PostgreSQL: 회원·가입·공유 링크·병원 수 (항상)
//! - 이전 기간 = 바로 앞의 같은 길이 기간 (오늘이면 어제). 날짜는 한국 시간(Asia/Seoul)
//! - 가짜 값은 만들지 않습니다. 데이터가 없으면 0 또는 빈 배열이고, 화면이 "데이터 없음" 으로 보여 줍니다.
//! - Amplitude 요청 비용 때문에 기간별 결과를 5분간 메모리에 캐시합니다.

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use axum::{
    Json,
    extract::{Query, State},
};
use chrono::{DateTime, Days, FixedOffset, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::{
    AppState,
    amplitude::{AmplitudeClient, Metric, Segmentation},
    auth::extract::AdminUser,
    error::AppError,
    routes::stats,
};

const CACHE_TTL: Duration = Duration::from_secs(300);

/// 퍼널 순서 (04_docs/08_분석_이벤트_Amplitude.md 의 핵심 이벤트 5개)
pub const FUNNEL_EVENTS: [&str; 5] = [
    "landing_viewed",
    "consult_started",
    "consult_completed",
    "hospital_clicked",
    "result_shared",
];
/// Amplitude 기본 이벤트: 그날 어떤 이벤트든 보낸 사용자 (일일 활성 사용자)
const ACTIVE_EVENT: &str = "_active";

#[derive(Debug, Deserialize)]
pub struct DashboardQuery {
    pub period: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PeriodInfo {
    pub key: &'static str,
    pub days: u64,
    pub start: NaiveDate,
    pub end: NaiveDate,
    pub prev_start: NaiveDate,
    pub prev_end: NaiveDate,
    /// 그래프 시작일. 이전 기간 시작일과 같거나(7일 이상) 더 이릅니다(오늘: 최근 14일)
    pub chart_start: NaiveDate,
}

impl PeriodInfo {
    pub fn new(key: &str, today: NaiveDate) -> Result<Self, AppError> {
        let (key, days) = match key {
            "today" => ("today", 1),
            "7d" => ("7d", 7),
            "30d" => ("30d", 30),
            "90d" => ("90d", 90),
            _ => {
                return Err(AppError::Validation(
                    "period 는 today, 7d, 30d, 90d 중 하나여야 합니다".into(),
                ));
            }
        };
        let start = today - Days::new(days - 1);
        let prev_end = start - Days::new(1);
        let prev_start = prev_end - Days::new(days - 1);
        let chart_start = prev_start.min(today - Days::new(13));
        Ok(Self {
            key,
            days,
            start,
            end: today,
            prev_start,
            prev_end,
            chart_start,
        })
    }

    /// 그래프 날짜 목록 (chart_start ~ end)
    pub fn chart_dates(&self) -> Vec<NaiveDate> {
        self.chart_start
            .iter_days()
            .take_while(|d| *d <= self.end)
            .collect()
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct Compare {
    pub current: f64,
    pub previous: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MetricSeries {
    /// 이벤트 이름. 활성 사용자는 `active_users`
    pub key: String,
    /// 기간 중 고유 사용자 수
    pub current: f64,
    pub previous: f64,
    /// 그래프 날짜별 일일 고유 사용자 수
    pub daily: Vec<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LabeledValue {
    pub label: String,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TopHospital {
    pub hospital_id: i64,
    /// DB 에서 삭제(폐업)된 병원이면 None
    pub name: Option<String>,
    pub region: Option<String>,
    pub clicks: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AmplitudeData {
    pub metrics: Vec<MetricSeries>,
    /// 퍼널 단계별 누적 사용자 (FUNNEL_EVENTS 순서)
    pub funnel: Vec<FunnelStep>,
    /// 첫 화면(landing_viewed) 사용자의 utm_source 별 고유 사용자 (현재 기간). `(none)` → `direct`
    pub sources: Vec<LabeledValue>,
    /// 병원 연결(hospital_clicked) 횟수 상위 병원 (현재 기간)
    pub top_hospitals: Vec<TopHospital>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FunnelStep {
    pub key: &'static str,
    pub current: f64,
    pub previous: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AmplitudeSection {
    /// connected | not_configured | error
    pub status: &'static str,
    pub message: Option<String>,
    pub data: Option<AmplitudeData>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DbSection {
    /// 정상(active) 일반 회원 수 (관리자 제외)
    pub members_total: i64,
    /// 기간 중 가입(일반 회원, 탈퇴 포함)
    pub signups: Compare,
    /// 그래프 날짜별 가입 수
    pub signups_daily: Vec<i64>,
    /// 기간 중 새로 만들어진 병원 공유 링크 (같은 병원·채널은 하나라 "처음 공유된 병원 수" 에 가까움)
    pub share_links: Compare,
    /// 공유 링크가 열린 횟수 누적 (봇 제외)
    pub share_opens_total: i64,
    pub hospitals: i64,
    pub cat_friendly: i64,
    pub data_updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DashboardResponse {
    pub period: PeriodInfo,
    /// 그래프 날짜 (YYYY-MM-DD)
    pub dates: Vec<NaiveDate>,
    pub generated_at: DateTime<Utc>,
    pub amplitude: AmplitudeSection,
    pub db: DbSection,
}

static CACHE: Mutex<Option<HashMap<&'static str, (Instant, DashboardResponse)>>> = Mutex::new(None);

pub fn today_kst() -> NaiveDate {
    let kst = FixedOffset::east_opt(9 * 3600).expect("KST");
    Utc::now().with_timezone(&kst).date_naive()
}

pub async fn dashboard(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(q): Query<DashboardQuery>,
) -> Result<Json<DashboardResponse>, AppError> {
    let period = PeriodInfo::new(q.period.as_deref().unwrap_or("7d"), today_kst())?;
    if let Some((at, r)) = CACHE
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|m| m.get(period.key))
        && at.elapsed() < CACHE_TTL
        && r.period.end == period.end
    {
        return Ok(Json(r.clone()));
    }

    let dates = period.chart_dates();
    let db = load_db(&state.pool, &period, &dates).await?;
    let amplitude = match &state.amplitude {
        None => AmplitudeSection {
            status: "not_configured",
            message: Some(
                "서버 .env 에 AMPLITUDE_API_KEY 와 AMPLITUDE_SECRET_KEY 를 넣으면 행동 데이터가 표시됩니다".into(),
            ),
            data: None,
        },
        Some(client) => match load_amplitude(client, &state.pool, &period, &dates).await {
            Ok(data) => AmplitudeSection {
                status: "connected",
                message: None,
                data: Some(data),
            },
            Err(detail) => {
                tracing::warn!(%detail, "Amplitude 대시보드 조회 실패");
                AmplitudeSection {
                    status: "error",
                    message: Some(
                        "Amplitude 에서 데이터를 가져오지 못했습니다. 키·데이터센터(EU) 설정을 확인하거나 잠시 후 다시 시도해 주세요".into(),
                    ),
                    data: None,
                }
            }
        },
    };

    let res = DashboardResponse {
        period,
        dates,
        generated_at: Utc::now(),
        amplitude,
        db,
    };
    // 실패 응답은 캐시하지 않음 (다음 새로고침에서 다시 시도)
    if res.amplitude.status != "error" {
        CACHE
            .lock()
            .unwrap()
            .get_or_insert_with(HashMap::new)
            .insert(res.period.key, (Instant::now(), res.clone()));
    }
    Ok(Json(res))
}

async fn load_db(
    pool: &PgPool,
    p: &PeriodInfo,
    dates: &[NaiveDate],
) -> Result<DbSection, AppError> {
    let members_total: i64 =
        sqlx::query_scalar("SELECT count(*) FROM users WHERE role = 'user' AND status = 'active'")
            .fetch_one(pool)
            .await?;

    let daily: Vec<(NaiveDate, i64)> = sqlx::query_as(
        "SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS day, count(*)
           FROM users
          WHERE role = 'user'
            AND (created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1 AND $2
          GROUP BY 1",
    )
    .bind(p.chart_start)
    .bind(p.end)
    .fetch_all(pool)
    .await?;
    let by_day: HashMap<NaiveDate, i64> = daily.into_iter().collect();
    let sum = |from: NaiveDate, to: NaiveDate| -> f64 {
        by_day
            .iter()
            .filter(|(d, _)| **d >= from && **d <= to)
            .map(|(_, c)| *c as f64)
            .sum()
    };
    let signups = Compare {
        current: sum(p.start, p.end),
        previous: sum(p.prev_start, p.prev_end),
    };
    let signups_daily = dates
        .iter()
        .map(|d| by_day.get(d).copied().unwrap_or(0))
        .collect();

    let (share_cur, share_prev, share_opens_total): (i64, i64, i64) = sqlx::query_as(
        "SELECT
            count(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1 AND $2),
            count(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $3 AND $4),
            coalesce(sum(open_count), 0)::bigint
           FROM share_links",
    )
    .bind(p.start)
    .bind(p.end)
    .bind(p.prev_start)
    .bind(p.prev_end)
    .fetch_one(pool)
    .await?;

    let s = stats::load(pool).await?;
    Ok(DbSection {
        members_total,
        signups,
        signups_daily,
        share_links: Compare {
            current: share_cur as f64,
            previous: share_prev as f64,
        },
        share_opens_total,
        hospitals: s.hospitals,
        cat_friendly: s.cat_friendly,
        data_updated_at: s.data_updated_at,
    })
}

/// 일별 값을 그래프 날짜에 맞춤 (없는 날은 0)
fn daily_on(dates: &[NaiveDate], parts: &[&Segmentation]) -> Vec<f64> {
    let mut by_day: HashMap<String, f64> = HashMap::new();
    for seg in parts {
        if let Some(values) = seg.series.first() {
            for (d, v) in seg.dates.iter().zip(values) {
                *by_day.entry(d.clone()).or_default() += v;
            }
        }
    }
    dates
        .iter()
        .map(|d| by_day.get(&d.to_string()).copied().unwrap_or(0.0))
        .collect()
}

async fn load_amplitude(
    client: &AmplitudeClient,
    pool: &PgPool,
    p: &PeriodInfo,
    dates: &[NaiveDate],
) -> Result<AmplitudeData, String> {
    let empty = Segmentation::default();
    let mut metrics = Vec::new();
    // 이벤트마다 현재·이전 기간(+ 오늘 보기일 때 그래프용 앞 기간)을 동시에 요청 (Amplitude 동시 요청 상한 5 이하)
    for event in std::iter::once(ACTIVE_EVENT).chain(FUNNEL_EVENTS) {
        let extra = async {
            if p.chart_start < p.prev_start {
                client
                    .segmentation(
                        event,
                        Metric::Uniques,
                        p.chart_start,
                        p.prev_start - Days::new(1),
                        None,
                    )
                    .await
                    .map(Some)
            } else {
                Ok(None)
            }
        };
        let (cur, prev, extra) = tokio::join!(
            client.segmentation(event, Metric::Uniques, p.start, p.end, None),
            client.segmentation(event, Metric::Uniques, p.prev_start, p.prev_end, None),
            extra,
        );
        let (cur, prev, extra) = (cur?, prev?, extra?);
        let extra = extra.unwrap_or_else(|| empty.clone());
        metrics.push(MetricSeries {
            key: if event == ACTIVE_EVENT {
                "active_users".into()
            } else {
                event.into()
            },
            current: cur.totals.first().copied().unwrap_or(0.0),
            previous: prev.totals.first().copied().unwrap_or(0.0),
            daily: daily_on(dates, &[&extra, &prev, &cur]),
        });
    }

    let (fun_cur, fun_prev, hospitals, sources) = tokio::join!(
        client.funnel(&FUNNEL_EVENTS, p.start, p.end),
        client.funnel(&FUNNEL_EVENTS, p.prev_start, p.prev_end),
        client.segmentation(
            "hospital_clicked",
            Metric::Totals,
            p.start,
            p.end,
            Some("hospital_id")
        ),
        client.segmentation(
            "landing_viewed",
            Metric::Uniques,
            p.start,
            p.end,
            Some("utm_source")
        ),
    );
    let (fun_cur, fun_prev) = (fun_cur?, fun_prev?);
    let funnel = FUNNEL_EVENTS
        .iter()
        .enumerate()
        .map(|(i, key)| FunnelStep {
            key,
            current: fun_cur[i],
            previous: fun_prev[i],
        })
        .collect();

    let sources = group_values(&sources?)
        .into_iter()
        .map(|(label, value)| LabeledValue {
            label: if label.is_empty() || label == "(none)" {
                "direct".into()
            } else {
                label
            },
            value,
        })
        .collect();

    let mut clicks: Vec<(i64, f64)> = group_values(&hospitals?)
        .into_iter()
        .filter_map(|(id, v)| id.parse::<i64>().ok().map(|id| (id, v)))
        .collect();
    clicks.truncate(5);
    let ids: Vec<i64> = clicks.iter().map(|(id, _)| *id).collect();
    let rows: Vec<(i64, String, Option<String>, Option<String>)> =
        sqlx::query_as("SELECT id, name, sido, sigungu FROM hospitals WHERE id = ANY($1)")
            .bind(&ids)
            .fetch_all(pool)
            .await
            .map_err(|e| format!("병원 이름 조회 실패: {e}"))?;
    let names: HashMap<i64, (String, Option<String>)> = rows
        .into_iter()
        .map(|(id, name, sido, sigungu)| {
            let region = match (sido, sigungu) {
                (Some(a), Some(b)) => Some(format!("{a} {b}")),
                (a, b) => a.or(b),
            };
            (id, (name, region))
        })
        .collect();
    let top_hospitals = clicks
        .into_iter()
        .map(|(id, clicks)| {
            let (name, region) = names.get(&id).cloned().unzip();
            TopHospital {
                hospital_id: id,
                name,
                region: region.flatten(),
                clicks,
            }
        })
        .collect();

    Ok(AmplitudeData {
        metrics,
        funnel,
        sources,
        top_hospitals,
    })
}

/// 그룹별 기간 합계, 큰 순서. 0 은 버림
fn group_values(seg: &Segmentation) -> Vec<(String, f64)> {
    let mut out: Vec<(String, f64)> = seg
        .labels
        .iter()
        .cloned()
        .zip(seg.totals.iter().copied())
        .filter(|(_, v)| *v > 0.0)
        .collect();
    out.sort_by(|a, b| b.1.total_cmp(&a.1));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        s.parse().unwrap()
    }

    #[test]
    fn periods_compare_with_the_same_length_just_before() {
        let p = PeriodInfo::new("7d", d("2026-11-26")).unwrap();
        assert_eq!((p.start, p.end), (d("2026-11-20"), d("2026-11-26")));
        assert_eq!(
            (p.prev_start, p.prev_end),
            (d("2026-11-13"), d("2026-11-19"))
        );
        assert_eq!(p.chart_start, d("2026-11-13"));
        assert_eq!(p.chart_dates().len(), 14);

        let t = PeriodInfo::new("today", d("2026-11-26")).unwrap();
        assert_eq!(
            (t.start, t.prev_start, t.prev_end),
            (d("2026-11-26"), d("2026-11-25"), d("2026-11-25"))
        );
        // 오늘 보기도 그래프는 최근 14일
        assert_eq!(t.chart_start, d("2026-11-13"));

        let q = PeriodInfo::new("90d", d("2026-11-26")).unwrap();
        assert_eq!(q.chart_dates().len(), 180);
        assert!(PeriodInfo::new("1y", d("2026-11-26")).is_err());
    }

    #[test]
    fn daily_values_fill_missing_days_with_zero() {
        let seg = Segmentation {
            dates: vec!["2026-11-25".into()],
            labels: vec![String::new()],
            series: vec![vec![4.0]],
            totals: vec![4.0],
        };
        let dates = [d("2026-11-24"), d("2026-11-25")];
        assert_eq!(daily_on(&dates, &[&seg]), vec![0.0, 4.0]);
    }

    #[test]
    fn group_values_sorted_without_zero() {
        let seg = Segmentation {
            dates: vec![],
            labels: vec!["a".into(), "b".into(), "c".into()],
            series: vec![vec![], vec![], vec![]],
            totals: vec![1.0, 0.0, 5.0],
        };
        assert_eq!(
            group_values(&seg),
            vec![("c".into(), 5.0), ("a".into(), 1.0)]
        );
    }
}

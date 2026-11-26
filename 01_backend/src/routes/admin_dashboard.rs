//! `GET /api/admin/dashboard?period=today|7d|30d` — 관리자 대시보드 숫자 (관리자만)
//!
//! 90일 보기는 뺐습니다: Amplitude 무료 플랜의 동시 조회 비용 한도에 자주 걸리고(429), 서비스 초기라 데이터도 없음
//!
//! - Amplitude: 핵심 이벤트 5개(+ 활성 사용자)의 고유 사용자 수·일별 추이·퍼널·병원 순위
//!   노스스타 = 진료비 조회(`cost_viewed`) 고유 사용자.
//!   유입 경로·진료비 조회 퍼널·병원 이용·유지율은 성장 분석(`admin_growth.rs`)에서 자세히 봅니다.
//!   (`AMPLITUDE_API_KEY`·`AMPLITUDE_SECRET_KEY` 가 없으면 `status = not_configured` 로 비워서 보냄)
//! - PostgreSQL: 회원·가입·공유 링크·병원 수 (항상)
//! - 이전 기간 = 바로 앞의 같은 길이 기간 (오늘이면 어제). 날짜는 한국 시간(Asia/Seoul)
//! - 가짜 값은 만들지 않습니다. 데이터가 없으면 0 또는 빈 배열이고, 화면이 "데이터 없음" 으로 보여 줍니다.
//! - 기간별 결과를 캐시합니다 (`admin_cache`: 5분 안은 그대로, 1시간 안은 먼저 보여 주고 뒤에서 새로 집계).
//!   Amplitude 조회는 동시에 3개까지 보내고, 지난 날짜 조회 결과는 6시간 재사용합니다 (`amplitude.rs`).

use std::{collections::HashMap, sync::Arc};

use axum::{
    Json,
    extract::{Query, State},
};
use chrono::{DateTime, Days, NaiveDate, Utc};
use futures_util::future::join_all;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

pub use crate::amplitude::today_kst;
use crate::{
    AppState,
    amplitude::{AmplitudeClient, Metric, Segmentation},
    auth::extract::AdminUser,
    error::AppError,
    routes::{
        admin_cache::{Hit, SwrCache},
        stats,
    },
};

/// 퍼널 순서 (04_docs/08_분석_이벤트_Amplitude.md 의 핵심 이벤트 5개).
/// 첫 화면 → AI 상담 → 상담 완료 → 진료비 조회(노스스타) → 병원 연결
pub const FUNNEL_EVENTS: [&str; 5] = [
    "landing_viewed",
    "consult_started",
    "consult_completed",
    "cost_viewed",
    "hospital_clicked",
];
/// 노스스타 이벤트: 진료비 조회
pub const NORTH_STAR: &str = "cost_viewed";
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
            _ => {
                return Err(AppError::Validation(
                    "period 는 today, 7d, 30d 중 하나여야 합니다".into(),
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
    /// 퍼널 단계별 누적 사용자 (FUNNEL_EVENTS 순서). 퍼널 조회만 실패하면 비어 있고 funnel_error 에 이유
    pub funnel: Vec<FunnelStep>,
    /// 퍼널 조회 실패 (나머지 대시보드는 그대로 보여 줌)
    pub funnel_error: Option<String>,
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

static CACHE: SwrCache<DashboardResponse> = SwrCache::new();

pub async fn dashboard(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(q): Query<DashboardQuery>,
) -> Result<Json<DashboardResponse>, AppError> {
    let period = PeriodInfo::new(q.period.as_deref().unwrap_or("7d"), today_kst())?;
    // 날짜가 바뀌면 다른 키 (어제 집계를 오늘 것으로 보여 주지 않음)
    let key = format!("{}:{}", period.key, period.end);
    match CACHE.lookup(&key) {
        Hit::Fresh(r) => return Ok(Json(r)),
        Hit::Stale(r) => {
            // 지난 집계를 바로 돌려주고, 새 집계는 뒤에서
            tokio::spawn(async move {
                match build(&state, period).await {
                    Ok(fresh) if fresh.amplitude.status != "error" => CACHE.put(&key, fresh),
                    _ => CACHE.release(&key),
                }
            });
            return Ok(Json(r));
        }
        Hit::Miss => {}
    }
    let res = build(&state, period).await?;
    // 실패 응답은 캐시하지 않음 (다음 새로고침에서 다시 시도)
    if res.amplitude.status != "error" {
        CACHE.put(&key, res.clone());
    }
    Ok(Json(res))
}

async fn build(state: &AppState, period: PeriodInfo) -> Result<DashboardResponse, AppError> {
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
        Some(client) => match load_amplitude(client.clone(), &state.pool, &period, &dates).await
        {
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
    Ok(DashboardResponse {
        period,
        dates,
        generated_at: Utc::now(),
        amplitude,
        db,
    })
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
    client: Arc<AmplitudeClient>,
    pool: &PgPool,
    p: &PeriodInfo,
    dates: &[NaiveDate],
) -> Result<AmplitudeData, String> {
    let c = &*client;
    // 이벤트마다 현재·이전 기간(+ 오늘 보기일 때 그래프용 앞 기간).
    // 한꺼번에 요청해도 AmplitudeClient 가 동시에 3개까지만 보내고, 지난 기간 결과는 재사용합니다.
    // (예전에는 20여 개를 하나씩 차례로 보내 첫 화면이 수십 초 걸렸음)
    let events: Vec<&str> = std::iter::once(ACTIVE_EVENT).chain(FUNNEL_EVENTS).collect();
    let per_event = events.iter().map(|&event| async move {
        let (cur, prev, extra) = tokio::join!(
            c.segmentation(event, Metric::Uniques, p.start, p.end, None),
            c.segmentation(event, Metric::Uniques, p.prev_start, p.prev_end, None),
            async {
                if p.chart_start < p.prev_start {
                    c.segmentation(
                        event,
                        Metric::Uniques,
                        p.chart_start,
                        p.prev_start - Days::new(1),
                        None,
                    )
                    .await
                } else {
                    Ok(Segmentation::default())
                }
            },
        );
        let (cur, prev, extra) = (cur?, prev?, extra?);
        Ok::<_, String>(MetricSeries {
            key: if event == ACTIVE_EVENT {
                "active_users".into()
            } else {
                event.into()
            },
            current: cur.total(),
            previous: prev.total(),
            daily: daily_on(dates, &[&extra, &prev, &cur]),
        })
    });
    let (metrics, hospitals) = tokio::join!(
        join_all(per_event),
        c.segmentation(
            "hospital_clicked",
            Metric::Totals,
            p.start,
            p.end,
            Some("hospital_id"),
        )
    );
    let metrics = metrics.into_iter().collect::<Result<Vec<_>, _>>()?;

    // 순서 퍼널은 데이터가 없는 단계부터 뒤는 모두 0 이므로, 데이터가 있는 앞 단계까지만 조회
    let reach = FUNNEL_EVENTS
        .iter()
        .take_while(|ev| {
            metrics
                .iter()
                .find(|m| m.key == **ev)
                .is_some_and(|m| m.current > 0.0 || m.previous > 0.0)
        })
        .count();
    // 퍼널 조회가 실패해도 대시보드 전체를 오류로 만들지 않고 퍼널 칸만 비움
    let funnels = if reach == 0 {
        Ok((Vec::new(), Vec::new()))
    } else {
        let steps = &FUNNEL_EVENTS[..reach];
        let (cur, prev) = tokio::join!(
            c.funnel(steps, p.start, p.end),
            c.funnel(steps, p.prev_start, p.prev_end)
        );
        cur.and_then(|cur| prev.map(|prev| (cur, prev)))
    };
    let (funnel_ok, funnel_error) = match funnels {
        Ok(f) => (Some(f), None),
        Err(detail) => {
            tracing::warn!(%detail, "Amplitude 퍼널 조회 실패 (나머지는 표시)");
            (
                None,
                Some("퍼널 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요".to_string()),
            )
        }
    };
    let funnel = match funnel_ok {
        None => Vec::new(),
        Some((mut fun_cur, mut fun_prev)) => {
            fun_cur.resize(FUNNEL_EVENTS.len(), 0.0);
            fun_prev.resize(FUNNEL_EVENTS.len(), 0.0);
            FUNNEL_EVENTS
                .iter()
                .enumerate()
                .map(|(i, key)| FunnelStep {
                    key,
                    current: fun_cur[i],
                    previous: fun_prev[i],
                })
                .collect()
        }
    };

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
        funnel_error,
        top_hospitals,
    })
}

/// 그룹별 기간 합계, 큰 순서. 0 은 버림
pub fn group_values(seg: &Segmentation) -> Vec<(String, f64)> {
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

        let m = PeriodInfo::new("30d", d("2026-11-26")).unwrap();
        assert_eq!(m.chart_dates().len(), 60);
        // 90일 보기는 뺐음
        assert!(PeriodInfo::new("90d", d("2026-11-26")).is_err());
        assert!(PeriodInfo::new("1y", d("2026-11-26")).is_err());
    }

    #[test]
    fn north_star_is_fee_lookup_inside_the_funnel() {
        assert_eq!(NORTH_STAR, "cost_viewed");
        assert!(FUNNEL_EVENTS.contains(&NORTH_STAR));
    }

    #[test]
    fn daily_values_fill_missing_days_with_zero() {
        let seg = Segmentation {
            dates: vec!["2026-11-25".into()],
            labels: vec![String::new()],
            series: vec![vec![4.0]],
            totals: vec![4.0],
            ..Default::default()
        };
        let dates = [d("2026-11-24"), d("2026-11-25")];
        assert_eq!(daily_on(&dates, &[&seg]), vec![0.0, 4.0]);
    }

    #[test]
    fn group_values_sorted_without_zero() {
        let seg = Segmentation {
            labels: vec!["a".into(), "b".into(), "c".into()],
            series: vec![vec![], vec![], vec![]],
            totals: vec![1.0, 0.0, 5.0],
            ..Default::default()
        };
        assert_eq!(
            group_values(&seg),
            vec![("c".into(), 5.0), ("a".into(), 1.0)]
        );
    }
}

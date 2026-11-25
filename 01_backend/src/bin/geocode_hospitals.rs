use anyhow::Context;
use nyangjipsa_api::{collector, config::Config, db, fees, geocode};

/// 좌표가 없는 영업 중 동물병원의 좌표를 주소로 채우고(카카오 로컬), 지도용 `hospitals` 를 갱신합니다.
/// 실행 (01_backend 에서):
///   cargo run --bin geocode_hospitals -- [--dry-run] [--limit 500]
///
/// - --dry-run: 대상 병원 수만 보여 주고 아무것도 바꾸지 않음
/// - 채운 뒤 하는 일은 공공데이터 동기화와 같습니다: 병원 파생(신규 병원 추가), 가격이 없는 신규 병원만 더미 가격 채우기.
///   기존 병원의 좌표·가격은 바뀌지 않습니다.
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let dry_run = args.iter().any(|a| a == "--dry-run");
    let limit: i64 = args
        .iter()
        .position(|a| a == "--limit")
        .and_then(|i| args.get(i + 1))
        .map(|v| v.parse())
        .transpose()
        .context("--limit 는 숫자여야 합니다")?
        .unwrap_or(500);

    let cfg = Config::from_env()?;
    let pool = db::connect(&cfg.database_url)
        .await
        .context("DB 연결 실패")?;

    let missing = geocode::count_missing(&pool).await?;
    println!("좌표가 없는 영업 중 동물병원: {missing}곳");
    if dry_run || missing == 0 {
        return Ok(());
    }
    let key = cfg
        .kakao_rest_api_key
        .context(".env 에 KAKAO_REST_API_KEY 가 없습니다")?;
    let geocoder = geocode::Geocoder::new(key)?;

    let stats = geocode::fill_missing_hospital_locations(&pool, &geocoder, limit).await?;
    println!(
        "주소→좌표: 시도 {} / 채움 {} / 실패 {} (실패한 곳은 30일 뒤 다시 시도)",
        stats.tried, stats.filled, stats.failed
    );
    if stats.filled > 0 {
        let h = collector::sync_hospitals_from_businesses(&pool).await?;
        let n = fees::fill_missing_dummy_fees(&pool).await?;
        println!(
            "병원 갱신(hospitals): 저장 {} / 폐업 삭제 {} | 신규 병원 더미 진료비 {n}건 (기존 가격 유지)",
            h.upserted, h.removed
        );
        println!("→ 고양이 친화병원 연결도 다시 하려면: cargo run --bin import_cat_friendly");
    }
    Ok(())
}

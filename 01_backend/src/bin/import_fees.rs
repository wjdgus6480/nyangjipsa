use std::path::PathBuf;

use anyhow::{Context, bail};
use nyangjipsa_api::{config::Config, db, fees};

/// 진료비 xlsx 적재 + 병원별 더미 가격 채우기.
/// 실행: cargo run --bin import_fees -- "<xlsx 경로>" [--regenerate]
///
/// 기본: 가격이 없는 (병원, 항목)에만 더미 가격을 채우고 기존 가격은 유지합니다.
/// --regenerate: 기존 더미 가격을 모두 지우고 새로 만듭니다. (가격이 바뀝니다!)
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let regenerate = args.iter().any(|a| a == "--regenerate");
    let Some(path) = args
        .iter()
        .find(|a| !a.starts_with("--"))
        .map(PathBuf::from)
    else {
        bail!("사용법: import_fees <xlsx 경로> [--regenerate]");
    };
    let cfg = Config::from_env()?;
    let pool = db::connect(&cfg.database_url)
        .await
        .context("DB 연결 실패")?;

    let regional = fees::import_region_fees(&pool, &path).await?;
    println!("지역 진료비(고양이, 시군구 평균) {regional} 행 저장");

    if regenerate {
        let n = fees::generate_dummy_hospital_fees(&pool).await?;
        println!("병원별 더미 진료비 {n} 행을 새로 생성 (기존 더미 가격은 삭제됨)");
    } else {
        let n = fees::fill_missing_dummy_fees(&pool).await?;
        println!("가격이 없던 항목 {n} 행만 더미로 추가 (기존 가격 유지)");
    }
    Ok(())
}

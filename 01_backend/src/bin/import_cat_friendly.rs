use std::path::PathBuf;

use anyhow::Context;
use nyangjipsa_api::{
    cat_friendly::{self, DEFAULT_CERTIFIER, MatchResult},
    config::Config,
    db,
};

/// 고양이 친화병원 인증 목록 적재.
/// 실행 (01_backend 에서):
///   cargo run --bin import_cat_friendly -- [CSV 경로] [--dry-run] [--certifier ISFM]
///
/// - CSV 기본값: ../05_data/03_고양이친화병원/isfm_cat_friendly_hospitals.csv (열: sido,name,external_id)
/// - --dry-run: 매칭 결과만 출력하고 DB 는 바꾸지 않음
/// - `cat_friendly_hospitals` 만 바꿉니다. 병원·진료비 데이터는 읽기만 합니다.
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let dry_run = args.iter().any(|a| a == "--dry-run");
    let certifier = args
        .iter()
        .position(|a| a == "--certifier")
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_else(|| DEFAULT_CERTIFIER.to_owned());
    let path = args
        .iter()
        .enumerate()
        .find(|(i, a)| !a.starts_with("--") && (*i == 0 || args[i - 1] != "--certifier"))
        .map(|(_, a)| PathBuf::from(a))
        .unwrap_or_else(|| {
            PathBuf::from("../05_data/03_고양이친화병원/isfm_cat_friendly_hospitals.csv")
        });

    let text = std::fs::read_to_string(&path)
        .with_context(|| format!("목록 파일을 읽지 못했습니다: {}", path.display()))?;
    let list = cat_friendly::parse_csv(&text).map_err(anyhow::Error::msg)?;

    let cfg = Config::from_env()?;
    let pool = db::connect(&cfg.database_url)
        .await
        .context("DB 연결 실패")?;

    if dry_run {
        let results = cat_friendly::preview(&pool, &list).await?;
        for (l, r) in &results {
            match r {
                MatchResult::Matched(id) | MatchResult::Pinned(id) => {
                    println!("[{}] {} {} → 병원 {id}", r.status(), l.sido, l.name)
                }
                MatchResult::Ambiguous(c) => {
                    println!(
                        "[확인 필요] {} {} → 후보: {}",
                        l.sido,
                        l.name,
                        c.join(" / ")
                    )
                }
                MatchResult::Unmatched => println!("[못 찾음] {} {}", l.sido, l.name),
            }
        }
        let ok = results
            .iter()
            .filter(|(_, r)| r.hospital_id().is_some())
            .count();
        println!("매칭 {ok} / {} (dry-run: DB 변경 없음)", results.len());
        return Ok(());
    }

    let source = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let report = cat_friendly::import(&pool, &certifier, &list, &source).await?;
    println!(
        "{certifier} 고양이 친화병원 {}곳 적재: 자동 매칭 {}, 지정(external_id) {}, 확인 필요 {}, 못 찾음 {}, 목록에서 빠져 삭제 {}",
        report.total,
        report.matched,
        report.pinned,
        report.ambiguous.len(),
        report.unmatched.len(),
        report.removed
    );
    for (sido, name, c) in &report.ambiguous {
        println!("  [확인 필요] {sido} {name} → 후보: {}", c.join(" / "));
    }
    for (sido, name) in &report.unmatched {
        println!("  [못 찾음] {sido} {name}");
    }
    if !report.ambiguous.is_empty() || !report.unmatched.is_empty() {
        println!(
            "→ CSV 의 external_id 열에 공공데이터 관리번호를 넣고 다시 실행하면 그 병원으로 고정됩니다."
        );
    }
    Ok(())
}

use std::path::PathBuf;

use anyhow::{Context, bail};
use nyangjipsa_api::{config::Config, db, health};

/// 챗봇 참고 자료(고양이 건강) 적재.
/// 실행 (01_backend 에서):
///   cargo run --bin import_health_data -- urogenital [CSV 경로] [--dry-run]
///
/// - `health_sources`, `health_documents` 만 바꿉니다. 병원·진료비 데이터는 건드리지 않습니다.
/// - 이미 있는 자료(같은 행 또는 같은 내용)는 건너뜁니다. 덮어쓰거나 지우지 않습니다.
/// - --dry-run: 파일만 읽고 적재할 내용을 출력합니다 (DB 연결 안 함)
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let dry_run = args.iter().any(|a| a == "--dry-run");
    let positional: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    let Some(dataset) = positional.first() else {
        bail!("데이터셋 이름이 필요합니다. 사용 가능: urogenital");
    };

    let (source, default_path) = match dataset.as_str() {
        "urogenital" => (health::urogenital::SOURCE, health::urogenital::DEFAULT_PATH),
        other => bail!("알 수 없는 데이터셋: {other} (사용 가능: urogenital)"),
    };
    let path = positional
        .get(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(default_path));

    let bytes = std::fs::read(&path)
        .with_context(|| format!("파일을 읽지 못했습니다: {}", path.display()))?;
    let sha = health::file_sha256(&bytes);
    let text = String::from_utf8(bytes).context("UTF-8 파일이 아닙니다")?;
    let docs = health::urogenital::parse(&text).map_err(anyhow::Error::msg)?;

    let cats = docs.iter().filter(|d| d.species == "cat").count();
    println!(
        "{} — {}건 (고양이 {cats}건), 파일 SHA-256 {sha}",
        source.name,
        docs.len()
    );
    if dry_run {
        for d in &docs {
            println!("- [{}] {} | 태그: {}", d.species, d.title, d.tags.join(","));
            println!("    {}", d.summary);
        }
        println!("(--dry-run: DB 는 바꾸지 않았습니다)");
        return Ok(());
    }

    let cfg = Config::from_env()?;
    let pool = db::connect(&cfg.database_url)
        .await
        .context("DB 연결 실패")?;
    let r = health::import(&pool, &source, &sha, &docs).await?;
    println!("추가 {}건, 이미 있어서 건너뜀 {}건", r.inserted, r.skipped);
    Ok(())
}

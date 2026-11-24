//! 주소 문자열에서 시·도 / 시·군·구를 뽑습니다. (진료비 통계와 매칭용)
//! 진료비 통계의 시군구는 "수원시"처럼 일반구를 합친 단위라 두 번째 단어만 사용합니다.

#[derive(Debug, PartialEq, Eq)]
pub struct Region {
    pub sido: String,
    pub sigungu: Option<String>,
}

pub fn normalize_sido(s: &str) -> Option<&'static str> {
    Some(match s {
        "서울특별시" | "서울시" | "서울" => "서울특별시",
        "부산광역시" | "부산시" | "부산" => "부산광역시",
        "대구광역시" | "대구시" | "대구" => "대구광역시",
        "인천광역시" | "인천시" | "인천" => "인천광역시",
        "광주광역시" | "광주시" | "광주" => "광주광역시",
        "대전광역시" | "대전시" | "대전" => "대전광역시",
        "울산광역시" | "울산시" | "울산" => "울산광역시",
        "세종특별자치시" | "세종시" | "세종" => "세종특별자치시",
        "경기도" | "경기" => "경기도",
        "강원특별자치도" | "강원도" | "강원" => "강원특별자치도",
        "충청북도" | "충북" => "충청북도",
        "충청남도" | "충남" => "충청남도",
        "전북특별자치도" | "전라북도" | "전북" => "전북특별자치도",
        "전라남도" | "전남" => "전라남도",
        "경상북도" | "경북" => "경상북도",
        "경상남도" | "경남" => "경상남도",
        "제주특별자치도" | "제주도" | "제주" => "제주특별자치도",
        _ => return None,
    })
}

/// 광주광역시의 자치구 (2026 광주·전남 통합 후 주소 구분용)
const GWANGJU_DISTRICTS: [&str; 5] = ["동구", "서구", "남구", "북구", "광산구"];

pub fn parse_region(address: &str) -> Option<Region> {
    let mut tokens = address.split_whitespace();
    let first = tokens.next()?;
    let sigungu = tokens
        .next()
        .filter(|t| t.ends_with('시') || t.ends_with('군') || t.ends_with('구'))
        .map(String::from);

    // 통계는 통합 이전 명칭(광주광역시 / 전라남도) 기준이므로 구 이름으로 되돌려 구분
    let sido = if first == "전남광주통합특별시" {
        match sigungu.as_deref() {
            Some(s) if GWANGJU_DISTRICTS.contains(&s) => "광주광역시".to_string(),
            _ => "전라남도".to_string(),
        }
    } else {
        normalize_sido(first)?.to_string()
    };
    Some(Region { sido, sigungu })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_normal_address() {
        let r = parse_region("경기도 포천시 영중면 호국로 3110, 가동 1,2층").unwrap();
        assert_eq!(r.sido, "경기도");
        assert_eq!(r.sigungu.as_deref(), Some("포천시"));
    }

    #[test]
    fn uses_city_for_city_with_districts() {
        let r = parse_region("경기도 수원시 장안구 경수대로 1").unwrap();
        assert_eq!(r.sigungu.as_deref(), Some("수원시"));
    }

    #[test]
    fn normalizes_old_sido_names() {
        assert_eq!(
            parse_region("강원도 춘천시 중앙로 1").unwrap().sido,
            "강원특별자치도"
        );
        assert_eq!(
            parse_region("전라북도 전주시 완산구 1").unwrap().sido,
            "전북특별자치도"
        );
    }

    #[test]
    fn sejong_has_no_sigungu() {
        let r = parse_region("세종특별자치시 한솔동 1").unwrap();
        assert_eq!(r.sigungu, None);
    }

    #[test]
    fn splits_merged_jeonnam_gwangju() {
        let g = parse_region("전남광주통합특별시 남구 천변좌로 394").unwrap();
        assert_eq!(g.sido, "광주광역시");
        assert_eq!(g.sigungu.as_deref(), Some("남구"));
        let j = parse_region("전남광주통합특별시 목포시 영산로 1").unwrap();
        assert_eq!(j.sido, "전라남도");
    }

    #[test]
    fn unknown_sido_is_none() {
        assert!(parse_region("알수없는 어딘가").is_none());
    }
}

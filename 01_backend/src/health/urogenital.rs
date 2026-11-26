//! Urogenital Disease's Clinical Cases Records in Veterinary Patients I (Mendeley Data, CC BY 4.0)
//!
//! 원본은 스페인어 임상 기록입니다. 원문 필드는 `detail` 에 그대로 두고,
//! 검색용 한국어 태그·진단명은 아래의 고정된 대응표로만 만듭니다 (없는 정보는 채우지 않음).

use serde_json::json;

use super::{NewDocument, SourceInfo, content_hash};

pub const SOURCE: SourceInfo = SourceInfo {
    code: "urogenital_mendeley_v1",
    name: "Urogenital Disease's Clinical Cases Records in Veterinary Patients I (Mendeley Data)",
    url: "https://data.mendeley.com/datasets/6cjnjmtv2h/1",
    license: Some("CC BY 4.0"),
    license_verified: true,
    data_kind: "clinical",
    reliability: "medium",
    note: "카리브해 지역 소동물 병원 실제 임상 기록(2025년 1~6월, 익명화, 스페인어). 검색용 요약·진단명 번역은 냥집사가 만듦(원문은 detail 에 보관).",
};

pub const DEFAULT_PATH: &str =
    "../05_data/04_고양이건강자료/urogenital_mendeley_v1/UROGENITAL_DATASET-1.csv";

const EXPECTED_HEADER: [&str; 10] = [
    "ID",
    "ESPECIE",
    "RAZA",
    "SEXO",
    "EDAD(AÑOS)",
    "HISTORIA CLINICA",
    "EXAMEN FISICO",
    "DIAGNOSTICO DIFERENCIAL",
    "EXAMENES DE LABORATORIO E IMAGEN",
    "DIAGNOSTICO DEFINITIVO",
];

/// 따옴표·줄바꿈이 들어간 CSV 를 행 단위로 나눕니다.
pub fn parse_csv_rows(text: &str) -> Vec<Vec<String>> {
    let text = text.trim_start_matches('\u{feff}');
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    quoted = false;
                }
            } else {
                field.push(c);
            }
            continue;
        }
        match c {
            '"' => quoted = true,
            ',' => row.push(std::mem::take(&mut field)),
            '\n' => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            '\r' => {}
            _ => field.push(c),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows.retain(|r| r.iter().any(|f| !f.trim().is_empty()));
    rows
}

fn species(raw: &str) -> &'static str {
    let u = raw.trim().to_uppercase();
    if u.starts_with("FELIN") {
        "cat"
    } else if u.starts_with("CANIN") {
        "dog"
    } else {
        "unknown"
    }
}

fn sex_ko(raw: &str) -> Option<&'static str> {
    match raw.trim().to_uppercase().as_str() {
        "HEMBRA ESTERILIZADA" => Some("중성화 암컷"),
        "HEMBRA ENTERA" => Some("중성화 안 한 암컷"),
        "MACHO CASTRADO" => Some("중성화 수컷"),
        "MACHO ENTERO" => Some("중성화 안 한 수컷"),
        _ => None,
    }
}

/// "NONE"·빈 값은 기록 없음
fn recorded(raw: &str) -> Option<&str> {
    let t = raw.trim();
    (!t.is_empty() && !t.eq_ignore_ascii_case("NONE") && t != "-").then_some(t)
}

/// 확정 진단(스페인어·영어) → (한국어 진단명, 검색 태그). 대응표에 없는 진단은 원문을 그대로 씁니다.
fn diagnoses(raw: &str) -> (Vec<String>, Vec<&'static str>) {
    let mut names: Vec<String> = Vec::new();
    let mut tags: Vec<&'static str> = Vec::new();
    for part in raw.split(['\n', ',']) {
        let p = part.trim().to_uppercase();
        if p.is_empty() || p == "NONE" {
            continue;
        }
        let (name, t): (&str, &[&'static str]) = if p.contains("OBSTRUCCION URETRAL") {
            ("요도 폐쇄", &["요도폐쇄", "배뇨곤란", "소변"])
        } else if p.contains("VIAS URINARIAS BAJAS") || p.contains("LOWER URINARY TRACT") {
            ("하부요로질환", &["하부요로", "소변"])
        } else if p.contains("UROLITIASIS") {
            ("요로결석", &["결석", "소변"])
        } else if p.contains("FALLO RENAL") {
            ("신부전", &["신장"])
        } else if p == "ERC" || p.contains("ENFERMEDAD RENAL CRONICA") {
            ("만성 신장병", &["신장"])
        } else if p.contains("RENAL") {
            ("신장병", &["신장"])
        } else if p.contains("OBESIDAD") {
            ("비만", &["비만"])
        } else if p == "UTI" || p.contains("INFECCION URINARIA") || p.contains("INFECCION DE VIAS")
        {
            ("요로감염", &["요로감염", "소변"])
        } else if p.contains("PIOMETRA") {
            ("자궁축농증", &[])
        } else {
            names.push(format!("{} (번역 없음)", part.trim()));
            continue;
        };
        if !names.iter().any(|n| n == name) {
            names.push(name.to_owned());
        }
        for tag in t {
            if !tags.contains(tag) {
                tags.push(tag);
            }
        }
    }
    (names, tags)
}

/// 앞에 부정어(NO / NI)가 붙지 않은 채로 나오는지
fn mentioned(text: &str, word: &str) -> bool {
    let mut from = 0;
    while let Some(pos) = text[from..].find(word) {
        let at = from + pos;
        let before: String = text[..at]
            .chars()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        if !(before.ends_with("NO ") || before.ends_with("NI ")) {
            return true;
        }
        from = at + word.len();
    }
    false
}

/// 보호자 진술·진찰 기록에서 증상 태그 (한국어 표시명, 태그)
fn symptoms(history: &str, exam: &str) -> Vec<(&'static str, &'static str)> {
    let h = history.to_uppercase();
    let e = exam.to_uppercase();
    let any = |words: &[&str]| words.iter().any(|w| h.contains(w));
    let mut out = Vec::new();
    if h.contains("ORIN") && (h.contains("SANGRE") || h.contains("SANGRADO")) {
        out.push(("혈뇨", "혈뇨"));
    }
    if any(&[
        "DIFICULTAD PARA ORINAR",
        "NO A PODIDO ORINAR",
        "NO HA PODIDO ORINAR",
        "NO PUEDE ORINAR",
        "NO HACE NECESIDADES",
        "POSICION DE DEFECACION U MICCION",
    ]) {
        out.push(("배뇨 곤란", "배뇨곤란"));
    }
    if any(&["FUERA DE LA BANDEJA"]) {
        out.push(("화장실 밖 배뇨", "화장실"));
    }
    if any(&["TOMA MUCHA AGUA", "BEBE MUCHA AGUA", "POLIDIPSIA"]) {
        out.push(("물을 많이 마심", "음수량"));
    }
    if any(&[
        "SIN APETITO",
        "NO ESTA COMIENDO",
        "SIN COMER",
        "ANOREXIA",
        "DEJA COMIDA",
    ]) {
        out.push(("식욕 저하", "식욕부진"));
    }
    if mentioned(&h, "VOMIT") {
        out.push(("구토", "구토"));
    }
    if mentioned(&h, "DIARREA") {
        out.push(("설사", "설사"));
    }
    if ["DUELE", "DOLOR", "LLORA"]
        .iter()
        .any(|w| mentioned(&h, w) || mentioned(&e, w))
    {
        out.push(("통증", "통증"));
    }
    out
}

/// 검사 기록에서 실시한 검사 종류 (결과는 해석하지 않음)
fn tests_recorded(labs: &str) -> Vec<&'static str> {
    let u = labs.to_uppercase();
    let mut out = Vec::new();
    for (words, name) in [
        (&["HEMOGRAMA", "CBC"][..], "혈구검사"),
        (&["BIOQUIMICA"][..], "혈액화학검사"),
        (&["URIANALISIS", "URINALISIS"][..], "소변검사"),
        (&["ECOGRAFIA"][..], "초음파"),
        (&["RADIOGRAF", "RAYOS X"][..], "엑스선"),
        (&["CITOLOGIA"][..], "세포검사"),
    ] {
        if words.iter().any(|w| u.contains(w)) {
            out.push(name);
        }
    }
    out
}

fn excerpt(s: &str, max: usize) -> String {
    let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut out: String = flat.chars().take(max).collect();
    if flat.chars().count() > max {
        out.push('…');
    }
    out
}

pub fn parse(text: &str) -> Result<Vec<NewDocument>, String> {
    let rows = parse_csv_rows(text);
    let header = rows.first().ok_or("빈 파일입니다")?;
    let header: Vec<&str> = header.iter().map(|h| h.trim()).collect();
    if header != EXPECTED_HEADER {
        return Err(format!("예상한 열 구성이 아닙니다: {header:?}"));
    }
    let mut docs = Vec::new();
    for (i, r) in rows.iter().enumerate().skip(1) {
        if r.len() != EXPECTED_HEADER.len() {
            return Err(format!("{}번째 행: 열 수가 {}개입니다", i + 1, r.len()));
        }
        let species = species(&r[1]);
        let animal = match species {
            "cat" => "고양이",
            "dog" => "개",
            _ => "종 미상",
        };
        let (dx_names, dx_tags) = recorded(&r[9]).map(diagnoses).unwrap_or_default();
        let syms = symptoms(&r[5], &r[6]);
        let labs = recorded(&r[8]);
        let tests = labs.map(tests_recorded).unwrap_or_default();

        let mut tags: Vec<String> = Vec::new();
        for t in dx_tags.iter().chain(syms.iter().map(|(_, t)| t)) {
            if !tags.iter().any(|x| x == t) {
                tags.push((*t).to_owned());
            }
        }
        if (syms
            .iter()
            .any(|(_, t)| ["혈뇨", "배뇨곤란", "화장실"].contains(t)))
            && !tags.iter().any(|t| t == "소변")
        {
            tags.push("소변".into());
        }

        let mut profile = vec![animal.to_owned()];
        if let Some(s) = sex_ko(&r[3]) {
            profile.push(s.to_owned());
        }
        if let Ok(age) = r[4].trim().parse::<u32>() {
            profile.push(format!("{age}세"));
        }
        let dx_text = if dx_names.is_empty() {
            "기록 없음".to_owned()
        } else {
            dx_names.join(", ")
        };
        let sym_text = if syms.is_empty() {
            "요약 태그 없음(원문 참고)".to_owned()
        } else {
            syms.iter().map(|(k, _)| *k).collect::<Vec<_>>().join(", ")
        };
        let test_text = if tests.is_empty() {
            "기록 없음(미실시 또는 미기록이며 정상이라는 뜻이 아님)".to_owned()
        } else {
            format!("{} (결과 해석은 수의사 몫)", tests.join(", "))
        };
        let summary = format!(
            "{}. 확정 진단: {dx_text}. 기록된 증상: {sym_text}. 기록된 검사: {test_text}. 보호자 진술 원문 일부(스페인어): {}",
            profile.join("·"),
            excerpt(&r[5], 110)
        );
        let title = if dx_names.is_empty() {
            format!("임상 사례: {animal} (확정 진단 기록 없음)")
        } else {
            format!("임상 사례: {animal} {}", dx_names.join(", "))
        };
        let detail = json!({
            "patient_id": r[0].trim(),
            "species_raw": r[1].trim(),
            "breed": recorded(&r[2]),
            "sex_raw": recorded(&r[3]),
            "age_years": r[4].trim().parse::<u32>().ok(),
            "history": recorded(&r[5]),
            "physical_exam": recorded(&r[6]),
            "differential_dx": recorded(&r[7]),
            "labs_and_imaging": labs,
            "definitive_dx": recorded(&r[9]),
            "diagnosis_ko": dx_names,
            "tests_recorded": tests,
            "symptoms_ko": syms.iter().map(|(k, _)| *k).collect::<Vec<_>>(),
        });
        docs.push(NewDocument {
            external_id: format!("row-{i}"),
            species,
            category: "clinical_case",
            title,
            summary,
            tags,
            detail,
            content_hash: content_hash(SOURCE.code, r),
        });
    }
    Ok(docs)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\u{feff}ID,ESPECIE,RAZA,SEXO,EDAD(AÑOS),HISTORIA CLINICA,EXAMEN FISICO,DIAGNOSTICO DIFERENCIAL,EXAMENES DE LABORATORIO E IMAGEN,DIAGNOSTICO DEFINITIVO\r\n\
8,FELINO,MIX,MACHO CASTRADO,3,\"PRESENTA SANGRADO EN EL PENE Y NO A PODIDO ORINAR DESDE HACE 1 SEMANA, LE DUELE\",\"ALERTA\",\"uti\nfus\",NONE,OBSTRUCCION URETRAL\r\n\
9,FELINO,MIX,MACHO CASTRADO,13,\"TOMA MUCHA AGUA SIN COMER MUCHO. NO VOMITOS NI DIARREA.\",\"ALERTA\",x,\"HEMOGRAMA: WBC 2.7. BIOQUIMICA: BUN 36\",ERC\r\n\
1,CANINO,CHIHUAHUA,HEMBRA ESTERILIZADA,15,\"VOMITO 3 VECES\",x,x,x,PIOMETRA\r\n";

    #[test]
    fn parses_cases_with_tags_and_unrecorded_tests() {
        let docs = parse(SAMPLE).unwrap();
        assert_eq!(docs.len(), 3);

        let obstruction = &docs[0];
        assert_eq!(obstruction.species, "cat");
        assert_eq!(obstruction.external_id, "row-1");
        for t in ["요도폐쇄", "배뇨곤란", "소변", "혈뇨", "통증"] {
            assert!(obstruction.tags.iter().any(|x| x == t), "{t}");
        }
        // 검사 기록이 NONE 이면 정상이라고 쓰지 않고 기록 없음으로
        assert!(obstruction.summary.contains("기록된 검사: 기록 없음"));
        assert!(obstruction.detail["labs_and_imaging"].is_null());

        let ckd = &docs[1];
        assert!(ckd.tags.iter().any(|x| x == "음수량"));
        assert!(ckd.tags.iter().any(|x| x == "신장"));
        // "NO VOMITOS NI DIARREA" 는 증상이 아님
        assert!(!ckd.tags.iter().any(|x| x == "구토" || x == "설사"));
        assert!(ckd.summary.contains("혈구검사, 혈액화학검사"));
        assert!(ckd.summary.contains("만성 신장병"));

        assert_eq!(docs[2].species, "dog");
        // 같은 행은 같은 해시, 다른 행은 다른 해시
        assert_ne!(docs[0].content_hash, docs[1].content_hash);
        assert_eq!(parse(SAMPLE).unwrap()[0].content_hash, docs[0].content_hash);
    }

    #[test]
    fn rejects_unexpected_header() {
        assert!(parse("A,B\n1,2\n").is_err());
    }
}

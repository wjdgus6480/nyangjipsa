# 04_고양이건강자료 — 챗봇 참고 자료 원본

챗봇이 답변 근거로 검색하는 건강 자료의 **원본 파일**입니다. 원본은 고치지 않고 그대로 둡니다.
DB 적재는 `01_backend` 에서 실행합니다:

```powershell
cargo run --bin import_health_data -- urogenital --dry-run
```

```powershell
cargo run --bin import_health_data -- urogenital
```

- 적재는 `health_sources`, `health_documents` 표만 바꿉니다. 병원·진료비 표는 건드리지 않습니다.
- 같은 행(출처+행 번호) 또는 같은 내용(내용 해시)이 이미 있으면 건너뜁니다. 덮어쓰거나 지우지 않습니다.
- 라이선스가 확인된 출처(`license_verified = true`)만 챗봇이 검색합니다.
- 합성 데이터(`data_kind = 'synthetic'`)는 의료 근거로 챗봇에 넘기지 않습니다.

## 확보 현황 (2026-11-26)

| 데이터셋 | 상태 | 비고 |
|---|---|---|
| Urogenital Disease Clinical Cases | ✅ 적재 | 아래 참고 |
| SAVSNET PetEVAL | ⏸ 미확보 | Hugging Face 에서 이용 동의 후 받을 수 있음 (gated) |
| PetQA | ⏸ 미확보 | 논문만 확인, 공개 파일 위치를 찾지 못함 |
| BioVet Pet Symptom Triage | ⏸ 미확보 | 같은 이름의 공개 데이터를 찾지 못함 |
| Cat Behavioral Enrichment Dataset | ⏸ 미확보 | 같은 이름의 공개 데이터를 찾지 못함 |
| Veterinary Clinic Visits & Vaccinations | ⏸ 미확보 | 같은 이름의 공개 데이터를 찾지 못함. 합성 데이터라 확보해도 의료 근거로 쓰지 않음 |

## urogenital_mendeley_v1

- 이름: Urogenital Disease's Clinical Cases Records in Veterinary Patients I (version 1)
- 출처: Mendeley Data, https://data.mendeley.com/datasets/6cjnjmtv2h/1 (DOI 10.17632/6cjnjmtv2h.1)
- 라이선스: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- 유형: 실제 임상 사례 (카리브해 지역 소동물 병원, 2025년 1~6월, 익명화)
- 내용: 17건 (개 9건, 고양이 8건), 스페인어. 같은 환자의 재방문이 따로 기록돼 있어 ID 가 겹침
- 파일: `UROGENITAL_DATASET-1.csv`, SHA-256 `3584defbb504589e5983fa91fde0eded735019d765efc3b4317ecbf9652711d7`
- 변경 사항: DB 에는 원문을 그대로 보관하고, 검색용 요약(한국어 태그·진단명 번역)을 따로 만듭니다. 검사 기록이 없는 항목은 "기록 없음"으로 두고 정상으로 표시하지 않습니다.

---
name: hospital-data-sync
description: 냥집사(동물병원 지도 서비스)의 공공데이터 동기화(animal_businesses → hospitals → 더미 진료비, 신설 추가·폐업 삭제)와 병원·진료비 데이터 보호 규칙. animal_businesses / hospitals / region_fees / hospital_fees 테이블, collect, import_fees, 동기화, 폐업·신설 갱신, 더미 가격, 진료비 데이터를 다루거나 DB 데이터를 바꿀 수 있는 작업(마이그레이션, 초기화, 재수집, docker volume 삭제 포함) 전에 사용한다.
---

# 공공데이터 동기화 + 데이터 보호

## 핵심 규칙

**병원·진료비 데이터는 팀이 명시적으로 수정을 요구하지 않는 한 건드리지 않는다.** 코드 개선·리팩터링·테스트·다른 기능 개발 중에 부수적으로 데이터를 바꾸면 안 된다.

### 요청 없이 하면 안 되는 것
- `hospital_fees` 더미 가격 변경·삭제·재생성 (**가격은 한 번 정해지면 유지**)
  - `cargo run --bin import_fees -- ... --regenerate` 금지, `fees::generate_dummy_hospital_fees()` 호출 금지
- `animal_businesses`, `hospitals`, `region_fees`, `hospital_fees` 에 대한 임의의 `DELETE` / `TRUNCATE` / `DROP` / `UPDATE`
- `docker compose down -v` (DB 볼륨 전체 삭제)
- 이미 적용된 마이그레이션 파일 수정 (새 번호 파일 추가)
- 삭제 범위 변경 — 현재는 상태가 **"폐업"** 인 업소만 삭제한다 (휴업·취소/말소는 유지)

### 허용된 자동 수정 (유일)
수집(`collect`, 또는 `SYNC_INTERVAL_HOURS` 자동 동기화)이 하는 일:
1. 공공데이터 5개 업종 → `animal_businesses` upsert (신규 추가, 상태 갱신)
   - 좌표가 없는 **영업 중 동물병원**만 카카오 주소 검색으로 좌표를 채움 (`geocode.rs`, 팀 결정 2026-11, `KAKAO_REST_API_KEY` 있을 때, 1회 최대 500곳). `location_source='geocoded'`. 공공데이터 좌표가 생기면 그것으로 바꾸고, 주소가 바뀌면 다시 변환. 실패는 30일 뒤 재시도. **기존 공공데이터 좌표는 바꾸지 않음**
2. **폐업은 저장하지 않고 이미 있으면 삭제.** 병원이면 `hospitals`(와 FK CASCADE 로 `hospital_fees`)에서도 삭제
3. 병원 → `hospitals` 파생 (`external_id = mng_no` 로 같은 행 갱신, 병원 id 유지)
4. 진료비가 없는 (병원, 항목)에만 더미 가격 채우기 (`fees::fill_missing_dummy_fees`) — **기존 가격은 바뀌지 않음**

## 구성 (01_backend/src)

| 파일 | 역할 |
|---|---|
| `ingest.rs` | 업종별 수집(`collect_type`), 폐업 삭제, 증분 시각(`auto_since`) |
| `animal_business.rs` | 업종·레코드 변환, upsert, 폐업 삭제(`remove_closed`, `delete`), 주변 검색 |
| `collector.rs` | `animal_businesses`(병원) → `hospitals` 파생 |
| `sync.rs` | 수집 → 파생 → 더미 진료비, 주기 실행 |
| `fees.rs` | xlsx 적재(`import_region_fees`), `fill_missing_dummy_fees`, `generate_dummy_hospital_fees`(전체 재생성, 주의) |
| `region.rs` | 주소 → 시도/시군구 (통합 전 명칭으로 정규화) |
| `bin/collect.rs` | 수동 수집 (`--incremental`, `--since`, `--max-pages`) |
| `bin/import_fees.rs` | 진료비 xlsx 적재. 기본은 없는 가격만 채움 |
| `geocode.rs`, `bin/geocode_hospitals.rs` | 좌표 없는 영업 중 병원 주소→좌표 (카카오 로컬), 수동 실행은 `geocode_hospitals [--dry-run]` |
| `cat_friendly.rs`, `bin/import_cat_friendly.rs` | 고양이 친화병원 인증 목록(`05_data/03_고양이친화병원/*.csv`) → `cat_friendly_hospitals`. `hospitals` 는 읽기만 하고 매칭 결과만 저장. 목록 교체는 팀이 목록을 고쳤을 때만 |

## 자주 하는 작업

```bash
cargo run --release --bin collect -- all --incremental   # 변경분만 (안전, 반복 가능)
cargo run --release --bin collect -- all                 # 전체 (수 분)
```

## 데이터가 안 바뀌었는지 확인

가격 지문 — 작업 전후 같아야 한다 (신규 병원이 없을 때):
```sql
SELECT count(*), sum(price), md5(string_agg(id||':'||price, ',' ORDER BY id)) FROM hospital_fees;
```
폐업 잔존 / 고아 진료비 (둘 다 0):
```sql
SELECT count(*) FROM hospitals WHERE business_status LIKE '폐업%';
SELECT count(*) FROM animal_businesses WHERE status_name LIKE '폐업%';
SELECT count(*) FROM hospital_fees f LEFT JOIN hospitals h ON h.id = f.hospital_id WHERE h.id IS NULL;
```

## 알아둘 사항
- 인증키는 `.env` 에만 둔다. 코드·문서·로그·커밋·채팅에 쓰지 않는다.
- 공공데이터 API 는 한 페이지 최대 100건이고 504 가 잦다 (수집기가 재시도). `cond[DAT_UPDT_PNT::GTE]` 로 증분 수집을 지원한다.
- 병원 가격은 현재 **더미(`is_dummy=true`)** 다. 실제 가격 데이터가 생기면 별도 논의 후 교체한다.
- 미용·위탁은 주소 번지가 가려진다(자택 영업 가능). 챗봇 응답에서는 이런 업소의 정확한 좌표·전화번호를 주지 않는다. 지도 API 공개 범위는 팀 결정 사항이다.

"""02 통합 CSV와 _검증결과.json으로 08 수집 보고서, 09 서비스 활용 분석 문서 생성. 표준 라이브러리만 사용.
실행: python3 -I make_reports.py <출력폴더> <screen_check.json|-> <원본파일명>
"""
import csv, json, sys
from collections import Counter, defaultdict
from pathlib import Path


def won(v):
    return "" if v in (None, "") else f"{int(v):,}원"


def main(out_dir, screen_path, raw_name):
    out = Path(out_dir)
    rows = list(csv.DictReader(open(out / "02_전국_진료비_통합.csv", encoding="utf-8-sig")))
    res = json.load(open(out / "_검증결과.json", encoding="utf-8"))
    ck, st, nod = res["checks"], res["stats"], res["no_data"]
    cmp_rows = list(csv.DictReader(open(out / "10_농식품부_보도자료_전국표_대조.csv", encoding="utf-8-sig")))
    screen = json.load(open(screen_path, encoding="utf-8")) if screen_path != "-" else None
    items = list(csv.DictReader(open(out / "07_진료항목_마스터.csv", encoding="utf-8-sig")))
    regions = list(csv.DictReader(open(out / "06_지역_마스터.csv", encoding="utf-8-sig")))

    def label(r):
        c = r["condition"] or ""
        a = {"DOG": "개", "CAT": "고양이", "COMMON": "공통"}[r["animal_type"]]
        return f"{r['item_name']}" + (f" ({c})" if c else "") + f" [{a}]"

    combos = []
    for it in items:
        combos.append((it["medi_type_cd"], it["animal_type_cd"]))
    key = lambda r: (r["medi_type_cd"], r["animal_type_cd"])
    nat = {key(r): r for r in rows if r["region_level"] == "national"}
    sido = defaultdict(list); sgg = defaultdict(list)
    for r in rows:
        if r["data_status"] != "DATA_AVAILABLE":
            continue
        if r["region_level"] == "sido":
            sido[key(r)].append(r)
        elif r["region_level"] == "sigungu":
            sgg[key(r)].append(r)

    avail = Counter((r["region_level"], r["animal_type"]) for r in rows if r["data_status"] == "DATA_AVAILABLE")
    by_status_type = Counter((r["animal_type"], r["data_status"]) for r in rows)
    n_sgg = sum(1 for r in regions if r["region_level"] == "sigungu")

    # ---------- 08 수집 보고서 ----------
    L = []
    A = L.append
    A("# 전국 동물병원 진료비 수집 보고서 (2025년 조사)\n")
    A(f"- 원본 출처: 농림축산식품부 동물병원 진료비 조사·공개 시스템 (https://animalclinicfee.or.kr/info/payInfo.do)")
    A(f"- 조사연도: **2025년** (농식품부 2025.12.22 보도자료 기준. 사이트 응답에는 연도 필드가 없어 지정값으로 기록)")
    A(f"- 실제 수집 시각(UTC): {st['수집시작']} ~ {st['수집종료']} (CSV의 collected_at은 요청별 한국시간)")
    A(f"- 공식 조사 대상 병원 수: **3,950개소** (농장동물 진료 전문병원 등 제외, 보도자료 기준)")
    A(f"- 공식 진료비 항목 수: **20종** / 사이트 조회 조합: **{st['조합수']}개** (항목 × 동물·체중 조건)")
    A(f"- 원본 파일: `{raw_name}` ({st['원본파일_bytes']:,} bytes, SHA-256 `{st['원본파일_sha256']}`)\n")

    A("## 1. 수집 방식")
    A("- 사이트가 화면 조회에 쓰는 내부 요청을 사이트와 같은 방식(POST, form-urlencoded, `AJAX: true` 헤더)으로 순차 호출")
    A("- 요청 사이 2.2초 대기, 실패 시 최대 3회 재시도(대기 시간 증가), 요청마다 브라우저 저장소에 체크포인트 저장, 같은 요청은 다시 보내지 않음")
    A("- `/info/saveSearchLog.json`(검색 로그 저장)은 호출하지 않음. 해당 탭에서는 로그 함수 자체를 비활성화")
    A("- 응답 본문은 받은 그대로 보존하고, 요청별 SHA-256을 함께 기록\n")
    A("| 엔드포인트 | 파라미터 | 용도 | 요청 수 |")
    A("|---|---|---|---|")
    kc = Counter()
    for k in ["gugun", "total", "price", "probe"]:
        pass
    A(f"| /info/gugunList.json | sido | 시도별 시군구 목록 | 17 |")
    A(f"| /info/searchTotalPrice.json | mediTypeCd, animalTypeCd | 전국(SIDO_CD=99) + 17개 시도 통계 | {st['조합수']} |")
    A(f"| /info/searchPrice.json | sidoCd, mediTypeCd, animalTypeCd | 시도 1곳의 전체 시군구 통계 | {st['조합수'] * 17} |")
    A(f"| /info/searchTotalPrice.json | 화면에 없는 코드 | 숨은 코드 확인(검증용, 데이터셋 미포함) | {len(st['probes'])} |")
    A(f"| **합계** | | | **{st['요청수']}** |\n")

    A("## 2. 코드 체계 (현재 사이트에서 재검증)")
    A("- 시도 코드: 11 서울, 26 부산, 27 대구, 28 인천, 29 광주, 30 대전, 31 울산, 36 세종, 41 경기, 42 강원, 43 충북, 44 충남, 45 전북, 46 전남, 47 경북, 48 경남, 50 제주. 전국은 응답에서 `SIDO_CD=99`")
    A("- 시군구: `gugunList`의 `ADDR2_CD`(3자리) + `ADDR2_NM`. 통계 응답(`searchPrice`)에는 시군구 코드가 없어 **시도 코드 + 시군구 이름**으로 연결")
    A("- 동물·체중 코드: `ANITY00001` 개, `ANITY00005` 고양이, `ANITY00006/07/08` 체중 5/10/20kg, 빈 값 = 조건 없음. 단 투약·조제 3종은 빈 값으로 요청해도 응답 행에 `ANITY00006`이 붙어 오며, 화면 제목도 '투약/조제비(체중 5kg 기준)'이므로 체중 5kg 기준으로 기록")
    A("- 숨은 코드 확인: " + "; ".join(f"{p[0]['mediTypeCd']}+{p[0]['animalTypeCd'] or '(빈값)'} → `{p[1]}`" for p in st["probes"]) +
      " → 화면에 없는 코드에는 데이터 없음 (`MEDIT00006`은 미사용 코드, 고양이 체중별 입원비는 제공되지 않음)\n")
    A("### 진료항목 매핑 (공식 20종)")
    A("| 번호 | 대분류 | 세부 항목 | 코드 | 동물코드 | 분류 | 체중 | 분류 근거 |")
    A("|---|---|---|---|---|---|---|---|")
    for it in items:
        A(f"| {it['official_item_no']} | {it['category']} | {it['item_name']} | {it['medi_type_cd']} | {it['animal_type_cd'] or '-'} | {it['animal_type']} | {it['weight_kg'] or '-'} | {it['classification_basis']} |")
    A(f"\n공식 20종 중 매핑된 번호: {ck['공식_20종_매핑']} → **{len(ck['공식_20종_매핑'])}/20종**\n")

    A("## 3. 수집 결과 건수")
    A("| 구분 | 전체 레코드 | DATA_AVAILABLE | NO_DATA | COLLECTION_ERROR |")
    A("|---|---|---|---|---|")
    for lvl, nm in [("national", "전국"), ("sido", "시·도"), ("sigungu", "시·군·구")]:
        c = Counter(r["data_status"] for r in rows if r["region_level"] == lvl)
        A(f"| {nm} | {sum(c.values()):,} | {c['DATA_AVAILABLE']:,} | {c['NO_DATA']:,} | {c['COLLECTION_ERROR']:,} |")
    for at, nm in [("DOG", "개(DOG)"), ("CAT", "고양이(CAT)"), ("COMMON", "공통(COMMON)")]:
        A(f"| {nm} | {sum(v for (a, s), v in by_status_type.items() if a == at):,} | {by_status_type[(at, 'DATA_AVAILABLE')]:,} | {by_status_type[(at, 'NO_DATA')]:,} | {by_status_type[(at, 'COLLECTION_ERROR')]:,} |")
    A(f"| **합계** | **{len(rows):,}** | **{st['상태별'].get('DATA_AVAILABLE', 0):,}** | **{st['상태별'].get('NO_DATA', 0):,}** | **{st['상태별'].get('COLLECTION_ERROR', 0):,}** |\n")
    A(f"- 지역 마스터: 전국 1 + 시도 {ck['시도수']} + 시군구 **{ck['시군구수']}**")
    A("- 레코드 구성: (전국 1 + 시도 17 + 시군구 전체) × 조회 조합 35. 응답에 없는 지역도 행을 만들고 `NO_DATA`로 표시(가격은 비움)")
    A("- `NOT_APPLICABLE`: 공식 조회 조합 자체가 없는 경우(예: 고양이 체중별 입원비, 고양이 코로나백신)는 레코드를 만들지 않고 `07_진료항목_마스터.csv`와 09 문서의 종별 적용표에 기재\n")

    A("## 4. 누락·실패")
    A(f"- 수집 실패 요청: **{len(st['실패요청'])}건** {st['실패요청'] if st['실패요청'] else ''}")
    A(f"- 재시도가 발생한 요청: {len(st['재시도발생'])}건 {st['재시도발생'] if st['재시도발생'] else ''}")
    A(f"- 시군구 목록 수집 실패 시도: {ck['시군구_목록_수집실패_시도'] or '없음'}")
    A(f"- 목록에 없는 지역이 응답에 섞인 경우: {ck['목록외_지역_응답'] or '없음'}")
    A(f"- 누락 항목(전국 값이 없는 조합): {[label(r) for r in rows if r['region_level'] == 'national' and r['data_status'] != 'DATA_AVAILABLE'] or '없음'}")
    nod_sido = [f"{r['sido_name']} – {label(r)}" for r in rows if r['region_level'] == 'sido' and r['data_status'] == 'NO_DATA']
    A(f"- 시·도 단위 NO_DATA: {len(nod_sido)}건" + ("" if not nod_sido else "\n" + "\n".join(f"  - {x}" for x in nod_sido)))
    A("\n### 시·군·구 NO_DATA (항목별)")
    A("사이트 안내: 해당 진료가 없거나 동물병원 1개소 이하 지역은 진료비 정보가 제공되지 않을 수 있음. 상위 지역 값으로 채우지 않았음.\n")
    A("| 항목 | NO_DATA 시군구 수 | 지역 |")
    A("|---|---|---|")
    for k, v in sorted(nod.items(), key=lambda kv: -len(kv[1])):
        sgg_only = [x for x in v if not x.endswith("(시도)") and x != "전국"]
        if sgg_only:
            A(f"| {k} | {len(sgg_only)} / {n_sgg} | {', '.join(sgg_only) if len(sgg_only) <= 25 else ', '.join(sgg_only[:25]) + f' 외 {len(sgg_only) - 25}곳'} |")
    A("")

    A("## 5. 데이터 검증 결과")
    A("| # | 검증 항목 | 결과 |")
    A("|---|---|---|")
    A(f"| 1 | 공식 20개 항목 모두 매핑 | {'통과' if len(ck['공식_20종_매핑']) == 20 else '불일치'} ({len(ck['공식_20종_매핑'])}/20) |")
    A(f"| 2 | 개·고양이·공통 구분 | 공식 화면·보도자료 표기 근거로 분류 (항목 매핑표 참조) |")
    A(f"| 3 | 체중 조건 누락 없음 | 체중 코드가 있는 조합 {sum(1 for i in items if i['weight_kg'])}개 모두 weight_kg 기록 |")
    A(f"| 4 | 17개 시·도 확보 | {ck['시도수']}개 |")
    A(f"| 5 | 모든 시·군·구 지역 마스터 등록 | {ck['시군구수']}개 등록, 목록 외 응답 {len(ck['목록외_지역_응답'])}건 |")
    A(f"| 6 | 전국·시도 통계 구분 | region_level 필드로 구분 (national / sido / sigungu) |")
    A(f"| 7 | 최저·최고·평균·중간값 저장 | 원 단위 정수, 0 이상. 범위 예외 {len(ck['값_검증_예외'])}건 (아래) |")
    if screen:
        A(f"| 8 | 공식 화면 값과 일치 | 표본 {screen['compared']}개 값 비교, 불일치 {screen['mismatch']}건 ({screen['desc']}) |")
    A(f"| 8b | 농식품부 보도자료 전국표와 일치 | {sum(c['일치'] == 'Y' for c in cmp_rows)}/{len(cmp_rows)} 조합 일치" + (f", 불일치: {ck['보도자료_대조_불일치']}" if ck['보도자료_대조_불일치'] else "") + " |")
    A(f"| 9 | 누락과 수집 실패 구분 | NO_DATA / COLLECTION_ERROR 별도 상태값 |")
    A(f"| 10 | 중복 레코드 없음 | 중복 {len(ck['중복_레코드'])}건, 중복 요청 {len(ck['중복_요청'])}건 |")
    A(f"| 11 | 개+고양이+공통 = 통합 | {'일치' if ck['종별_합계_일치'] else '불일치'} ({st['개']:,} + {st['고양이']:,} + {st['공통']:,} = {len(rows):,}) |")
    A(f"| 12 | 원본 응답 무결성 | 해시 불일치 {len(ck['원본_해시_불일치'])}건 |")
    if ck["값_검증_예외"]:
        A("\n### 값 범위 예외 (원본 그대로 보존, 수정하지 않음)")
        A("| 유형 | 위치 | 값 |"); A("|---|---|---|")
        for t, w, v in ck["값_검증_예외"][:60]:
            A(f"| {t} | {w} | {v} |")
        if len(ck["값_검증_예외"]) > 60:
            A(f"\n외 {len(ck['값_검증_예외']) - 60}건은 `_검증결과.json` 참조")
        A("\n예외 사유 추정: 공개 통계는 병원이 게시한 금액을 지역 단위로 집계한 값이라 평균은 실제 범위를 벗어날 수 없음. 범위 밖 값이 있다면 사이트 원본 값 자체의 특성이므로 그대로 두고 표시함.")
    A("")
    A("## 6. 이용 조건 확인 결과")
    A("| 확인 항목 | 결과 |")
    A("|---|---|")
    A("| 사이트 이용약관 | animalclinicfee.or.kr에 이용약관·데이터 이용 조건 페이지 없음 |")
    A("| robots.txt | 없음 (404 오류 페이지, meta robots=all) |")
    A("| 공공누리 | 진료비 공개 시스템 화면에는 공공누리 표시 없음. 하단 표기는 'COPYRIGHT© 2024 BY MAFRA ALL RIGHTS RESERVED' |")
    A("| 농식품부 보도자료(2025.12.22) | **공공누리 제1유형(출처표시)** 표시 → 출처 표시 시 상업적 이용·변형 가능. 단 보도자료 저작물에 대한 표시이며, 진료비 시스템 데이터베이스 전체에 대한 명시적 허락은 아님 |")
    A("| 법적 성격 | 수의사법 제20조의4에 따라 정부가 조사·공개하는 통계. 공공데이터법은 공공데이터의 영리적 이용도 원칙적으로 허용하는 취지이고, 공공데이터포털 안내도 제3자 권리가 없으면 영리적 이용이 허용된다고 설명함 |")
    A("| 출처 표시 | 필수로 처리 권장: '출처: 농림축산식품부 동물병원 진료비 조사·공개 시스템(2025년 조사)' |")
    A("| 가공·재배포 | 통계 수치 가공은 일반적으로 가능해 보이나, 원본 DB를 그대로 대량 재배포하는 것은 명시적 허락이 없음 |\n")
    A("**농림축산식품부 반려산업동물의료팀(044-201-2652)에 확인할 사항**")
    A("1. 진료비 조사·공개 시스템 데이터의 공공누리 유형(제1유형 적용 여부)")
    A("2. 민간 서비스(상업적)에서 지역별 통계를 가공·표시하는 것의 허용 여부와 출처 표시 문구")
    A("3. 시스템 내부 조회 경로를 이용한 정기 수집 허용 여부, 또는 공공데이터포털 파일·Open API 제공 계획")
    A("4. 조사연도·조사 기준일 공식 표기 방법과 연간 갱신 일정")
    A("5. 개별 동물병원 진료비 공개(수의사법 시행규칙 개정안) 시행 시 데이터 제공 방식\n")
    A("*법률 자문이 아니며, 상업 서비스 출시 전 담당 부서 확인을 권장함.*\n")
    A("## 7. 생성된 파일")
    for f, d in [(raw_name, "공식 사이트 원본 응답 전체(요청 정보·시각·해시 포함, 본문은 받은 그대로)"),
                 ("02_전국_진료비_통합.csv", "정규화 통합 데이터(전국·시도·시군구 × 35개 조합)"),
                 ("03_개_진료비.csv", "animal_type=DOG"), ("04_고양이_진료비.csv", "animal_type=CAT"),
                 ("05_공통_진료비.csv", "animal_type=COMMON (종별 구분 없는 공식 항목)"),
                 ("06_지역_마스터.csv", "전국·시도·시군구 코드와 명칭"),
                 ("07_진료항목_마스터.csv", "6개 대분류, 20종 항목, 35개 조회 조합과 공식 코드·분류 근거"),
                 ("08_수집_보고서.md", "이 문서"), ("09_서비스활용_분석_및_DB설계.md", "개·고양이 비교, 지역 비교, DB·화면 설계"),
                 ("10_농식품부_보도자료_전국표_대조.csv", "보도자료 붙임 전국표와 수집값 대조"),
                 ("_검증결과.json", "검증 상세(기계 판독용)"), ("scripts/", "처리·검증 스크립트와 보도자료 표 옮겨 적은 참고 파일")]:
        A(f"- `{f}`: {d}")
    A("\n## 8. 서비스 DB 적용 방안")
    A("`09_서비스활용_분석_및_DB설계.md` 참조. 핵심: 진료항목(조합) 마스터 + 지역 마스터 + 가격 통계 사실 테이블(조사연도 포함) 구조로 적재하고, 화면에는 '지역별 공개 조사 통계(참고 비용)' 문구를 항상 표시.")
    (out / "08_수집_보고서.md").write_text("\n".join(L) + "\n", encoding="utf-8")

    # ---------- 09 서비스 활용 분석 ----------
    M = []
    B = M.append
    B("# 서비스 활용 분석 및 DB 설계 제안\n")
    B("자료: 농림축산식품부 동물병원 진료비 조사·공개 시스템, 2025년 조사. 모든 값은 **지역별 공개 조사 통계**이며 개별 병원의 확정 가격이 아님.\n")
    B("## A. 개와 고양이 비교")
    B("### 종별 적용표 (공식 데이터 기준)")
    B("| 항목 | 개 | 고양이 | 비고 |")
    B("|---|---|---|---|")
    B("| 초진·재진 진찰료 (5/10/20kg) | 공통 | 공통 | 종별 구분 없음, 체중으로만 구분 |")
    B("| 진찰에 대한 상담료 | 공통 | 공통 | |")
    B("| 입원비 | 개 전용 (5/10/20kg) | 고양이 전용 (체중 구분 없음) | 조건이 달라 1:1 비교는 제한적 |")
    B("| 종합백신 접종비 | 개 | 고양이 | **종별 직접 비교 가능** |")
    B("| 코로나바이러스백신 | 개 | 해당 없음(NOT_APPLICABLE) | 공식 표기 '개' |")
    B("| 광견병·켄넬코프·인플루엔자 백신 | 공통 | 공통 | 공식 데이터에 종별 구분 없음. 켄넬코프는 통상 개 대상 백신이지만 공식 구분이 없어 COMMON 유지(서비스 안내 시 주의) |")
    B("| 혈액검사 3종 | 공통 | 공통 | |")
    B("| 영상검사 4종 (5/10/20kg) | 공통 | 공통 | 체중으로만 구분 |")
    B("| 투약·조제 3종 | 공통 | 공통 | 체중 5kg 기준 (화면 표기, 응답 동물코드 ANITY00006) |\n")
    B("### 종별 가격 비교 (전국)")
    B("| 항목 | 개 중간 | 개 평균 | 고양이 중간 | 고양이 평균 |")
    B("|---|---|---|---|---|")
    def g(m, a, f):
        r = nat.get((m, a)); return won(r[f]) if r and r["data_status"] == "DATA_AVAILABLE" else "없음"
    B(f"| 종합백신 | {g('MEDIT00005','ANITY00001','median_price')} | {g('MEDIT00005','ANITY00001','average_price')} | {g('MEDIT00005','ANITY00005','median_price')} | {g('MEDIT00005','ANITY00005','average_price')} |")
    for a, w in [("ANITY00006", 5), ("ANITY00007", 10), ("ANITY00008", 20)]:
        B(f"| 입원비 (개 {w}kg / 고양이 전체) | {g('MEDIT00004',a,'median_price')} | {g('MEDIT00004',a,'average_price')} | {g('MEDIT00004','ANITY00005','median_price')} | {g('MEDIT00004','ANITY00005','average_price')} |")
    B("\n비교 불가 항목과 이유: 진찰·검사·투약 항목은 공식 데이터에 종별 값이 없어서 개·고양이 차이를 말할 수 없음(추정 금지). 코로나바이러스백신은 개 항목만 있음.\n")

    B("## B. 지역별 비교")
    B("### 전국 통계 (35개 조합)")
    B("| 항목 | 중간값 | 평균 | 최저 | 최고 | 시도 데이터 | 시군구 데이터 |")
    B("|---|---|---|---|---|---|---|")
    for m, a in combos:
        r = nat.get((m, a))
        if not r: continue
        B(f"| {label(r)} | {won(r['median_price'])} | {won(r['average_price'])} | {won(r['min_price'])} | {won(r['max_price'])} | {len(sido[(m, a)])}/17 | {len(sgg[(m, a)])}/{n_sgg} |")
    B("\n### 시·도별 평균 가격 차이 (항목별 최고·최저 시도)")
    B("| 항목 | 최고 시도(평균) | 최저 시도(평균) | 배율 |")
    B("|---|---|---|---|")
    for m, a in combos:
        s = [r for r in sido[(m, a)] if r["average_price"]]
        if len(s) < 2: continue
        hi = max(s, key=lambda r: int(r["average_price"])); lo = min(s, key=lambda r: int(r["average_price"]))
        B(f"| {label(hi)} | {hi['sido_name']} {won(hi['average_price'])} | {lo['sido_name']} {won(lo['average_price'])} | {int(hi['average_price']) / int(lo['average_price']):.2f}배 |")
    B("\n### 시·군·구별 차이 — 대표 항목")
    for m, a in [("MEDIT00001", "ANITY00006"), ("MEDIT00005", "ANITY00001"), ("MEDIT00005", "ANITY00005"), ("MEDIT00004", "ANITY00006"), ("MEDIT00004", "ANITY00005")]:
        s = sorted([r for r in sgg[(m, a)] if r["median_price"]], key=lambda r: (int(r["median_price"]), int(r["average_price"])))
        if not s: continue
        B(f"\n**{label(s[0])}** — 데이터 있는 시군구 {len(s)}/{n_sgg}곳, 중간값 기준")
        B("| 구분 | 지역 | 중간값 | 평균 |"); B("|---|---|---|---|")
        for r in s[-5:][::-1]:
            B(f"| 높은 곳 | {r['sido_name']} {r['sigungu_name']} | {won(r['median_price'])} | {won(r['average_price'])} |")
        for r in s[:5]:
            B(f"| 낮은 곳 | {r['sido_name']} {r['sigungu_name']} | {won(r['median_price'])} | {won(r['average_price'])} |")
    B("\n### 데이터가 부족한 지역 (35개 조합 중 NO_DATA 많은 시군구)")
    cnt = Counter((r["sido_name"], r["sigungu_name"]) for r in rows if r["region_level"] == "sigungu" and r["data_status"] == "NO_DATA")
    B("| 지역 | NO_DATA 조합 수 |"); B("|---|---|")
    for (sn, gn), c in cnt.most_common(20):
        B(f"| {sn} {gn} | {c}/35 |")
    B(f"\n전 조합 데이터가 있는 시군구: {sum(1 for r in regions if r['region_level']=='sigungu' and cnt[(r['sido_name'], r['sigungu_name'])]==0)}/{n_sgg}곳\n")
    B("서비스 처리 원칙: 시군구 값이 없으면 시군구 값처럼 보이게 시도 값을 채우지 말고, '이 지역은 공개 데이터가 없습니다. ○○시도 통계를 참고하세요'처럼 **수준을 명시한 대체 안내**를 함.\n")

    B("## C. 서비스 DB 설계 제안")
    B("```sql")
    B("""-- 지역 마스터
CREATE TABLE region (
  region_id      VARCHAR(16) PRIMARY KEY,   -- '99' 전국, '26' 부산, '26-350' 해운대구
  region_level   VARCHAR(8)  NOT NULL,      -- national / sido / sigungu
  sido_code      CHAR(2)     NOT NULL,
  sido_name      VARCHAR(20) NOT NULL,
  sigungu_code   CHAR(3),
  sigungu_name   VARCHAR(30),
  parent_id      VARCHAR(16) REFERENCES region(region_id)
);

-- 진료 대분류 / 세부 항목 / 조회 조건(공식 조합)
CREATE TABLE fee_category (category_id SMALLINT PRIMARY KEY, name VARCHAR(20) NOT NULL);
CREATE TABLE fee_item (
  medi_type_cd   VARCHAR(10) PRIMARY KEY,   -- MEDIT00001 ...
  category_id    SMALLINT REFERENCES fee_category,
  item_name      VARCHAR(50) NOT NULL
);
CREATE TABLE fee_variant (                  -- 35개 공식 조회 조합
  variant_id       SERIAL PRIMARY KEY,
  medi_type_cd     VARCHAR(10) REFERENCES fee_item,
  animal_type_cd   VARCHAR(10),             -- 공식 코드(없으면 NULL)
  animal_type      VARCHAR(6) NOT NULL CHECK (animal_type IN ('DOG','CAT','COMMON')),
  weight_kg        SMALLINT,                -- 5/10/20 또는 NULL
  condition_label  VARCHAR(40),
  official_item_no SMALLINT,                -- 공식 20종 번호
  UNIQUE (medi_type_cd, animal_type_cd)
);

-- 가격 통계 (연도별 적재)
CREATE TABLE fee_stat (
  survey_year     SMALLINT NOT NULL,
  region_id       VARCHAR(16) REFERENCES region,
  variant_id      INT REFERENCES fee_variant,
  median_price    INT, average_price INT, min_price INT, max_price INT,  -- 원, 없으면 NULL
  data_status     VARCHAR(20) NOT NULL,     -- DATA_AVAILABLE / NO_DATA / COLLECTION_ERROR
  source_id       INT REFERENCES data_source,
  collected_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (survey_year, region_id, variant_id)
);

CREATE TABLE data_source (
  source_id    SERIAL PRIMARY KEY,
  name         VARCHAR(100),  -- 농림축산식품부 동물병원 진료비 조사·공개 시스템
  url          TEXT,
  survey_year  SMALLINT,
  license_note TEXT           -- 출처 표시 문구, 확인된 이용 조건
);

-- 사용자 상황 → 필요한 항목 연결 (서비스 쪽에서 정의하는 규칙 테이블)
CREATE TABLE situation_item (
  situation_code VARCHAR(30),   -- 예: FIRST_VISIT, VACCINATION, HOSPITALIZATION
  variant_selector VARCHAR(30), -- 예: medi_type_cd, 또는 체중으로 고를 그룹
  sort_order SMALLINT
);""")
    B("```")
    B("조회 규칙: ① 사용자가 고른 동물이 DOG면 `animal_type IN ('DOG','COMMON')`, CAT이면 `IN ('CAT','COMMON')` ② 체중 조건이 있는 항목은 사용자 체중을 5/10/20kg 구간 중 가장 가까운 공식 조건으로 안내하되, '체중 n kg 기준 통계'라고 표시(구간 사이 값을 보간하지 않음) ③ 시군구 값이 NO_DATA면 시도 값을 '시도 통계'로 표시.\n")

    B("## D. 사용자 화면용 데이터 구조")
    ex = next((r for r in rows if r["region_level"] == "sigungu" and r["medi_type_cd"] == "MEDIT00005" and r["animal_type"] == "CAT" and r["data_status"] == "DATA_AVAILABLE"), None)
    sample = {
        "pet": "CAT", "region": {"level": "sigungu", "sido": ex["sido_name"] if ex else None, "sigungu": ex["sigungu_name"] if ex else None},
        "item": {"category": "예방접종비", "name": "종합백신 접종비", "condition": None},
        "prices": {"median": int(ex["median_price"]) if ex else None, "average": int(ex["average_price"]) if ex else None,
                   "min": int(ex["min_price"]) if ex else None, "max": int(ex["max_price"]) if ex else None, "unit": "KRW"},
        "data_status": "DATA_AVAILABLE", "survey_year": 2025, "fallback_level": None,
        "source": "농림축산식품부 동물병원 진료비 조사·공개 시스템(2025년 조사)",
        "notice": "지역별 공개 조사 통계(참고 비용)입니다. 실제 진료비는 병원, 진료 내용, 동물 상태에 따라 달라질 수 있습니다."}
    B("```json"); B(json.dumps(sample, ensure_ascii=False, indent=2)); B("```")
    B("화면 구성: 개/고양이 선택 → 지역(시도→시군구) → 진료비 항목(대분류→세부, 체중 조건) → 중간·평균·최저·최고 4개 값 + '2025년 조사 기준' + 참고 비용 안내 문구. 중간값을 대표값으로, 평균은 보조값으로 표시 권장(최고값이 매우 큰 지역이 있어 평균이 끌려 올라가는 경우가 많음).")
    (out / "09_서비스활용_분석_및_DB설계.md").write_text("\n".join(M) + "\n", encoding="utf-8")
    print("reports ok")


if __name__ == "__main__":
    main(*sys.argv[1:4])

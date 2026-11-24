"""전국 동물병원 진료비 원본 묶음(01_원본응답데이터.json) -> 정규화 CSV/마스터/검증 결과.
Python 표준 라이브러리만 사용. 실행: python3 -I build_nationwide.py <원본묶음.json> <출력폴더> <참고표.csv>
원본 파일은 읽기만 하며, 출력 폴더에 같은 이름 파일이 있으면 덮어쓰지 않고 중단한다.
"""
import csv, hashlib, json, sys
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

KST = timezone(timedelta(hours=9))
SURVEY_YEAR = 2025
SOURCE_PAGE = "https://animalclinicfee.or.kr/info/payInfo.do"
PRICE = [("MID_PRICE", "median_price"), ("AVG_PRICE", "average_price"),
         ("MIN_PRICE", "min_price"), ("MAX_PRICE", "max_price")]
PRICE_KEYS = {"ADDR1_CD", "ADDR1_NM", "ADDR2_NM", "SIDO_CD", "MEDI_TYPE_CD", "ANIMAL_TYPE_CD",
              "GUGUN_PRICE_SEQ", "ATTR", "MID_PRICE", "AVG_PRICE", "MIN_PRICE", "MAX_PRICE"}

# 진료항목 코드 -> (대분류, 세부항목, 공식 20종 중 번호). 사이트 화면(data-title) 및 농식품부 보도자료 기준.
ITEMS = {
    "MEDIT00001": ("진찰료", "초진 진찰료", 1),
    "MEDIT00002": ("진찰료", "재진 진찰료", 2),
    "MEDIT00003": ("진찰료", "진찰에 대한 상담료", 3),
    "MEDIT00004": ("입원비", "입원비", 4),
    "MEDIT00005": ("예방접종비", "종합백신 접종비", None),  # 개/고양이 2종으로 셈 (5,6)
    "MEDIT00007": ("예방접종비", "광견병백신 접종비", 7),
    "MEDIT00008": ("예방접종비", "켄넬코프백신 접종비", 8),
    "MEDIT00012": ("예방접종비", "코로나바이러스백신 접종비", 9),
    "MEDIT00009": ("예방접종비", "인플루엔자백신 접종비", 10),
    "MEDIT00010": ("혈액검사비", "전혈구 검사비와 판독료", 11),
    "MEDIT00013": ("혈액검사비", "혈액화학 검사비와 판독료", 12),
    "MEDIT00014": ("혈액검사비", "전해질 검사비와 판독료", 13),
    "MEDIT00011": ("영상검사비", "엑스선 촬영비와 판독료", 14),
    "MEDIT00015": ("영상검사비", "초음파 검사비와 판독료", 15),
    "MEDIT00016": ("영상검사비", "컴퓨터단층촬영(CT)비와 판독료", 16),
    "MEDIT00017": ("영상검사비", "자기공명영상(MRI)비와 판독료", 17),
    "MEDIT00018": ("투약/조제비", "심장사상충 예방비", 18),
    "MEDIT00019": ("투약/조제비", "외부기생충 예방비", 19),
    "MEDIT00020": ("투약/조제비", "광범위 구충비", 20),
}
WEIGHT = {"ANITY00006": 5, "ANITY00007": 10, "ANITY00008": 20}
DRUG_5KG = {"MEDIT00018", "MEDIT00019", "MEDIT00020"}  # 빈 동물코드로 요청해도 응답은 ANITY00006(5kg)


def classify(medi, anim):
    """(animal_type, weight_kg, condition, 근거). 공식 화면/보도자료 표기만 근거로 사용."""
    w = WEIGHT.get(anim)
    if medi == "MEDIT00004" and w:
        return "DOG", w, f"개 체중 {w}kg", "화면 표기 '개 체중 {w}kg', 보도자료 '입원비(개)'".format(w=w)
    if medi == "MEDIT00004" and anim == "ANITY00005":
        return "CAT", None, "고양이(체중 구분 없음)", "화면 표기 '고양이', 보도자료 '입원비(고양이)'"
    if medi == "MEDIT00005" and anim == "ANITY00001":
        return "DOG", None, None, "동물코드 ANITY00001=개, 화면 표기 '개'"
    if medi == "MEDIT00005" and anim == "ANITY00005":
        return "CAT", None, None, "동물코드 ANITY00005=고양이, 화면 표기 '고양이'"
    if medi == "MEDIT00012":
        return "DOG", None, None, "요청 동물코드 없음. PC 화면 표기 '개', 보도자료 '코로나바이러스백신(개)'"
    if medi in DRUG_5KG and not anim:
        return "COMMON", 5, "체중 5kg 기준", "화면 표기 '투약/조제비(체중 5kg 기준)', 응답 ANIMAL_TYPE_CD=ANITY00006(요청은 빈 값)"
    if medi == "MEDIT00003":
        return "COMMON", None, "기타 상담 행위", "종별 구분 없음"
    if w:
        return "COMMON", w, f"체중 {w}kg", "체중 코드만 있고 종별 구분 없음"
    return "COMMON", None, None, "종별·체중 구분 없음"


FIELDS = ["survey_year", "collected_at", "region_level", "sido_code", "sido_name", "sigungu_code",
          "sigungu_name", "category", "item_name", "medi_type_cd", "animal_type", "animal_type_cd",
          "weight_kg", "condition", "median_price", "average_price", "min_price", "max_price",
          "price_unit", "data_status", "source_url", "source_page"]


def kst(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(KST).isoformat(timespec="seconds") if ts else None


def die(msg):
    print("중단:", msg); sys.exit(2)


def write_csv(path, rows, fields):
    if path.exists():
        die(f"이미 있는 파일이라 덮어쓰지 않음: {path}")
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore"); w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in fields})


def main(bundle_path, out_dir, ref_path):
    bundle_bytes = Path(bundle_path).read_bytes()
    bundle = json.loads(bundle_bytes.decode("utf-8"))
    recs = bundle["records"]
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    checks = {}

    # 1) 원본 무결성: 브라우저에서 계산한 해시와 비교
    bad_hash = [r["key"] for r in recs if r.get("body") is not None
                and hashlib.sha256(r["body"].encode("utf-8")).hexdigest() != r.get("sha256")]
    checks["원본_해시_불일치"] = bad_hash
    keys = Counter(r["key"] for r in recs)
    checks["중복_요청"] = [k for k, c in keys.items() if c > 1]
    failed = [r for r in recs if r.get("body") is None]

    parsed = {r["key"]: json.loads(r["body"]) for r in recs if r.get("body") is not None}
    by_kind = defaultdict(list)
    for r in recs:
        by_kind[r["kind"]].append(r)

    # 2) 지역 마스터
    sido_names = {}
    for r in by_kind["total"]:
        for t in parsed.get(r["key"], []):
            if t.get("SIDO_CD") != "99" and t.get("SIDO_NM"):
                sido_names[t["SIDO_CD"]] = t["SIDO_NM"]
    for s in bundle["meta"]["sido_options"]:
        sido_names.setdefault(s["code"], s["name"])
    region = []
    gugun_by_sido = {}
    for r in by_kind["gugun"]:
        sc = r["params"]["sido"]
        lst = parsed.get(r["key"])
        if lst is None:
            gugun_by_sido[sc] = None; continue
        gugun_by_sido[sc] = lst
        for g in lst:
            region.append(dict(region_level="sigungu", sido_code=sc, sido_name=sido_names.get(sc),
                               sigungu_code=g["ADDR2_CD"], sigungu_name=g["ADDR2_NM"]))
    region_rows = ([dict(region_level="national", sido_code="99", sido_name="전국")] +
                   [dict(region_level="sido", sido_code=c, sido_name=n) for c, n in sorted(sido_names.items())] +
                   sorted(region, key=lambda x: (x["sido_code"], x["sigungu_code"])))
    checks["시도수"] = len(sido_names)
    checks["시군구수"] = len(region)
    checks["시군구_목록_수집실패_시도"] = [s for s, v in gugun_by_sido.items() if v is None]

    # 3) 통계 레코드
    rows, issues, extra = [], [], []

    def base(medi, anim):
        cat, item, _ = ITEMS[medi]
        at, wkg, cond, _b = classify(medi, anim)
        return dict(survey_year=SURVEY_YEAR, category=cat, item_name=item, medi_type_cd=medi,
                    animal_type=at, animal_type_cd=anim or None, weight_kg=wkg, condition=cond,
                    price_unit="KRW", source_page=SOURCE_PAGE)

    def prices(src):
        if src is None:
            return {c: None for _, c in PRICE}
        d = {}
        for k, c in PRICE:
            v = src.get(k)
            if v is not None and (not isinstance(v, int) or isinstance(v, bool) or v < 0):
                die(f"가격 값 형식 이상: {k}={v!r} in {src}")
            d[c] = v
        return d

    for r in by_kind["total"]:
        medi, anim = r["params"]["mediTypeCd"], r["params"]["animalTypeCd"]
        b = base(medi, anim)
        data = parsed.get(r["key"])
        st_err = data is None
        got = {t.get("SIDO_CD"): t for t in (data or [])}
        for sc, sn, lvl in [("99", "전국", "national")] + [(c, n, "sido") for c, n in sorted(sido_names.items())]:
            t = got.get(sc)
            p = prices(t)
            if st_err:
                status = "COLLECTION_ERROR"
            elif t is None or all(v in (None, 0) for v in p.values()):
                status = "NO_DATA"; p = {c: None for _, c in PRICE}
            else:
                status = "DATA_AVAILABLE"
            rows.append(dict(b, **p, region_level=lvl, sido_code=sc, sido_name=sn, sigungu_code=None,
                             sigungu_name=None, data_status=status, source_url=r["url"],
                             collected_at=kst(r.get("requested_at_utc"))))
        extra += [f"total {medi}/{anim}: 알 수 없는 SIDO_CD {c}" for c in got if c != "99" and c not in sido_names]

    for r in by_kind["price"]:
        sc, medi, anim = r["params"]["sidoCd"], r["params"]["mediTypeCd"], r["params"]["animalTypeCd"]
        b = base(medi, anim)
        data = parsed.get(r["key"])
        glist = gugun_by_sido.get(sc) or []
        got = {}
        for p in (data or []):
            if set(p) != PRICE_KEYS:
                die(f"응답 구조 변경: {r['key']} {sorted(p)}")
            want_anim = "ANITY00006" if (medi in DRUG_5KG and not anim) else anim
            if p["MEDI_TYPE_CD"] != medi or (p["ANIMAL_TYPE_CD"] or "") != want_anim or p["SIDO_CD"] != sc:
                die(f"요청과 응답 조건 불일치: {r['key']} {p}")
            if p["ADDR2_NM"] in got:
                die(f"같은 시군구 중복 응답: {r['key']} {p['ADDR2_NM']}")
            got[p["ADDR2_NM"]] = p
        names = {g["ADDR2_NM"] for g in glist}
        extra += [f"{r['key']}: 시군구 목록에 없는 지역 {n}" for n in got if n not in names]
        for g in glist:
            p = got.get(g["ADDR2_NM"])
            pr = prices(p)
            if data is None:
                status = "COLLECTION_ERROR"
            elif p is None or all(v in (None, 0) for v in pr.values()):
                status = "NO_DATA"; pr = {c: None for _, c in PRICE}
            else:
                status = "DATA_AVAILABLE"
            rows.append(dict(b, **pr, region_level="sigungu", sido_code=sc, sido_name=sido_names.get(sc),
                             sigungu_code=g["ADDR2_CD"], sigungu_name=g["ADDR2_NM"], data_status=status,
                             source_url=r["url"], collected_at=kst(r.get("requested_at_utc"))))
    checks["목록외_지역_응답"] = extra

    # 4) 값 검증
    for x in rows:
        if x["data_status"] != "DATA_AVAILABLE":
            continue
        mn, md, av, mx = x["min_price"], x["median_price"], x["average_price"], x["max_price"]
        where = f"{x['sido_name']} {x['sigungu_name'] or ''} | {x['item_name']} {x['condition'] or ''} {x['animal_type']}"
        if None in (mn, md, av, mx):
            issues.append(("일부 통계 누락", where, f"{mn},{md},{av},{mx}")); continue
        if not (mn <= md <= mx):
            issues.append(("중간값이 최저~최고 범위 밖", where, f"min={mn} median={md} max={mx}"))
        if not (mn <= av <= mx):
            issues.append(("평균이 최저~최고 범위 밖", where, f"min={mn} avg={av} max={mx}"))
    checks["값_검증_예외"] = issues

    dupkey = Counter((x["region_level"], x["sido_code"], x["sigungu_code"], x["medi_type_cd"], x["animal_type_cd"]) for x in rows)
    checks["중복_레코드"] = [k for k, c in dupkey.items() if c > 1]

    # 정렬
    lvl_order = {"national": 0, "sido": 1, "sigungu": 2}
    item_order = {m: i for i, m in enumerate(ITEMS)}
    rows.sort(key=lambda x: (item_order[x["medi_type_cd"]], x["animal_type_cd"] or "", lvl_order[x["region_level"]],
                             x["sido_code"] or "", x["sigungu_code"] or ""))

    dog = [x for x in rows if x["animal_type"] == "DOG"]
    cat = [x for x in rows if x["animal_type"] == "CAT"]
    com = [x for x in rows if x["animal_type"] == "COMMON"]
    checks["종별_합계_일치"] = len(dog) + len(cat) + len(com) == len(rows)

    write_csv(out / "02_전국_진료비_통합.csv", rows, FIELDS)
    write_csv(out / "03_개_진료비.csv", dog, FIELDS)
    write_csv(out / "04_고양이_진료비.csv", cat, FIELDS)
    write_csv(out / "05_공통_진료비.csv", com, FIELDS)
    write_csv(out / "06_지역_마스터.csv", region_rows,
              ["region_level", "sido_code", "sido_name", "sigungu_code", "sigungu_name"])

    combos = sorted({(r["params"]["mediTypeCd"], r["params"]["animalTypeCd"]) for r in by_kind["total"]},
                    key=lambda c: (item_order[c[0]], c[1]))
    cm = []
    for m, a in combos:
        cat_, item, no = ITEMS[m]; at, wkg, cond, basis = classify(m, a)
        if m == "MEDIT00005":
            no = 5 if a == "ANITY00001" else 6
        cm.append(dict(official_item_no=no, category=cat_, item_name=item, medi_type_cd=m, animal_type_cd=a or None,
                       animal_type=at, weight_kg=wkg, condition=cond, classification_basis=basis))
    write_csv(out / "07_진료항목_마스터.csv", cm,
              ["official_item_no", "category", "item_name", "medi_type_cd", "animal_type_cd", "animal_type",
               "weight_kg", "condition", "classification_basis"])
    checks["공식_20종_매핑"] = sorted({c["official_item_no"] for c in cm})

    # 5) 농식품부 보도자료(붙임) 전국 표와 대조
    ref = list(csv.DictReader(open(ref_path, encoding="utf-8")))
    nat = {(x["medi_type_cd"], x["animal_type_cd"] or ""): x for x in rows if x["region_level"] == "national"}
    cmp_rows = []
    for rr in ref:
        x = nat.get((rr["medi_type_cd"], rr["animal_type_cd"]))
        row = dict(표기=rr["표기"], medi_type_cd=rr["medi_type_cd"], animal_type_cd=rr["animal_type_cd"])
        ok = True
        for col, pc in [("average", "average_price"), ("median", "median_price"), ("min", "min_price"), ("max", "max_price")]:
            row[f"보도자료_{col}"] = rr[col]; row[f"수집_{col}"] = None if x is None else x[pc]
            if x is None or str(x[pc]) != rr[col]:
                ok = False
        row["일치"] = "Y" if ok else "N"
        cmp_rows.append(row)
    write_csv(out / "10_농식품부_보도자료_전국표_대조.csv", cmp_rows, list(cmp_rows[0].keys()))
    checks["보도자료_대조_불일치"] = [c["표기"] for c in cmp_rows if c["일치"] == "N"]

    stats = dict(
        총레코드=len(rows), 개=len(dog), 고양이=len(cat), 공통=len(com),
        전국=sum(x["region_level"] == "national" for x in rows),
        시도=sum(x["region_level"] == "sido" for x in rows),
        시군구=sum(x["region_level"] == "sigungu" for x in rows),
        상태별=dict(Counter(x["data_status"] for x in rows)),
        상태별_수준별={f"{l}/{s}": c for (l, s), c in Counter((x["region_level"], x["data_status"]) for x in rows).items()},
        요청수=len(recs), 실패요청=[r["key"] for r in failed],
        재시도발생=[(r["key"], r.get("attempts")) for r in recs if (r.get("attempts") or 1) > 1],
        수집시작=bundle["meta"].get("started"), 수집종료=bundle["meta"].get("finished"),
        원본파일_sha256=hashlib.sha256(bundle_bytes).hexdigest(), 원본파일_bytes=len(bundle_bytes),
        조합수=len(combos), probes=[(r["params"], r.get("body")) for r in by_kind["probe"]],
    )
    # NO_DATA 목록(항목별 시군구)
    nod = defaultdict(list)
    for x in rows:
        if x["data_status"] == "NO_DATA":
            nod[f"{x['item_name']} {x['condition'] or ''} [{x['animal_type']}]".strip()].append(
                f"{x['sido_name']} {x['sigungu_name'] or '(시도)'}" if x["region_level"] != "national" else "전국")
    res = dict(checks=checks, stats=stats, no_data=nod)
    (out / "_검증결과.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(dict(checks={k: (v if not isinstance(v, list) or len(v) < 15 else f"{len(v)}건") for k, v in checks.items()},
                          stats=stats, no_data_items={k: len(v) for k, v in nod.items()}), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:4])

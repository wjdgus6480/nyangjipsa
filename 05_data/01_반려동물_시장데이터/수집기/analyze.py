"""원본 CSV(01~06) → 분석용 CSV(11~19). 원본은 읽기만 한다. 분석 파일은 매번 새로 계산해 덮어쓴다(원본 근거로 재생성 가능).

원칙
- 검색 관심도(ratio)는 요청 1건 안에서 최댓값=100 으로 맞춘 상대지수다. 검색 횟수가 아니다.
- 쇼핑 클릭 지수도 상대지수다. 판매량이 아니다.
- 서로 다른 요청의 지수는 수준을 비교하지 않는다. 키워드 '내부' 변화율, 또는 같은 요청(비교그룹)끼리만 비교한다.
- 값이 없는 날/월은 결측(빈칸)으로 두고 0 으로 채우지 않는다.
"""
import csv, re, statistics as st, datetime as dt
from collections import defaultdict, Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW, OUT = ROOT / "원본", ROOT / "분석"


def read(name):
    p = RAW / name
    if not p.exists():
        return []
    with open(p, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def write(name, rows, cols):
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / name, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    print(f"  {name}: {len(rows)}행")


def r2(x, n=2):
    return "" if x is None else round(x, n)


def pct(new, old):
    if new is None or old is None or old == 0:
        return None
    return (new - old) / old * 100


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


D = lambda s: dt.date.fromisoformat(s[:10])

KW = {r["keyword_id"]: r for r in read("05_keyword_master.csv")}
TR = read("03_naver_search_trends_raw.csv")
SH = read("04_naver_shopping_insights_raw.csv")
BL = read("01_naver_blog_raw.csv")
NW = read("02_naver_news_raw.csv")


def latest(rows, keyfn):
    """같은 계열(keyfn)이 여러 번 수집됐으면 가장 최근 collected_at 요청만 쓴다(요청마다 지수 기준이 다르므로 섞지 않음)."""
    last = {}
    for r in rows:
        k = keyfn(r)
        if k not in last or r["collected_at"] > last[k][0]:
            last[k] = (r["collected_at"], r["request_id"])
    keep = {v[1] for v in last.values()}
    return [r for r in rows if r["request_id"] in keep]


def series(rows):
    s = {}
    for r in rows:
        if r["ratio"] not in ("", None):
            s[D(r["period"])] = float(r["ratio"])
    return dict(sorted(s.items()))


def kwinfo(kid):
    k = KW.get(kid, {})
    return {"keyword_id": kid, "동물종류": k.get("동물종류", ""), "대분류": k.get("대분류", ""),
            "소분류": k.get("소분류", ""), "검색키워드": k.get("검색키워드", "")}


# ---------- 계열 준비 ----------
tr_daily = defaultdict(list)
for r in latest([r for r in TR if r["request_type"] == "keyword_daily"], lambda r: r["keyword_id"]):
    tr_daily[r["keyword_id"]].append(r)
TRD = {k: series(v) for k, v in tr_daily.items()}

tr_long = defaultdict(list)
for r in latest([r for r in TR if r["request_type"] == "keyword_longterm_month"], lambda r: r["keyword_id"]):
    tr_long[r["keyword_id"]].append(r)
TRL = {k: series(v) for k, v in tr_long.items()}

sh_daily = defaultdict(list)
for r in latest([r for r in SH if r["request_type"] == "keyword_daily"], lambda r: r["keyword_id"]):
    sh_daily[r["keyword_id"]].append(r)
SHD = {k: series(v) for k, v in sh_daily.items()}
CAT_D = series(latest([r for r in SH if r["request_type"] == "category_daily"], lambda r: 1))
CAT_L = series(latest([r for r in SH if r["request_type"] == "category_longterm_month"], lambda r: 1))
sh_long = defaultdict(list)
for r in latest([r for r in SH if r["request_type"] == "keyword_longterm_month"], lambda r: r["keyword_id"]):
    sh_long[r["keyword_id"]].append(r)
SHL = {k: series(v) for k, v in sh_long.items()}

END = max([max(s) for s in list(TRD.values()) + list(SHD.values()) if s] + ([max(CAT_D)] if CAT_D else []), default=dt.date.today())


def window(s, days, offset=0):
    """END 기준 최근 days 일(offset 만큼 앞으로 밀기). 관측값 평균과 관측일수."""
    hi = END - dt.timedelta(days=offset)
    lo = hi - dt.timedelta(days=days - 1)
    v = [x for d, x in s.items() if lo <= d <= hi]
    return mean(v), len(v), lo, hi


def changes(s):
    out = {}
    for n in (7, 30, 90):
        a, na, lo1, hi1 = window(s, n)
        b, nb, lo0, hi0 = window(s, n, n)
        out[n] = dict(recent=a, prev=b, n_recent=na, n_prev=nb, chg=pct(a, b),
                      period=f"{lo1}~{hi1} vs {lo0}~{hi0}")
    # 12개월 추세: 월평균 12개에 대한 최소제곱 기울기 / 전체 평균 (월당 %)
    mon = defaultdict(list)
    for d, x in s.items():
        mon[(d.year, d.month)].append(x)
    months = sorted(mon)[-12:]
    ys = [mean(mon[m]) for m in months]
    slope = None
    if len(ys) >= 6:
        xs = list(range(len(ys)))
        mx, my = mean(xs), mean(ys)
        den = sum((x - mx) ** 2 for x in xs)
        slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den / my * 100 if my else None
    first3, last3 = mean(ys[:3]), mean(ys[-3:])
    out["12m"] = dict(slope=slope, chg=pct(last3, first3), months=len(ys),
                      period=f"{months[0][0]}-{months[0][1]:02d}~{months[-1][0]}-{months[-1][1]:02d}" if months else "")
    return out


METH = {7: "최근 7일 평균 ÷ 직전 7일 평균 −1 (일별 상대지수, 결측일 제외)",
        30: "최근 30일 평균 ÷ 직전 30일 평균 −1",
        90: "최근 90일 평균 ÷ 직전 90일 평균 −1",
        "12m": "최근 12개월 월평균의 선형회귀 기울기 ÷ 평균 (월당 %), 참고: 마지막 3개월÷처음 3개월 −1"}

# ---------- 12·13 상승·하락 ----------
growth, decline, allchg = [], [], {}
for src, data in (("검색어트렌드", TRD), ("쇼핑클릭(반려동물 카테고리)", SHD)):
    for kid, s in data.items():
        if not s:
            continue
        c = changes(s)
        allchg[(src, kid)] = c
        for w in (7, 30, 90, "12m"):
            x = c[w]
            val = x["slope"] if w == "12m" else x["chg"]
            row = {**kwinfo(kid), "데이터": src, "비교구간": f"{w}일" if w != "12m" else "12개월 추세",
                   "기준기간": x["period"],
                   "최근평균지수": r2(x.get("recent")), "직전평균지수": r2(x.get("prev")),
                   "관측일수_최근": x.get("n_recent", ""), "관측일수_직전": x.get("n_prev", ""),
                   "변화율_%": r2(val), "참고_마지막3개월vs처음3개월_%": r2(c["12m"]["chg"]) if w == "12m" else "",
                   "계산방법": METH[w], "주의": "상대지수(검색수·판매량 아님). 키워드 자체 기준의 변화율"}
            if val is None:
                continue
            if val >= 10 or (w == "12m" and val >= 2):
                growth.append(row)
            elif val <= -10 or (w == "12m" and val <= -2):
                decline.append(row)
cols_gd = ["데이터", "비교구간", "keyword_id", "동물종류", "대분류", "소분류", "검색키워드", "기준기간", "최근평균지수",
           "직전평균지수", "변화율_%", "관측일수_최근", "관측일수_직전", "참고_마지막3개월vs처음3개월_%", "계산방법", "주의"]
key = lambda r: (r["데이터"], r["비교구간"], -(r["변화율_%"] or 0))
write("12_keyword_growth.csv", sorted(growth, key=key), cols_gd)
write("13_keyword_decline.csv", sorted(decline, key=lambda r: (r["데이터"], r["비교구간"], r["변화율_%"] or 0)), cols_gd)

# ---------- 11 시장 전체 동향 (월별) ----------
mt = []


def monthly(s):
    m = defaultdict(list)
    for d, x in s.items():
        m[f"{d.year}-{d.month:02d}"].append(x)
    return {k: (mean(v), len(v)) for k, v in sorted(m.items())}


for kid, s in TRD.items():
    if KW.get(kid, {}).get("대분류") != "시장 전체 동향":
        continue
    for mth, (v, n) in monthly(s).items():
        mt.append({"구분": "검색어트렌드(키워드별 자체지수)", "대상": KW[kid]["검색키워드"], "동물종류": KW[kid]["동물종류"],
                   "월": mth, "지수": r2(v), "관측일수": n, "기준기간": f"{min(s)}~{max(s)}",
                   "계산방법": "일별 상대지수의 월평균. 대상끼리 수준 비교 불가(요청별 기준 다름)"})
for mth, (v, n) in monthly(CAT_D).items():
    mt.append({"구분": "쇼핑클릭(카테고리 50000155 반려동물)", "대상": "반려동물 카테고리", "동물종류": "공통", "월": mth,
               "지수": r2(v), "관측일수": n, "기준기간": f"{min(CAT_D)}~{max(CAT_D)}" if CAT_D else "",
               "계산방법": "일별 클릭 상대지수의 월평균 (판매량 아님)"})
cmp_m = latest([r for r in TR if r["request_type"] == "comparison_month" and r["compare_set"].startswith("동물비교")],
               lambda r: r["compare_set"])
_partial = (END + dt.timedelta(days=1)).month == END.month   # END 가 말일이 아니면 그 달은 미완결
for r in cmp_m:
    if r["ratio"] == "" or (_partial and r["period"][:7] == END.isoformat()[:7]):
        continue   # 월 단위 지수는 달 전체 합 기준이라 미완결 월은 낮게 나옴 → 제외
    mt.append({"구분": "검색어트렌드(동물비교: 한 요청 내 비교 가능)", "대상": r["group_name"],
               "동물종류": KW.get(r["keyword_id"], {}).get("동물종류", ""), "월": r["period"][:7], "지수": r["ratio"],
               "관측일수": "", "기준기간": f"{r['start_date']}~{r['end_date']}",
               "계산방법": "강아지·고양이·햄스터·앵무새·구피를 한 요청으로 받은 월별 지수(최댓값=100). 이 구분 안에서만 비교"})
write("11_market_trends.csv", mt, ["구분", "대상", "동물종류", "월", "지수", "관측일수", "기준기간", "계산방법"])

# ---------- 15 계절별 ----------
seas = []


def season_rows(src, kid, name, s, note):
    # 완결된 달만 (END 가 속한 달이 말일이 아니면 제외)
    cut = dt.date(END.year, END.month, 1)
    if (END + dt.timedelta(days=1)).month != END.month:
        cut = END + dt.timedelta(days=1)
    s = {d: x for d, x in s.items() if d < cut}
    if not s:
        return
    years = sorted({d.year for d in s})
    full_years = [y for y in years if sum(1 for d in s if d.year == y) == 12]
    by_m = defaultdict(list)
    for d, x in s.items():
        if d.year in full_years:
            by_m[d.month].append(x)
    overall = mean([x for v in by_m.values() for x in v])
    if not overall:
        return
    idx = {m: mean(v) / overall * 100 for m, v in by_m.items() if v}
    peak = max(idx, key=idx.get)
    low = min(idx, key=idx.get)
    # 반복성: 각 해에서 피크월이 그 해 상위 3개월에 든 해의 수
    rep = 0
    for y in full_years:
        yv = {d.month: x for d, x in s.items() if d.year == y}
        top3 = sorted(yv, key=yv.get, reverse=True)[:3]
        rep += peak in top3
    for m in range(1, 13):
        seas.append({"데이터": src, "keyword_id": kid, "대상": name, "월": m, "계절지수": r2(idx.get(m)),
                     "피크월": peak, "저점월": low, "피크월_상위3개월_반복연도수": rep, "사용연도수": len(full_years),
                     "기준기간": f"{full_years[0]}-01~{full_years[-1]}-12" if full_years else "",
                     "계산방법": "완결 연도의 월별 상대지수 평균 ÷ 전체 평균 ×100 (100=평균). " + note})


for kid, s in TRL.items():
    season_rows("검색어트렌드(2016~ 월별)", kid, KW.get(kid, {}).get("검색키워드", kid), s, "")
for kid, s in SHL.items():
    season_rows("쇼핑클릭(2017-08~ 월별)", kid, KW.get(kid, {}).get("검색키워드", kid), s, "")
season_rows("쇼핑클릭(2017-08~ 월별)", "CAT", "반려동물 카테고리", CAT_L, "")
write("15_seasonal_trends.csv", seas, ["데이터", "keyword_id", "대상", "월", "계절지수", "피크월", "저점월",
                                       "피크월_상위3개월_반복연도수", "사용연도수", "기준기간", "계산방법"])

# ---------- 16 콘텐츠 공급 ----------
STOP = "2025-11-23"
sup, supmap = [], {}
for src, rows, dk in (("블로그", BL, "post_date"), ("뉴스", NW, "pub_date")):
    by = defaultdict(dict)
    tot = {}
    for r in rows:
        by[r["keyword_id"]][r["link"]] = r[dk]   # 같은 키워드 안 같은 링크는 1건
        if r["collected_at"] >= tot.get(r["keyword_id"], ("", ""))[0]:
            tot[r["keyword_id"]] = (r["collected_at"], r["api_total"])
    for kid, links in by.items():
        ds = sorted(D(d) for d in links.values() if d)
        if not ds:
            continue
        lo, hi = ds[0], ds[-1]
        full = lo.isoformat() < STOP
        span_lo = max(lo, D(STOP))
        in_year = [d for d in ds if d >= D(STOP)]
        days = (hi - span_lo).days + 1
        per_day = len(in_year) / days if days > 0 else None

        def cnt(n, off=0):
            h = END - dt.timedelta(days=off)
            l = h - dt.timedelta(days=n - 1)
            if l < lo and not full:
                return None   # 수집 범위가 그 기간을 다 덮지 못함
            return sum(1 for d in ds if l <= d <= h)

        c30, p30 = cnt(30), cnt(30, 30)
        row = {**kwinfo(kid), "출처": src, "API_total(검색결과 총건수)": tot[kid][1], "수집건수(중복제거)": len(ds),
               "수집_가장오래된게시일": lo, "수집_가장최근게시일": hi, "기준일까지_도달": "Y" if full else "N(최근 결과만)",
               "일평균_게시수(수집범위)": r2(per_day), "최근7일": cnt(7) if cnt(7) is not None else "",
               "최근30일": "" if c30 is None else c30, "직전30일": "" if p30 is None else p30,
               "30일_공급변화율_%": r2(pct(c30, p30)),
               "기준기간": f"{span_lo}~{hi}",
               "계산방법": "date순 검색결과(최대 1,000건/키워드) 중복 제거 후 게시일 기준 집계. 1,000건 안에 기준일(2025-11-23)까지 못 닿으면 최근 일부만 반영"}
        sup.append(row)
        supmap[(src, kid)] = row
write("16_content_supply.csv", sup, ["출처", "keyword_id", "동물종류", "대분류", "소분류", "검색키워드",
                                     "API_total(검색결과 총건수)", "수집건수(중복제거)", "수집_가장오래된게시일",
                                     "수집_가장최근게시일", "기준일까지_도달", "일평균_게시수(수집범위)", "최근7일", "최근30일",
                                     "직전30일", "30일_공급변화율_%", "기준기간", "계산방법"])

# ---------- 17 쇼핑 관심도 ----------
shop = []


def share(rows_dim, dim):
    """같은 응답 안 기준이 같으므로 비중 계산 가능. 최근 월 값 사용."""
    if not rows_dim:
        return {}, ""
    lastp = max(r["period"] for r in rows_dim)
    vals = defaultdict(float)
    for r in rows_dim:
        if r["period"] == lastp and r["ratio"] != "":
            vals[r["dimension_value"]] += float(r["ratio"])
    t = sum(vals.values())
    return ({k: v / t * 100 for k, v in vals.items()} if t else {}), lastp[:7]


def shop_target(kid, name, s, dimrows):
    c = changes(s) if s else None
    out = {"keyword_id": kid, "대상": name, "동물종류": KW.get(kid, {}).get("동물종류", "공통"),
           "대분류": KW.get(kid, {}).get("대분류", "카테고리"),
           "7일_변화율_%": r2(c[7]["chg"]) if c else "", "30일_변화율_%": r2(c[30]["chg"]) if c else "",
           "90일_변화율_%": r2(c[90]["chg"]) if c else "", "12개월추세_월당%": r2(c["12m"]["slope"]) if c else ""}
    dv, m1 = share(dimrows.get("device", []), "device")
    gv, m2 = share(dimrows.get("gender", []), "gender")
    av, m3 = share(dimrows.get("age", []), "age")
    out.update({"모바일_비중_%": r2(dv.get("mo")), "PC_비중_%": r2(dv.get("pc")),
                "여성_비중_%": r2(gv.get("f")), "남성_비중_%": r2(gv.get("m")),
                "주요연령": (max(av, key=av.get) + "대") if av else "",
                **{f"{a}대_비중_%": r2(av.get(a)) for a in ("10", "20", "30", "40", "50", "60")},
                "비중_기준월": m1 or m2 or m3,
                "기준기간": f"{min(s)}~{max(s)}" if s else "",
                "계산방법": "변화율=일별 클릭 상대지수 기간평균 비교. 비중=같은 응답 안 기기/성별/연령 상대지수 합 대비 (최근 월). 클릭 기반이며 판매량 아님"})
    return out


def dimrows_for(kid, prefix):
    d = {}
    for dim in ("device", "gender", "age"):
        rows = [r for r in SH if r["request_type"] == f"{prefix}_{dim}_month" and r["keyword_id"] == kid]
        d[dim] = latest(rows, lambda r: 1)
    return d


shop.append(shop_target("", "반려동물 카테고리(50000155)", CAT_D, dimrows_for("", "category")))
for kid, s in SHD.items():
    shop.append(shop_target(kid, KW.get(kid, {}).get("검색키워드", kid), s, dimrows_for(kid, "keyword")))
write("17_shopping_interest.csv", shop, list(shop[0].keys()) if shop else ["대상"])

# ---------- 19 키워드 직접 비교 ----------
cmp_rows = []
for src, rows, rt in (("검색어트렌드", TR, "comparison_week"), ("쇼핑클릭", SH, "keyword_comparison_week")):
    sel = latest([r for r in rows if r["request_type"] == rt], lambda r: r["compare_set"])
    sets = defaultdict(lambda: defaultdict(dict))
    for r in sel:
        name = r.get("group_name") or r.get("result_title")
        if r["ratio"] != "":
            sets[r["compare_set"]][name][r["period"]] = float(r["ratio"])
    for cs, g in sets.items():
        periods = sorted({p for v in g.values() for p in v})
        wmax = {p: max(v.get(p, 0) for v in g.values()) for p in periods}
        means = {n: mean(list(v.values())) or 0 for n, v in g.items()}
        tot = sum(means.values())
        last4 = periods[-4:]
        prev4 = periods[-8:-4]
        for rank, (n, v) in enumerate(sorted(g.items(), key=lambda kv: -means[kv[0]]), 1):
            top_w = sum(1 for p in periods if v.get(p) is not None and v.get(p) == wmax[p])
            hold = sum(1 for p in periods if v.get(p) is not None and wmax[p] and v[p] >= 0.5 * wmax[p])
            a, b = mean([v.get(p) for p in last4]), mean([v.get(p) for p in prev4])
            cmp_rows.append({"데이터": src, "비교그룹": cs, "키워드": n, "순위(평균)": rank, "평균지수": r2(means[n]),
                             "그룹내_비중_%": r2(means[n] / tot * 100 if tot else None),
                             "최근4주평균": r2(a), "직전4주평균": r2(b), "4주_변화율_%": r2(pct(a, b)),
                             "1위_주수": top_w, "주수": len(periods),
                             "지속인기(주의 80%이상에서 그 주 1위의 50%이상)": "Y" if periods and hold / len(periods) >= 0.8 else "N",
                             "기준기간": f"{periods[0]}~{periods[-1]}" if periods else "",
                             "계산방법": "한 요청으로 함께 받은 주별 상대지수(그룹 최댓값=100)로만 비교. 다른 그룹과는 비교 불가"})
write("19_keyword_comparison.csv", cmp_rows, list(cmp_rows[0].keys()) if cmp_rows else ["비교그룹"])

# ---------- 14 신규 관심사 후보 ----------
terms = set()
for k in KW.values():
    for t in [k.get("검색키워드", "")] + (k.get("연관키워드") or "").split("|"):
        t = t.strip()
        if t:
            terms.add(t.replace(" ", ""))
STOPW = set("""강아지 고양이 반려동물 반려견 반려묘 애견 애묘 우리 오늘 후기 추천 정보 방법 이유 정리 리뷰 진짜 너무 그리고
하는 있는 없는 위한 대한 함께 그냥 정말 이번 이제 하기 보기 같은 많은 위해 통해 가장 다시 관련 사진 영상 소개 이야기
일상 기록 내돈내산 솔직 최고 완벽 필수 무료 할인 이벤트 공유 꿀팁 총정리 가격 구매 사용 사용후기 브랜드 제품 종류
뉴스 기자 지난 올해 내년 최근 지역 개최 진행 운영 지원 사업 시장 국내 서울 부산 경기 2025 2026 2025년 2026년 펫 PET pet""".split())
STOPW |= set("""겨울 여름 가을 관리 좋은 선택 기준 비교 직접 다양한 아이템 맛집 카페 여행 건강 아기 아이 우리집 우리아이 처음 시작 준비
방문 체험 구입 가성비 꼭 알아야 할 것 때 수 더 잘 안 왜 어떻게 무엇 모든 모두 함께한 하루 주말 일기 블로그 포스팅 제품리뷰
일산 강남 대구 인천 광주 대전 울산 수원 제주 성수 홍대 분당 판교 송파 마포 용인 고양 김포 파주 하남 남양주 동탄 의정부 청주 천안 전주""".split())
MONTH = re.compile(r"\d{1,2}(월|일|년|세|개월|kg|g|주차)?|시즌\d+")
ENDS = tuple("는 한 할 본 니 까 서 에 와 과 을 를 도 고 게 지 요 다 로 면 은 의 던 운 인 된 될 함 됨".split())  # 조사·어미로 끝나는 말 제외(명사 위주)
tok_re = re.compile(r"[가-힣A-Za-z0-9]{2,}")
cnt_recent, cnt_prev, kwset, examples, firstseen = Counter(), Counter(), defaultdict(set), {}, {}
recent_lo = END - dt.timedelta(days=29)
docs_seen = set()
for src, rows, dk in (("블로그", BL, "post_date"), ("뉴스", NW, "pub_date")):
    for r in rows:
        if not r[dk] or r[dk] < STOP:
            continue
        key = r["link"]
        if key in docs_seen:      # 여러 키워드에서 같은 글이 잡혀도 1번만 센다
            kwset_add = True
        toks = [t for t in tok_re.findall(r["title"]) if t not in STOPW and not t.isdigit()]
        cands = set()
        for i, t in enumerate(toks):
            cands.add(t)
            if i + 1 < len(toks):
                cands.add(t + " " + toks[i + 1])
        cands = {c for c in cands
                 if not any(c.replace(" ", "") in t or t in c.replace(" ", "") for t in terms)
                 and not any(w in STOPW or MONTH.fullmatch(w) or w.endswith(ENDS) for w in c.split())}
        for c in cands:
            kwset[c].add(r["keyword_id"])
        if key in docs_seen:
            continue
        docs_seen.add(key)
        d = D(r[dk])
        for c in cands:
            (cnt_recent if d >= recent_lo else cnt_prev)[c] += 1
            examples.setdefault(c, r["title"][:80])
            firstseen[c] = min(firstseen.get(c, d), d)
newi = []
for c in set(cnt_recent) | set(cnt_prev):
    tot_c = cnt_recent[c] + cnt_prev[c]
    if tot_c < 8 or len(kwset[c]) < 2:   # 2개 이상 키워드 검색결과에서 함께 나온 표현만
        continue
    newi.append({"후보표현": c, "형태": "2어절" if " " in c else "1어절", "등장문서수_전체": tot_c,
                 "등장문서수_최근30일": cnt_recent[c], "등장문서수_이전": cnt_prev[c],
                 "최근30일_비중_%": r2(cnt_recent[c] / tot_c * 100),
                 "함께잡힌_키워드수": len(kwset[c]),
                 "함께잡힌_키워드": ", ".join(sorted(KW.get(k, {}).get("검색키워드", k) for k in kwset[c]))[:120],
                 "처음발견_게시일": firstseen[c], "예시제목": examples[c],
                 "기준기간": f"{STOP}~{END} (최근30일={recent_lo}~{END})",
                 "계산방법": "블로그·뉴스 제목을 2자 이상 단어/2어절로 나눠 키워드목록에 없는 표현만 문서 단위로 셈(같은 링크 1회). 수집범위가 키워드마다 달라 최근 쪽으로 치우침 → 후보일 뿐, 검색어트렌드로 확인 필요"})
newi.sort(key=lambda r: (-r["등장문서수_최근30일"], -r["등장문서수_전체"]))
write("14_new_interest_candidates.csv", newi[:400], list(newi[0].keys()) if newi else ["후보표현"])

# ---------- 18 콘텐츠 기회 후보 ----------
opp = []
for kid, k in KW.items():
    if (k.get("활성화") or "").upper() != "Y":
        continue
    c = allchg.get(("검색어트렌드", kid))
    cs = allchg.get(("쇼핑클릭(반려동물 카테고리)", kid))
    b, n = supmap.get(("블로그", kid), {}), supmap.get(("뉴스", kid), {})
    opp.append({**kwinfo(kid), "검색_30일변화_%": r2(c[30]["chg"]) if c else "", "검색_90일변화_%": r2(c[90]["chg"]) if c else "",
                "검색_12개월추세_월당%": r2(c["12m"]["slope"]) if c else "",
                "블로그_총건수(API total)": b.get("API_total(검색결과 총건수)", ""),
                "블로그_일평균게시": b.get("일평균_게시수(수집범위)", ""), "블로그_30일공급변화_%": b.get("30일_공급변화율_%", ""),
                "뉴스_일평균게시": n.get("일평균_게시수(수집범위)", ""), "뉴스_30일공급변화_%": n.get("30일_공급변화율_%", ""),
                "쇼핑클릭_30일변화_%": r2(cs[30]["chg"]) if cs else ""})


def prank(vals, v, higher_better=True):
    vals = [x for x in vals if x not in ("", None)]
    if v in ("", None) or not vals:
        return None
    below = sum(1 for x in vals if (x < v if higher_better else x > v))
    return below / max(len(vals) - 1, 1) * 100


cols_ = {"검색_30일변화_%": True, "검색_90일변화_%": True, "블로그_일평균게시": False, "쇼핑클릭_30일변화_%": True}
allv = {c: [r[c] for r in opp] for c in cols_}
for r in opp:
    parts = {c: prank(allv[c], r[c], hb) for c, hb in cols_.items()}
    w = {"검색_30일변화_%": 0.35, "검색_90일변화_%": 0.25, "블로그_일평균게시": 0.25, "쇼핑클릭_30일변화_%": 0.15}
    have = {c: v for c, v in parts.items() if v is not None}
    score = sum(have[c] * w[c] for c in have) / sum(w[c] for c in have) if have else None
    r["기회점수(0~100)"] = r2(score, 1)
    sup_up = r["블로그_30일공급변화_%"]
    sig = []
    if r["검색_30일변화_%"] not in ("", None) and r["검색_30일변화_%"] > 0: sig.append("검색↑")
    if r["검색_90일변화_%"] not in ("", None) and r["검색_90일변화_%"] > 0: sig.append("90일↑")
    if r["쇼핑클릭_30일변화_%"] not in ("", None) and r["쇼핑클릭_30일변화_%"] > 0: sig.append("쇼핑↑")
    if sup_up not in ("", None) and r["검색_30일변화_%"] not in ("", None) and r["검색_30일변화_%"] > sup_up: sig.append("검색증가>공급증가")
    r["신호"] = " ".join(sig)
    r["후보등급"] = "" if score is None else ("A 후보" if score >= 65 else "B 관찰" if score >= 45 else "C 낮음")
    r["기준기간"] = f"검색·쇼핑 {END - dt.timedelta(days=89)}~{END}, 공급=16번 파일 기준"
    r["계산방법"] = ("백분위 가중합: 검색30일변화 35% + 검색90일변화 25% + 블로그 일평균게시(적을수록 높음) 25% + 쇼핑30일변화 15%. "
                   "없는 항목은 빼고 가중치 재조정. 구매전환·수요 확정 아님, 후보 선별용")
opp.sort(key=lambda r: -(r["기회점수(0~100)"] or -1))
write("18_content_opportunities.csv", opp, list(opp[0].keys()) if opp else ["검색키워드"])
print(f"[분석 완료] 기준 마지막 날짜 {END}")

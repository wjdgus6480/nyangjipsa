"""반려동물 시장 데이터 수집기 (NAVER API HUB) — 기존 블로그 프로그램과 무관한 독립 실행 스크립트.

인증: 환경변수 NAVER_APIHUB_CLIENT_ID / NAVER_APIHUB_CLIENT_SECRET
      (없으면 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET, 그것도 없으면 config.json 의 env_file_fallback 파일을 읽기만 함)
키 값은 화면·로그·CSV 어디에도 쓰지 않는다.

원본 CSV 는 추가(append)만 한다. 기존 행을 지우거나 덮어쓰지 않는다.
"""
import csv, json, os, re, sys, time, uuid, html, datetime as dt
import urllib.request, urllib.parse, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "원본"
CFG = json.loads((Path(__file__).parent / "config.json").read_text(encoding="utf-8"))
HOST = "https://naverapihub.apigw.ntruss.com"
KST = dt.timezone(dt.timedelta(hours=9))

F_BLOG, F_NEWS = RAW / "01_naver_blog_raw.csv", RAW / "02_naver_news_raw.csv"
F_TREND, F_SHOP = RAW / "03_naver_search_trends_raw.csv", RAW / "04_naver_shopping_insights_raw.csv"
F_KW, F_LOG = RAW / "05_keyword_master.csv", RAW / "06_collection_log.csv"

COLS = {
    F_BLOG: ["collected_at", "run_id", "request_id", "keyword_id", "query", "sort", "start", "display", "api_total",
             "api_lastBuildDate", "rank_in_request", "title_raw", "title", "link", "description", "bloggername",
             "bloggerlink", "postdate_raw", "post_date"],
    F_NEWS: ["collected_at", "run_id", "request_id", "keyword_id", "query", "sort", "start", "display", "api_total",
             "api_lastBuildDate", "rank_in_request", "title_raw", "title", "originallink", "link", "description",
             "pubDate_raw", "pub_date", "pub_datetime_kst"],
    F_TREND: ["collected_at", "run_id", "request_id", "request_type", "keyword_id", "group_name", "keywords_sent",
              "compare_set", "start_date", "end_date", "time_unit", "device", "gender", "ages", "segment_label",
              "period", "ratio"],
    F_SHOP: ["collected_at", "run_id", "request_id", "endpoint", "request_type", "category_id", "keyword_id", "keyword",
             "compare_set", "start_date", "end_date", "time_unit", "device_filter", "gender_filter", "ages_filter",
             "result_title", "dimension", "dimension_value", "period", "ratio"],
    F_LOG: ["run_id", "request_id", "requested_at", "api", "endpoint", "request_summary", "http_status", "ok",
            "rows_saved", "error_code", "error_message", "duration_ms"],
}

SEARCH_AGES = {"0-18세": ["1", "2"], "19-29세": ["3", "4"], "30대": ["5", "6"], "40대": ["7", "8"], "50세 이상": ["9", "10", "11"]}
SHOP_AGES = ["10", "20", "30", "40", "50", "60"]


# ---------- 공통 ----------
def creds():
    cid = os.environ.get("NAVER_APIHUB_CLIENT_ID") or os.environ.get("NAVER_CLIENT_ID")
    sec = os.environ.get("NAVER_APIHUB_CLIENT_SECRET") or os.environ.get("NAVER_CLIENT_SECRET")
    if not (cid and sec):
        p = Path(CFG.get("env_file_fallback", ""))
        if p.is_file():
            env = {}
            for line in p.read_text(encoding="utf-8").splitlines():
                if "=" in line and not line.lstrip().startswith("#"):
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
            cid = cid or env.get("NAVER_APIHUB_CLIENT_ID") or env.get("NAVER_CLIENT_ID")
            sec = sec or env.get("NAVER_APIHUB_CLIENT_SECRET") or env.get("NAVER_CLIENT_SECRET")
    if not (cid and sec):
        sys.exit("[중단] 인증정보 없음. 환경변수 NAVER_APIHUB_CLIENT_ID, NAVER_APIHUB_CLIENT_SECRET 를 설정하세요 "
                 "(NCP 콘솔 > NAVER API HUB > Application > 인증 정보).")
    return cid, sec


def now():
    return dt.datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S")


def append(path, rows):
    if not rows:
        return
    for attempt in range(30):  # 엑셀·동기화·백신이 파일을 잠깐 잡고 있으면 기다렸다 다시 시도
        try:
            new = not path.exists()
            with open(path, "w" if new else "a", encoding="utf-8-sig" if new else "utf-8", newline="") as f:
                w = csv.DictWriter(f, fieldnames=COLS[path], extrasaction="ignore")
                if new:
                    w.writeheader()
                w.writerows(rows)
            return
        except PermissionError:
            if attempt == 29:
                raise
            print(f"  [대기] {path.name} 파일이 잠겨 있음 (엑셀로 열려 있으면 닫아 주세요)")
            time.sleep(2)


def read(path):
    if not path.exists():
        return []
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def clean(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


class Client:
    def __init__(self, run_id):
        self.cid, self.sec = creds()
        self.run_id = run_id
        self.calls = 0
        self.fail = 0

    def call(self, api, method, path, params=None, body=None):
        rid = uuid.uuid4().hex[:12]
        url = HOST + path + ("?" + urllib.parse.urlencode(params) if params else "")
        hdr = {"X-NCP-APIGW-API-KEY-ID": self.cid, "X-NCP-APIGW-API-KEY": self.sec}
        data = None
        if body is not None:
            hdr["Content-Type"] = "application/json"
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        summary = json.dumps(params if params else body, ensure_ascii=False)[:600]
        t0, status, res, ecode, emsg = time.time(), None, None, "", ""
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, data=data, headers=hdr, method=method)
                with urllib.request.urlopen(req, timeout=30) as r:
                    status, res = r.status, json.loads(r.read().decode("utf-8"))
                ecode = emsg = ""
                break
            except urllib.error.HTTPError as e:
                status = e.code
                txt = e.read().decode("utf-8", "replace")[:500]
                try:
                    j = json.loads(txt)
                    err = j.get("error") if isinstance(j.get("error"), dict) else j
                    ecode = str(err.get("errorCode") or err.get("errId") or "")
                    emsg = str(err.get("message") or err.get("errorMessage") or err.get("errMsg") or txt)
                except Exception:
                    ecode, emsg = "", txt
                if status in (429, 500, 502, 503) and attempt < 3:
                    time.sleep(2 ** attempt)
                    continue
                break
            except Exception as e:  # 네트워크 오류
                status, ecode, emsg = 0, type(e).__name__, str(e)[:300]
                if attempt < 3:
                    time.sleep(2 ** attempt)
                    continue
                break
        self.calls += 1
        ok = res is not None
        if not ok:
            self.fail += 1
        log = {"run_id": self.run_id, "request_id": rid, "requested_at": now(), "api": api, "endpoint": path,
               "request_summary": summary, "http_status": status, "ok": "Y" if ok else "N", "rows_saved": "",
               "error_code": ecode, "error_message": emsg, "duration_ms": int((time.time() - t0) * 1000)}
        time.sleep(CFG.get("request_sleep_sec", 0.1))
        return rid, res, log


# ---------- 키워드 ----------
def keywords():
    if not F_KW.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        init = (Path(__file__).parent / "keyword_master_init.csv").read_text(encoding="utf-8")
        F_KW.write_text(init, encoding="utf-8-sig")
    rows = read(F_KW)
    out = []
    for r in rows:
        if (r.get("활성화") or "").strip().upper() != "Y" or not r.get("검색키워드", "").strip():
            continue
        rel = [x.strip() for x in (r.get("연관키워드") or "").split("|") if x.strip()]
        r["terms"] = list(dict.fromkeys([r["검색키워드"].strip()] + rel))[:20]
        out.append(r)
    return out


# ---------- 검색 (블로그·뉴스) ----------
def collect_search(cl, kind, kws, logs):
    path, f = ("/search/v1/blog", F_BLOG) if kind == "blog" else ("/search/v1/news", F_NEWS)
    seen = {(r["keyword_id"], r["link"]) for r in read(f)}
    sc = CFG["search"]
    stop = sc["stop_before_date"]
    total_new = 0
    for k in kws:
        q = k["검색키워드"].strip()
        start = 1
        while start <= sc["max_start"]:
            params = {"query": q, "display": sc["display"], "start": start, "sort": sc["sort"]}
            rid, res, log = cl.call(kind, "GET", path, params=params)
            rows, oldest, all_seen = [], None, True
            if res:
                for i, it in enumerate(res.get("items", []), 1):
                    if kind == "blog":
                        pd_raw = it.get("postdate", "")
                        d = f"{pd_raw[:4]}-{pd_raw[4:6]}-{pd_raw[6:8]}" if len(pd_raw) == 8 else ""
                        extra = {"bloggername": it.get("bloggername"), "bloggerlink": it.get("bloggerlink"),
                                 "postdate_raw": pd_raw, "post_date": d}
                    else:
                        pr = it.get("pubDate", "")
                        try:
                            t = dt.datetime.strptime(pr, "%a, %d %b %Y %H:%M:%S %z").astimezone(KST)
                            d, full = t.strftime("%Y-%m-%d"), t.strftime("%Y-%m-%d %H:%M:%S")
                        except ValueError:
                            d, full = "", ""
                        extra = {"originallink": it.get("originallink"), "pubDate_raw": pr, "pub_date": d,
                                 "pub_datetime_kst": full}
                    if d:
                        oldest = d if oldest is None or d < oldest else oldest
                    key = (k["keyword_id"], it.get("link", ""))
                    if key in seen:
                        continue
                    all_seen = False
                    seen.add(key)
                    rows.append({"collected_at": log["requested_at"], "run_id": cl.run_id, "request_id": rid,
                                 "keyword_id": k["keyword_id"], "query": q, "sort": sc["sort"], "start": start,
                                 "display": sc["display"], "api_total": res.get("total"),
                                 "api_lastBuildDate": res.get("lastBuildDate"), "rank_in_request": start + i - 1,
                                 "title_raw": it.get("title"), "title": clean(it.get("title")),
                                 "link": it.get("link"), "description": clean(it.get("description")), **extra})
            log["rows_saved"] = len(rows)
            logs.append(log)
            append(f, rows)
            total_new += len(rows)
            n_items = len(res.get("items", [])) if res else 0
            if not res or n_items < sc["display"]:
                break
            if oldest and oldest < stop:   # 기준일 이전까지 내려가면 멈춤
                break
            if all_seen:                    # 누적 수집: 이미 받은 구간에 닿으면 멈춤
                break
            start += sc["display"]
        print(f"  {kind} {q}: 누적 신규 {total_new}")
    return total_new


# ---------- 데이터랩 검색어 트렌드 ----------
def trend_rows(cl, rid, log, res, meta):
    rows = []
    for r in res.get("results", []):
        for p in r.get("data", []):
            rows.append({"collected_at": log["requested_at"], "run_id": cl.run_id, "request_id": rid,
                         "group_name": r.get("title"), "keywords_sent": "|".join(r.get("keywords", [])),
                         "start_date": res.get("startDate"), "end_date": res.get("endDate"),
                         "time_unit": res.get("timeUnit"), "period": p.get("period"), "ratio": p.get("ratio"), **meta})
    return rows


def trend_call(cl, logs, groups, start, end, unit, meta, device="", gender="", ages=None):
    body = {"startDate": start, "endDate": end, "timeUnit": unit, "keywordGroups": groups}
    if device: body["device"] = device
    if gender: body["gender"] = gender
    if ages: body["ages"] = ages
    rid, res, log = cl.call("search_trend", "POST", "/search-trend/v1/search", body=body)
    rows = trend_rows(cl, rid, log, res, {**meta, "device": device, "gender": gender, "ages": "|".join(ages or [])}) if res else []
    # 그룹별 키워드 id 연결
    gid = {g["groupName"]: g.get("_kid", "") for g in groups}
    for r in rows:
        r["keyword_id"] = gid.get(r["group_name"]) or meta.get("keyword_id", "")
    log["rows_saved"] = len(rows)
    logs.append(log)
    append(F_TREND, rows)
    return len(rows)


def collect_trend(cl, kws, logs, start, end, en):
    n = 0
    for k in kws:
        g = [{"groupName": k["검색키워드"], "keywords": k["terms"], "_kid": k["keyword_id"]}]
        body_g = [{kk: vv for kk, vv in g[0].items() if kk != "_kid"}]
        base = {"keyword_id": k["keyword_id"], "compare_set": ""}
        n += trend_call(cl, logs, body_g, start, end, "date", {**base, "request_type": "keyword_daily", "segment_label": "전체"})
        if en.get("search_trend_longterm"):
            n += trend_call(cl, logs, body_g, CFG["search_trend_longterm_start"], end, "month",
                            {**base, "request_type": "keyword_longterm_month", "segment_label": "전체"})
        if en.get("search_trend_segments"):
            for dev, lab in (("pc", "PC"), ("mo", "모바일")):
                n += trend_call(cl, logs, body_g, start, end, "week", {**base, "request_type": "segment_device", "segment_label": lab}, device=dev)
            for gen, lab in (("m", "남성"), ("f", "여성")):
                n += trend_call(cl, logs, body_g, start, end, "week", {**base, "request_type": "segment_gender", "segment_label": lab}, gender=gen)
            for lab, ages in SEARCH_AGES.items():
                n += trend_call(cl, logs, body_g, start, end, "week", {**base, "request_type": "segment_age", "segment_label": lab}, ages=ages)
        print(f"  trend {k['검색키워드']}: 누적 {n}행")
    # 비교그룹: 한 요청 안에서만 상대 비교가 성립
    sets = {}
    for k in kws:
        if k.get("비교그룹"):
            sets.setdefault(k["비교그룹"], []).append(k)
    for name, ks in sets.items():
        for i in range(0, len(ks), 5):
            chunk = ks[i:i + 5]
            if len(chunk) < 2:
                continue
            groups = [{"groupName": k["검색키워드"], "keywords": k["terms"]} for k in chunk]
            for g, k in zip(groups, chunk):
                g["_kid"] = k["keyword_id"]
            body = [{kk: vv for kk, vv in g.items() if kk != "_kid"} for g in groups]
            cs = f"{name}#{i // 5 + 1}"
            meta = {"request_type": "comparison_week", "compare_set": cs, "segment_label": "전체", "keyword_id": ""}
            body_with = [dict(b, _kid=g["_kid"]) for b, g in zip(body, groups)]
            n += trend_call_cmp(cl, logs, body_with, start, end, "week", meta)
            meta2 = dict(meta, request_type="comparison_month")
            n += trend_call_cmp(cl, logs, body_with, start, end, "month", meta2)
    return n


def trend_call_cmp(cl, logs, groups_with_kid, start, end, unit, meta):
    gid = {g["groupName"]: g["_kid"] for g in groups_with_kid}
    body = [{k: v for k, v in g.items() if k != "_kid"} for g in groups_with_kid]
    req = {"startDate": start, "endDate": end, "timeUnit": unit, "keywordGroups": body}
    rid, res, log = cl.call("search_trend", "POST", "/search-trend/v1/search", body=req)
    rows = trend_rows(cl, rid, log, res, {**meta, "device": "", "gender": "", "ages": ""}) if res else []
    for r in rows:
        r["keyword_id"] = gid.get(r["group_name"], "")
    log["rows_saved"] = len(rows)
    logs.append(log)
    append(F_TREND, rows)
    return len(rows)


# ---------- 데이터랩 쇼핑인사이트 ----------
def shop_call(cl, logs, endpoint, body, meta):
    rid, res, log = cl.call("shopping_insight", "POST", endpoint, body=body)
    rows = []
    if res:
        for r in res.get("results", []):
            for p in r.get("data", []):
                # 기기·성별·연령 응답은 data[].group 에 값(pc/mo, f/m, 10~60)이 온다
                dim = next((d for d in ("device", "gender", "age") if endpoint.endswith("/" + d)), "")
                val = p.get("group", "")
                rows.append({"collected_at": log["requested_at"], "run_id": cl.run_id, "request_id": rid,
                             "endpoint": endpoint, "start_date": res.get("startDate"), "end_date": res.get("endDate"),
                             "time_unit": res.get("timeUnit"), "result_title": r.get("title"),
                             "dimension": dim, "dimension_value": val, "period": p.get("period"),
                             "ratio": p.get("ratio"), **meta})
    log["rows_saved"] = len(rows)
    logs.append(log)
    append(F_SHOP, rows)
    return len(rows)


def collect_shop(cl, kws, logs, start, end):
    sc = CFG["shopping_category"]
    cat, par = sc["id"], sc["parent_id"]
    m0 = {"category_id": cat, "keyword_id": "", "keyword": "", "compare_set": "", "device_filter": "",
          "gender_filter": "", "ages_filter": ""}
    n = 0
    n += shop_call(cl, logs, "/shopping/v1/categories",
                   {"startDate": start, "endDate": end, "timeUnit": "date", "category": [{"name": sc["name"], "param": [cat]}]},
                   {**m0, "request_type": "category_daily"})
    n += shop_call(cl, logs, "/shopping/v1/categories",
                   {"startDate": CFG["shopping_longterm_start"], "endDate": end, "timeUnit": "month",
                    "category": [{"name": sc["name"], "param": [cat]}]}, {**m0, "request_type": "category_longterm_month"})
    n += shop_call(cl, logs, "/shopping/v1/categories",
                   {"startDate": start, "endDate": end, "timeUnit": "week",
                    "category": [{"name": sc["name"], "param": [cat]}, {"name": sc["parent_name"], "param": [par]}]},
                   {**m0, "request_type": "category_vs_parent_week", "compare_set": "반려동물vs생활건강"})
    for ep, rt in (("/shopping/v1/category/device", "category_device"), ("/shopping/v1/category/gender", "category_gender"),
                   ("/shopping/v1/category/age", "category_age")):
        n += shop_call(cl, logs, ep, {"startDate": start, "endDate": end, "timeUnit": "month", "category": cat},
                       {**m0, "request_type": rt + "_month"})
    shop_kws = [k for k in kws if (k.get("쇼핑수집") or "").upper() == "Y"]
    for k in shop_kws:
        q = k["검색키워드"].strip()
        mk = {**m0, "keyword_id": k["keyword_id"], "keyword": q}
        kw_body = [{"name": q, "param": [q]}]
        n += shop_call(cl, logs, "/shopping/v1/category/keywords",
                       {"startDate": start, "endDate": end, "timeUnit": "date", "category": cat, "keyword": kw_body},
                       {**mk, "request_type": "keyword_daily"})
        n += shop_call(cl, logs, "/shopping/v1/category/keywords",
                       {"startDate": CFG["shopping_longterm_start"], "endDate": end, "timeUnit": "month", "category": cat,
                        "keyword": kw_body}, {**mk, "request_type": "keyword_longterm_month"})
        for ep, rt in (("/shopping/v1/category/keyword/device", "keyword_device"),
                       ("/shopping/v1/category/keyword/gender", "keyword_gender"),
                       ("/shopping/v1/category/keyword/age", "keyword_age")):
            n += shop_call(cl, logs, ep, {"startDate": start, "endDate": end, "timeUnit": "month", "category": cat,
                                          "keyword": q}, {**mk, "request_type": rt + "_month"})
        print(f"  shopping {q}: 누적 {n}행")
    sets = {}
    for k in shop_kws:
        if k.get("비교그룹"):
            sets.setdefault(k["비교그룹"], []).append(k)
    for name, ks in sets.items():
        for i in range(0, len(ks), 5):
            chunk = ks[i:i + 5]
            if len(chunk) < 2:
                continue
            body = [{"name": k["검색키워드"], "param": [k["검색키워드"]]} for k in chunk]
            n += shop_call(cl, logs, "/shopping/v1/category/keywords",
                           {"startDate": start, "endDate": end, "timeUnit": "week", "category": cat, "keyword": body},
                           {**m0, "request_type": "keyword_comparison_week", "compare_set": f"{name}#{i // 5 + 1}"})
    return n


# ---------- 실행 ----------
def main():
    RAW.mkdir(parents=True, exist_ok=True)
    en = CFG["enabled"]
    only = set(sys.argv[1:])  # 예: python collect.py blog news
    if only:
        en = {k: bool(en[k]) and any(k == o or k.startswith(o + "_") for o in only) for k in en}
    end = CFG["end_date"]
    if end == "auto_yesterday":
        end = (dt.datetime.now(KST).date() - dt.timedelta(days=1)).isoformat()
    start = CFG["initial_start_date"]
    run_id = dt.datetime.now(KST).strftime("%Y%m%d_%H%M%S")
    cl = Client(run_id)
    kws = keywords()
    print(f"[run {run_id}] 키워드 {len(kws)}개, 기간 {start} ~ {end}")
    logs, res = [], {}
    try:
        if en.get("blog"):
            res["blog"] = collect_search(cl, "blog", kws, logs); append(F_LOG, logs); logs.clear()
        if en.get("news"):
            res["news"] = collect_search(cl, "news", kws, logs); append(F_LOG, logs); logs.clear()
        if en.get("search_trend"):
            res["search_trend"] = collect_trend(cl, kws, logs, start, end, en); append(F_LOG, logs); logs.clear()
        if en.get("shopping_insight"):
            res["shopping_insight"] = collect_shop(cl, kws, logs, start, end); append(F_LOG, logs); logs.clear()
    finally:
        append(F_LOG, logs)
    print(f"[완료] 호출 {cl.calls}회 (실패 {cl.fail}) / 저장 행: {res}")


if __name__ == "__main__":
    main()

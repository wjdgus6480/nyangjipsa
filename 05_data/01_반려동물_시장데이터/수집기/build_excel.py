"""원본·분석 CSV → 엑셀 보고서 1개 (안내 / 요약 / 시각화 / 데이터 시트). CSV 는 읽기만 한다."""
import csv, datetime as dt
from collections import defaultdict
from pathlib import Path
from openpyxl import Workbook
from openpyxl.chart import LineChart, BarChart, PieChart, Reference
from openpyxl.chart.label import DataLabelList
from openpyxl.formatting.rule import ColorScaleRule, DataBarRule
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

ROOT = Path(__file__).resolve().parent.parent
RAW, ANA = ROOT / "원본", ROOT / "분석"
OUTX = ROOT / "반려동물_시장분석_보고서.xlsx"

NAVY, GREEN, LIGHT, GREY = "1F3A5F", "2E7D5B", "EEF3F8", "6B7280"
H1 = Font(name="맑은 고딕", size=18, bold=True, color=NAVY)
H2 = Font(name="맑은 고딕", size=13, bold=True, color=NAVY)
B = Font(name="맑은 고딕", size=10)
BB = Font(name="맑은 고딕", size=10, bold=True)
SM = Font(name="맑은 고딕", size=9, color=GREY)
HEAD = PatternFill("solid", fgColor=NAVY)
CARD = PatternFill("solid", fgColor=LIGHT)
thin = Side(style="thin", color="D0D7E2")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)


def read(p):
    if not p.exists():
        return []
    with open(p, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def num(v):
    try:
        f = float(v)
        return int(f) if f.is_integer() and "." not in str(v) else f
    except (TypeError, ValueError):
        return v


def table_sheet(wb, title, rows, note=""):
    ws = wb.create_sheet(title)
    start = 1
    if note:
        ws.cell(1, 1, note).font = SM
        start = 3
    if not rows:
        ws.cell(start, 1, "데이터 없음").font = B
        return ws
    cols = list(rows[0].keys())
    for j, c in enumerate(cols, 1):
        cell = ws.cell(start, j, c)
        cell.font = Font(name="맑은 고딕", size=10, bold=True, color="FFFFFF")
        cell.fill = HEAD
        cell.alignment = Alignment(wrap_text=True, vertical="center")
    for i, r in enumerate(rows, start + 1):
        for j, c in enumerate(cols, 1):
            v = num(r[c]) if r[c] != "" else None
            cell = ws.cell(i, j, v)
            if isinstance(v, str):
                cell.data_type = "s"   # '=' 로 시작하는 제목이 수식으로 저장되지 않게
    for j, c in enumerate(cols, 1):
        w = max([len(str(c))] + [len(str(r[c])) for r in rows[:200]])
        ws.column_dimensions[get_column_letter(j)].width = min(max(8, w * 1.3), 45)
    ref = f"A{start}:{get_column_letter(len(cols))}{start + len(rows)}"
    t = Table(displayName="tbl_data_" + str(len(wb.sheetnames)), ref=ref)
    t.tableStyleInfo = TableStyleInfo(name="TableStyleLight9", showRowStripes=True)
    ws.add_table(t)
    ws.freeze_panes = ws.cell(start + 1, 2)
    return ws


def put(ws, r, c, v, font=B, fill=None, fmt=None):
    cell = ws.cell(r, c, v)
    if isinstance(v, str):
        cell.data_type = "s"
    cell.font = font
    if fill: cell.fill = fill
    if fmt: cell.number_format = fmt
    return cell


def grid(ws, r0, c0, header, rows, fmt=None):
    for j, h in enumerate(header):
        put(ws, r0, c0 + j, h, Font(name="맑은 고딕", size=10, bold=True, color="FFFFFF"), HEAD)
    for i, row in enumerate(rows, 1):
        for j, v in enumerate(row):
            cl = put(ws, r0 + i, c0 + j, v, fmt=fmt if (fmt and j > 0) else None)
            cl.border = BOX
    return r0 + len(rows)


def show_axes(ch):
    ch.x_axis.delete = False
    ch.y_axis.delete = False
    return ch


def line(title, ytitle, h=8, w=18):
    ch = LineChart()
    show_axes(ch)
    ch.varyColors = False
    ch.title, ch.y_axis.title, ch.height, ch.width = title, ytitle, h, w
    ch.y_axis.majorGridlines = None
    ch.legend.position = "b"
    return ch


def bar(title, h=10, w=18, horiz=True):
    ch = BarChart()
    show_axes(ch)
    ch.type = "bar" if horiz else "col"
    ch.title, ch.height, ch.width = title, h, w
    ch.legend = None
    return ch


# ---------- 데이터 읽기 ----------
A = {n: read(ANA / n) for n in ["11_market_trends.csv", "12_keyword_growth.csv", "13_keyword_decline.csv",
                                 "14_new_interest_candidates.csv", "15_seasonal_trends.csv", "16_content_supply.csv",
                                 "17_shopping_interest.csv", "18_content_opportunities.csv", "19_keyword_comparison.csv"]}
R = {n: read(RAW / n) for n in ["01_naver_blog_raw.csv", "02_naver_news_raw.csv", "03_naver_search_trends_raw.csv",
                                 "04_naver_shopping_insights_raw.csv", "05_keyword_master.csv", "06_collection_log.csv"]}
LOG = R["06_collection_log.csv"]
last_run = max((r["run_id"] for r in LOG), default="")

wb = Workbook()
# ---------- 0. 시작하기 ----------
ws = wb.active
ws.title = "시작하기"
ws.sheet_view.showGridLines = False
ws.column_dimensions["A"].width = 3
ws.column_dimensions["B"].width = 26
for c in "CDEFG":
    ws.column_dimensions[c].width = 18
put(ws, 2, 2, "반려동물 시장 관심도 데이터 보고서", H1)
put(ws, 3, 2, f"출처: NAVER API HUB (검색·데이터랩)  |  조사 기간 2025-11-23 ~ 어제  |  보고서 생성 {dt.datetime.now():%Y-%m-%d %H:%M}", SM)

r = 5
put(ws, r, 2, "이렇게 보세요", H2); r += 1
guide = [
    ("① 요약", "한 화면 요약: 뜨는 키워드·지는 키워드·콘텐츠 기회 후보"),
    ("② 시각화_시장동향", "동물별 검색 관심 비교, 반려동물 쇼핑 클릭 추이(1년·2017년~)"),
    ("③ 시각화_상승하락", "키워드별 최근 30일 vs 직전 30일 검색 관심 변화"),
    ("④ 시각화_계절성", "2016년~ 월별 계절지수 히트맵 (100=평균, 진할수록 그 달에 관심↑)"),
    ("⑤ 시각화_쇼핑", "반려동물 쇼핑 클릭의 기기·성별·연령 비중"),
    ("⑥ 시각화_비교그룹", "같은 요청으로 받은 키워드끼리 직접 비교 (사료·브랜드·용품 등)"),
    ("⑦ 시각화_콘텐츠기회", "검색 관심↑ + 콘텐츠 공급↓ 조합으로 고른 글감 후보"),
    ("11~19 시트", "분석용 데이터 (필터·정렬 가능, 계산방법 열 포함)"),
    ("01~06 시트", "API 원본 데이터 (수정하지 말 것). CSV 원본은 '원본' 폴더"),
]
for k, v in guide:
    put(ws, r, 2, k, BB); put(ws, r, 3, v); r += 1

r += 1
put(ws, r, 2, "숫자를 읽을 때 꼭 알아둘 것", H2); r += 1
notes = [
    "검색 관심도 지수 = 요청 기간 안의 최댓값을 100으로 맞춘 상대값입니다. 실제 검색 횟수가 아닙니다.",
    "쇼핑 클릭 지수 = 네이버 쇼핑 클릭의 상대값입니다. 판매량·매출이 아닙니다.",
    "서로 다른 요청에서 받은 지수는 크기를 비교하지 않습니다. 같은 비교그룹 안(⑥)에서만 키워드끼리 비교하세요.",
    "블로그·뉴스는 API가 주는 최신순 최대 1,000건/키워드 안에서만 수집했습니다. 1년치 전체 게시물이 아닙니다.",
    "콘텐츠 기회·신규 관심사는 '후보'입니다. 구매 전환이나 수요를 확정하지 않습니다.",
    "빈칸 = 데이터 없음(결측), 0 = API가 0을 준 값. 둘은 다릅니다.",
]
for t in notes:
    put(ws, r, 2, "• " + t); r += 1

r += 1
put(ws, r, 2, "API별 수집 현황 (최근 실행 " + last_run + ")", H2); r += 1
agg = defaultdict(lambda: [0, 0, 0])
for l in LOG:
    if l["run_id"] != last_run:
        continue
    a = agg[l["api"]]
    a[0] += 1
    a[1] += l["ok"] == "Y"
    a[2] += int(l["rows_saved"] or 0)
names = {"blog": "검색 - 블로그", "news": "검색 - 뉴스", "search_trend": "데이터랩 검색어트렌드", "shopping_insight": "데이터랩 쇼핑인사이트"}
hist = {"blog": "최신순 최대 1,000건/키워드 (기간 지정 불가)", "news": "최신순 최대 1,000건/키워드 (기간 지정 불가)",
        "search_trend": "2016-01-01 이후 (일·주·월)", "shopping_insight": "2017-08-01 이후 (일·주·월)"}
rows = [[names.get(k, k), v[0], v[1], v[0] - v[1], v[2], hist.get(k, "")] for k, v in agg.items()]
grid(ws, r, 2, ["API", "호출", "성공", "실패", "저장 행", "과거 조회 가능 범위"], rows)
ws.column_dimensions["G"].width = 40
r += len(rows) + 2
put(ws, r, 2, "원본 데이터 건수", H2); r += 1
cnt = [[n, len(v)] for n, v in R.items()]
grid(ws, r, 2, ["파일", "행 수"], cnt)

# ---------- 1. 요약 ----------
ws = wb.create_sheet("① 요약")
ws.sheet_view.showGridLines = False
ws.column_dimensions["A"].width = 2
put(ws, 1, 2, "한눈에 보는 반려동물 관심 변화", H1)
g = [x for x in A["12_keyword_growth.csv"] if x["데이터"] == "검색어트렌드" and x["비교구간"] == "30일"]
d = [x for x in A["13_keyword_decline.csv"] if x["데이터"] == "검색어트렌드" and x["비교구간"] == "30일"]
put(ws, 2, 2, (g or d or [{"기준기간": ""}])[0]["기준기간"] and f"기준: 최근 30일 vs 직전 30일 ({(g or d)[0]['기준기간']})", SM)
cat = next((x for x in A["17_shopping_interest.csv"] if x["keyword_id"] == ""), {})
kpis = [("분석 키워드", len([k for k in R["05_keyword_master.csv"] if k["활성화"].upper() == "Y"]), "개"),
        ("블로그 수집", len(R["01_naver_blog_raw.csv"]), "건"),
        ("뉴스 수집", len(R["02_naver_news_raw.csv"]), "건"),
        ("반려동물 쇼핑클릭 30일 변화", num(cat.get("30일_변화율_%", "")), "%"),
        ("쇼핑클릭 모바일 비중", num(cat.get("모바일_비중_%", "")), "%"),
        ("쇼핑클릭 여성 비중", num(cat.get("여성_비중_%", "")), "%")]
col = 2
for name, val, unit in kpis:
    for rr in (4, 5, 6):
        for cc in (col, col + 1):
            ws.cell(rr, cc).fill = CARD
    put(ws, 4, col, name, SM, CARD)
    put(ws, 5, col, val if val not in ("", None) else "-", Font(name="맑은 고딕", size=20, bold=True, color=NAVY), CARD,
        "#,##0.0" if isinstance(val, float) else "#,##0")
    put(ws, 6, col, unit, SM, CARD)
    ws.column_dimensions[get_column_letter(col)].width = 16
    ws.column_dimensions[get_column_letter(col + 1)].width = 6
    col += 2

r0 = 9
put(ws, r0, 2, "▲ 검색 관심 상승 TOP 10 (30일)", H2)
top_g = sorted(g, key=lambda x: -float(x["변화율_%"]))[:10]
grid(ws, r0 + 1, 2, ["키워드", "변화율 %"], [[x["검색키워드"], num(x["변화율_%"])] for x in top_g], "0.0")
put(ws, r0, 6, "▼ 검색 관심 하락 TOP 10 (30일)", H2)
top_d = sorted(d, key=lambda x: float(x["변화율_%"]))[:10]
grid(ws, r0 + 1, 6, ["키워드", "변화율 %"], [[x["검색키워드"], num(x["변화율_%"])] for x in top_d], "0.0")
put(ws, r0, 10, "★ 콘텐츠 기회 후보 TOP 10", H2)
opp = A["18_content_opportunities.csv"][:10]
grid(ws, r0 + 1, 10, ["키워드", "점수", "신호"], [[x["검색키워드"], num(x["기회점수(0~100)"]), x["신호"]] for x in opp])
ws.column_dimensions["L"].width = 28
if top_g:
    ws.conditional_formatting.add(f"C{r0+2}:C{r0+1+len(top_g)}", DataBarRule(start_type="min", end_type="max", color="63BE7B"))
if top_d:
    ws.conditional_formatting.add(f"G{r0+2}:G{r0+1+len(top_d)}", DataBarRule(start_type="min", end_type="max", color="F8696B"))
if opp:
    ws.conditional_formatting.add(f"K{r0+2}:K{r0+1+len(opp)}", DataBarRule(start_type="num", start_value=0, end_type="num", end_value=100, color="5B8FF9"))
put(ws, r0 + 13, 2, "신규 관심 표현 후보 (블로그·뉴스 제목, 최근 30일 등장 많은 순)", H2)
ni = A["14_new_interest_candidates.csv"][:15]
grid(ws, r0 + 14, 2, ["표현", "최근30일 문서", "전체 문서", "예시 제목"],
     [[x["후보표현"], num(x["등장문서수_최근30일"]), num(x["등장문서수_전체"]), x["예시제목"]] for x in ni])
for i in range(len(ni)):
    ws.merge_cells(start_row=r0 + 15 + i, start_column=5, end_row=r0 + 15 + i, end_column=9)
ws.merge_cells(start_row=r0 + 14, start_column=5, end_row=r0 + 14, end_column=9)
put(ws, r0 + 31, 2, "※ 지수는 상대값(검색 횟수·판매량 아님). 후보는 확정이 아니라 추가 확인 대상입니다.", SM)

# ---------- 2. 시장동향 ----------
ws = wb.create_sheet("② 시각화_시장동향")
ws.sheet_view.showGridLines = False
put(ws, 1, 1, "시장 전체 동향", H1)
mt = A["11_market_trends.csv"]
cmpm = [x for x in mt if x["구분"].startswith("검색어트렌드(동물비교")]
months = sorted({x["월"] for x in cmpm})
animals = list(dict.fromkeys(x["대상"] for x in cmpm))
tbl = [[m] + [num(next((x["지수"] for x in cmpm if x["월"] == m and x["대상"] == a), None)) for a in animals] for m in months]
put(ws, 3, 1, "동물별 검색 관심 (한 요청 내 비교, 최댓값=100)", BB)
end = grid(ws, 4, 1, ["월"] + animals, tbl, "0.0")
if tbl:
    ch = line("동물별 검색 관심 (월)", "상대지수")
    ch.add_data(Reference(ws, min_col=2, max_col=1 + len(animals), min_row=4, max_row=end), titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=1, min_row=5, max_row=end))
    ws.add_chart(ch, "H3")
catm = [x for x in mt if x["구분"].startswith("쇼핑클릭")]
r = max(end, 20) + 3
put(ws, r, 1, "반려동물 카테고리 쇼핑 클릭 (월평균, 최근 1년)", BB)
end2 = grid(ws, r + 1, 1, ["월", "클릭지수"], [[x["월"], num(x["지수"])] for x in catm], "0.0")
if catm:
    ch = line("반려동물 쇼핑 클릭 (월)", "상대지수"); ch.legend = None
    ch.add_data(Reference(ws, min_col=2, min_row=r + 1, max_row=end2), titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=1, min_row=r + 2, max_row=end2))
    ws.add_chart(ch, f"H{r}")
shl = [x for x in R["04_naver_shopping_insights_raw.csv"] if x["request_type"] == "category_longterm_month"]
if shl:
    lastc = max(x["collected_at"] for x in shl)
    shl = [x for x in shl if x["collected_at"] == lastc]
    _end = dt.date.fromisoformat(max(x["end_date"] for x in shl)[:10])
    if (_end + dt.timedelta(days=1)).month == _end.month:   # 말일이 아니면 마지막 달은 미완결 → 제외
        shl = [x for x in shl if x["period"][:7] != _end.isoformat()[:7]]
    r = max(end2, r + 18) + 3
    put(ws, r, 1, "반려동물 카테고리 쇼핑 클릭 장기 추이 (2017-08~, 월)", BB)
    put(ws, r - 1, 8, "※ 2022-12~2023-03 급등 후 2023-04 급락은 API 값 그대로입니다. 원인(카테고리 집계 변경 등)은 확인하지 못했으므로 이 구간 전후를 직접 비교할 때 주의하세요.", SM)
    end3 = grid(ws, r + 1, 1, ["월", "클릭지수"], [[x["period"][:7], num(x["ratio"])] for x in shl], "0.0")
    ch = line("반려동물 쇼핑 클릭 장기 추이 (완결 월)", "상대지수", w=24); ch.legend = None
    ch.add_data(Reference(ws, min_col=2, min_row=r + 1, max_row=end3), titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=1, min_row=r + 2, max_row=end3))
    ws.add_chart(ch, f"H{r}")
ws.column_dimensions["A"].width = 10

# ---------- 3. 상승하락 ----------
ws = wb.create_sheet("③ 시각화_상승하락")
ws.sheet_view.showGridLines = False
put(ws, 1, 1, "키워드별 검색 관심 변화율 (최근 vs 직전, 키워드 자체 기준)", H1)
allc = A["12_keyword_growth.csv"] + A["13_keyword_decline.csv"]
for k, (label, anchor) in enumerate([("30일", "E3"), ("90일", "E30")]):
    rows = sorted([x for x in allc if x["데이터"] == "검색어트렌드" and x["비교구간"] == label], key=lambda x: float(x["변화율_%"]))
    r = 3 + k * 27
    put(ws, r, 1, f"{label} 변화율 (±10% 이상만)", BB)
    end = grid(ws, r + 1, 1, ["키워드", "변화율 %"], [[x["검색키워드"], num(x["변화율_%"])] for x in rows], "0.0")
    if rows:
        ch = bar(f"검색 관심 {label} 변화율 %", h=max(8, len(rows) * 0.45))
        ch.add_data(Reference(ws, min_col=2, min_row=r + 1, max_row=end), titles_from_data=True)
        ch.set_categories(Reference(ws, min_col=1, min_row=r + 2, max_row=end))
        ws.add_chart(ch, anchor)
        ws.conditional_formatting.add(f"B{r+2}:B{end}", ColorScaleRule(start_type="min", start_color="F8696B", mid_type="num", mid_value=0, mid_color="FFFFFF", end_type="max", end_color="63BE7B"))
ws.column_dimensions["A"].width = 18

# ---------- 4. 계절성 ----------
ws = wb.create_sheet("④ 시각화_계절성")
ws.sheet_view.showGridLines = False
put(ws, 1, 1, "계절지수 히트맵 (100=연평균, 2016~ 완결연도 기준)", H1)
put(ws, 2, 1, "진한 초록 = 그 달에 관심이 평균보다 높음. '반복'= 피크월이 그 해 상위 3개월에 든 연도 수 / 사용 연도 수", SM)
se = A["15_seasonal_trends.csv"]
r = 4
for src in dict.fromkeys(x["데이터"] for x in se):
    put(ws, r, 1, src, BB); r += 1
    tg = list(dict.fromkeys(x["대상"] for x in se if x["데이터"] == src))
    rows = []
    for t in tg:
        xs = {int(x["월"]): num(x["계절지수"]) for x in se if x["데이터"] == src and x["대상"] == t}
        one = next(x for x in se if x["데이터"] == src and x["대상"] == t)
        rows.append([t] + [xs.get(m) for m in range(1, 13)] + [f"{one['피크월']}월", f"{one['피크월_상위3개월_반복연도수']}/{one['사용연도수']}"])
    end = grid(ws, r, 1, ["대상"] + [f"{m}월" for m in range(1, 13)] + ["피크", "반복"], rows, "0")
    ws.conditional_formatting.add(f"B{r+1}:M{end}", ColorScaleRule(start_type="num", start_value=60, start_color="F8696B", mid_type="num", mid_value=100, mid_color="FFFFFF", end_type="num", end_value=160, end_color="2E7D5B"))
    r = end + 3
ws.column_dimensions["A"].width = 20
for c in range(2, 16):
    ws.column_dimensions[get_column_letter(c)].width = 7

# ---------- 5. 쇼핑 ----------
ws = wb.create_sheet("⑤ 시각화_쇼핑")
ws.sheet_view.showGridLines = False
put(ws, 1, 1, "반려동물 쇼핑 클릭 — 누가, 어디서 (최근 월 클릭 비중)", H1)
sh = A["17_shopping_interest.csv"]
if cat:
    put(ws, 3, 1, f"반려동물 카테고리 ({cat.get('비중_기준월','')})", BB)
    blocks = [("기기", [("모바일", cat["모바일_비중_%"]), ("PC", cat["PC_비중_%"])], "A5"),
              ("성별", [("여성", cat["여성_비중_%"]), ("남성", cat["남성_비중_%"])], "J5"),
              ("연령", [(f"{a}대", cat[f"{a}대_비중_%"]) for a in ("10", "20", "30", "40", "50", "60")], "S5")]
    rr = 22
    for i, (nm, vals, anchor) in enumerate(blocks):
        c0 = 1 + i * 3
        end = grid(ws, rr, c0, [nm, "비중 %"], [[a, num(b)] for a, b in vals], "0.0")
        pc = PieChart() if nm != "연령" else BarChart()
        pc.title, pc.height, pc.width = f"{nm} 비중", 8, 11
        pc.add_data(Reference(ws, min_col=c0 + 1, min_row=rr, max_row=end), titles_from_data=True)
        pc.set_categories(Reference(ws, min_col=c0, min_row=rr + 1, max_row=end))
        pc.dataLabels = DataLabelList()
        pc.dataLabels.showVal = True
        pc.dataLabels.showSerName = False
        pc.dataLabels.showCatName = False
        pc.dataLabels.showLegendKey = False
        if nm == "연령":
            pc.legend = None
            show_axes(pc)
        ws.add_chart(pc, anchor)
put(ws, 31, 1, "쇼핑 키워드별 클릭 변화·비중 (키워드 자체 기준)", BB)
kw_rows = [x for x in sh if x["keyword_id"]]
hdr = ["대상", "30일_변화율_%", "90일_변화율_%", "모바일_비중_%", "여성_비중_%", "주요연령"]
end = grid(ws, 32, 1, ["키워드", "30일 변화%", "90일 변화%", "모바일%", "여성%", "주요연령"],
           [[num(x[h]) if h != "대상" and h != "주요연령" else x[h] for h in hdr] for x in kw_rows], "0.0")
if kw_rows:
    ws.conditional_formatting.add(f"B33:C{end}", ColorScaleRule(start_type="min", start_color="F8696B", mid_type="num", mid_value=0, mid_color="FFFFFF", end_type="max", end_color="63BE7B"))
    ws.conditional_formatting.add(f"E33:E{end}", DataBarRule(start_type="num", start_value=0, end_type="num", end_value=100, color="F4A6C1"))
    ch = bar("쇼핑 클릭 30일 변화율 %", h=max(8, len(kw_rows) * 0.45))
    ch.add_data(Reference(ws, min_col=2, min_row=32, max_row=end), titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=1, min_row=33, max_row=end))
    ws.add_chart(ch, "I31")
ws.column_dimensions["A"].width = 18

# ---------- 6. 비교그룹 ----------
ws = wb.create_sheet("⑥ 시각화_비교그룹")
ws.sheet_view.showGridLines = False
put(ws, 1, 1, "키워드 직접 비교 (같은 요청으로 받은 주별 지수, 그룹 최댓값=100)", H1)
tr = R["03_naver_search_trends_raw.csv"]
cmpw = [x for x in tr if x["request_type"] == "comparison_week"]
lastby = {}
for x in cmpw:
    lastby[x["compare_set"]] = max(lastby.get(x["compare_set"], ""), x["collected_at"])
summ = A["19_keyword_comparison.csv"]
r = 3
for idx, cs in enumerate(sorted(lastby)):
    dc = 30 + idx * 8   # 그룹마다 따로 떨어진 열 묶음에 주별 원자료를 둔다(겹침 방지)
    rows = [x for x in cmpw if x["compare_set"] == cs and x["collected_at"] == lastby[cs]]
    names_ = list(dict.fromkeys(x["group_name"] for x in rows))
    weeks = sorted({x["period"] for x in rows})
    val = {(x["period"], x["group_name"]): num(x["ratio"]) for x in rows}
    put(ws, r, 1, f"[검색] {cs}", H2)
    s_rows = [x for x in summ if x["비교그룹"] == cs and x["데이터"] == "검색어트렌드"]
    grid(ws, r + 1, 1, ["키워드", "평균", "비중%", "4주변화%", "지속인기"],
         [[x["키워드"], num(x["평균지수"]), num(x["그룹내_비중_%"]), num(x["4주_변화율_%"]), x["지속인기(주의 80%이상에서 그 주 1위의 50%이상)"]] for x in s_rows], "0.0")
    dr = 4
    put(ws, dr - 1, dc, f"{cs} 주별 원자료", BB)
    end = grid(ws, dr, dc, ["주"] + names_, [[w] + [val.get((w, n)) for n in names_] for w in weeks], "0.0")
    ch = line(f"{cs} 주별 검색 관심", "상대지수", h=7.5, w=20)
    ch.add_data(Reference(ws, min_col=dc + 1, max_col=dc + len(names_), min_row=dr, max_row=end), titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=dc, min_row=dr + 1, max_row=end))
    ch.y_axis.scaling.min = 0
    ws.add_chart(ch, f"H{r}")
    r += 17
shc = [x for x in summ if x["데이터"] == "쇼핑클릭"]
if shc:
    put(ws, r, 1, "[쇼핑 클릭] 비교그룹 요약", H2)
    grid(ws, r + 1, 1, ["비교그룹", "키워드", "평균", "비중%", "4주변화%", "지속인기"],
         [[x["비교그룹"], x["키워드"], num(x["평균지수"]), num(x["그룹내_비중_%"]), num(x["4주_변화율_%"]), x["지속인기(주의 80%이상에서 그 주 1위의 50%이상)"]] for x in shc], "0.0")
ws.column_dimensions["A"].width = 16
put(ws, 2, 1, "※ 오른쪽 AD열부터는 차트용 주별 원자료입니다.", SM)

# ---------- 7. 콘텐츠기회 ----------
ws = wb.create_sheet("⑦ 시각화_콘텐츠기회")
ws.sheet_view.showGridLines = False
put(ws, 1, 1, "콘텐츠 기회 후보 (검색 관심 변화 × 콘텐츠 공급 × 쇼핑 클릭)", H1)
put(ws, 2, 1, "점수 = 검색30일변화 35% + 검색90일변화 25% + 블로그 공급 적음 25% + 쇼핑30일변화 15% (백분위). 후보 선별용이며 수요 확정 아님.", SM)
op = A["18_content_opportunities.csv"]
hdr = ["검색키워드", "대분류", "기회점수(0~100)", "후보등급", "검색_30일변화_%", "검색_90일변화_%", "블로그_일평균게시", "뉴스_일평균게시", "쇼핑클릭_30일변화_%", "신호"]
end = grid(ws, 4, 1, ["키워드", "분야", "점수", "등급", "검색30일%", "검색90일%", "블로그/일", "뉴스/일", "쇼핑30일%", "신호"],
           [[num(x[h]) if h not in ("검색키워드", "대분류", "후보등급", "신호") else x[h] for h in hdr] for x in op], "0.0")
if op:
    ws.conditional_formatting.add(f"C5:C{end}", DataBarRule(start_type="num", start_value=0, end_type="num", end_value=100, color="5B8FF9"))
    ws.conditional_formatting.add(f"E5:F{end}", ColorScaleRule(start_type="min", start_color="F8696B", mid_type="num", mid_value=0, mid_color="FFFFFF", end_type="max", end_color="63BE7B"))
    top = min(end, 4 + 15)
    ch = bar("기회점수 TOP 15", h=9, w=16)
    ch.add_data(Reference(ws, min_col=3, min_row=4, max_row=top), titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=1, min_row=5, max_row=top))
    ch.x_axis.scaling.orientation = "maxMin"
    ws.add_chart(ch, "M4")
for c, w in zip("ABCDEFGHIJ", (18, 16, 8, 9, 10, 10, 10, 9, 10, 30)):
    ws.column_dimensions[c].width = w

# ---------- 데이터 시트 ----------
for n, rows in A.items():
    table_sheet(wb, n[:2] + "_" + n[3:-4][:25], rows, "분석용 데이터 — '계산방법'·'기준기간' 열 참고")
for n, rows in R.items():
    big = len(rows) > 300000
    table_sheet(wb, n[:2] + "_" + n[3:-4][:25], rows[:300000], "API 원본 데이터 (수정 금지)" + (" — 30만 행까지만 표시, 전체는 CSV" if big else ""))

try:
    wb.save(OUTX)
except PermissionError:   # 엑셀로 열려 있으면 덮어쓸 수 없으므로 다른 이름으로 저장
    OUTX = OUTX.with_name(OUTX.stem + f"_{dt.datetime.now():%m%d_%H%M}.xlsx")
    wb.save(OUTX)
    print("[알림] 기존 보고서가 열려 있어 새 이름으로 저장했습니다.")
print("저장:", OUTX)

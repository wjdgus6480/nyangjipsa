// 콘텐츠 스튜디오 "대시보드 보기" — 탭마다 핵심 숫자 + 카드 (기존 관리자 대시보드와 같은 카드·색·간격)
// 데이터랩 값은 상대지수(같은 키워드의 기간 비교)라 "검색량"이라고 쓰지 않습니다.
import { useState, type ReactNode } from "react";
import { Card, Segmented } from "./adminUi";
import { LineChart } from "./charts";
import { contentCards, statusTone } from "./contentStudioModel";
import {
  fmtRate,
  parseInterest,
  parseKeywords,
  parseRelated,
  parseReport,
  parseTrend,
  sum,
  type InterestItem,
} from "./contentStudioParse";

type Copy = (key: string, text: string) => void;
type CopyLabel = (key: string, idle: string) => string;

const SERIES_COLORS = ["#2A9FC7", "#14365A", "#F2994A", "#27AE60", "#9B51E0"];

function Kpis({ items, label }: { items: { title: string; value: ReactNode; unit?: string; help?: string; star?: boolean }[]; label: string }) {
  return (
    <section className="adm-kpis adm-kpis--studio" aria-label={label}>
      {items.map((k) => (
        <article key={k.title} className={"adm-kpi" + (k.star ? " is-star" : "")}>
          <div className="adm-kpi__top">
            <h3>{k.title}</h3>
          </div>
          <p className="adm-kpi__value">
            {k.value}
            {k.unit && <small>{k.unit}</small>}
          </p>
          {k.help && <p className="adm-kpi__help">{k.help}</p>}
        </article>
      ))}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="adm-studio-empty">{children}</p>;
}

function TrendBadge({ trend }: { trend: string }) {
  const tone = trend.startsWith("상승") ? "up" : trend.startsWith("하락") ? "down" : trend.startsWith("유지") ? "flat" : "none";
  const arrow = tone === "up" ? "▲ " : tone === "down" ? "▼ " : "";
  return <span className={`adm-trend is-${tone}`}>{arrow + (trend || "—")}</span>;
}

function RiskBadge({ risk }: { risk: string }) {
  if (!risk) return null;
  const title = risk === "A" ? "일반 정보 (자동 생성)" : risk === "B" ? "건강 정보 (근거자료 필요)" : "진단·처방성 (생성 안 함)";
  return (
    <span className={`adm-risk is-${risk.toLowerCase()}`} title={title}>
      {risk}등급
    </span>
  );
}

/* ---------------- 키워드 조사 ---------------- */

export function KeywordsView({ rows }: { rows: string[][] }) {
  const items = parseKeywords(rows);
  if (!items.length) return <Empty>키워드가 없어요. 시트 메뉴 [냥집사 마케팅] &gt; [0. 처음 준비]를 실행해 주세요.</Empty>;
  const used = items.filter((k) => k.use);
  const fields = [...new Set(items.map((k) => k.field))];
  const issues = items.filter((k) => k.check && k.check !== "OK");
  return (
    <div className="adm-studio">
      <Kpis
        label="키워드 조사 요약"
        items={[
          { title: "전체 키워드", value: items.length, unit: "개" },
          { title: "분석에 사용", value: used.length, unit: "개", star: true, help: "1_키워드조사 탭에서 '사용' 체크" },
          { title: "분야", value: fields.length, unit: "개", help: fields.join(" · ") },
          { title: "확인 필요", value: issues.length, unit: "개", help: "중복·등급 누락 등 검사 결과" },
        ]}
      />
      <div className="adm-grid">
        {fields.map((f) => (
          <Card key={f} title={f} desc={`${items.filter((k) => k.field === f).length}개`}>
            <ul className="adm-chips">
              {items
                .filter((k) => k.field === f)
                .map((k) => (
                  <li key={k.keyword} className={"adm-chip" + (k.use ? "" : " is-off")} title={k.check || undefined}>
                    <span>{k.keyword}</span>
                    <RiskBadge risk={k.risk} />
                    {k.volume !== null && <small>{k.volume.toLocaleString("ko-KR")}</small>}
                    {k.check && k.check !== "OK" && <small className="adm-warn">{k.check}</small>}
                  </li>
                ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------------- 시장 관심도 ---------------- */

function RankList({ items, empty }: { items: InterestItem[]; empty: string }) {
  if (!items.length) return <Empty>{empty}</Empty>;
  const max = Math.max(...items.map((i) => i.score ?? 0), 0.0001);
  return (
    <ol className="adm-rank">
      {items.map((k) => (
        <li key={k.keyword}>
          <span className={"adm-rank__no" + (k.rank <= 3 ? " is-top" : "")}>{k.rank}</span>
          <div>
            <div className="adm-rank__name">
              <strong>{k.keyword}</strong>
              <span className="adm-muted">{k.field}</span>
              <RiskBadge risk={k.risk} />
              <TrendBadge trend={k.trend} />
              {k.rising && <span className="adm-hot">급상승</span>}
            </div>
            <div className="adm-hbars__track">
              <div className="adm-hbars__bar" style={{ width: `${((k.score ?? 0) / max) * 100}%` }} />
            </div>
          </div>
          <span className="adm-rank__val">
            <b>{k.score === null ? "—" : k.score.toFixed(2)}</b>
            <small className="adm-muted"> 상대지수 {fmtRate(k.growth)}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function InterestView({ rows }: { rows: string[][] }) {
  const d = parseInterest(rows);
  if (!d || !d.items.length) return <Empty>관심도 분석 결과가 없어요. 시트 메뉴 [2. 관심도 · 우선순위 분석]을 실행해 주세요.</Empty>;
  const scored = d.items.filter((k) => k.score !== null);
  const top = scored.slice(0, 10);
  const rising = d.items.filter((k) => k.rising);
  const up = d.items.filter((k) => k.trend.startsWith("상승"));
  const low = d.items.filter((k) => k.score === null);
  const best = scored[0];
  return (
    <div className="adm-studio">
      <p className="adm-insight">
        {best ? (
          <>
            지금 우선순위 1위는 <b>{best.keyword}</b>
            {best.growth !== null && <> (최근 4주 상대지수 {fmtRate(best.growth)})</>}예요. {d.title && <span className="adm-muted">· {d.title}</span>}
          </>
        ) : (
          "점수를 매길 수 있는 키워드가 아직 없어요."
        )}
      </p>
      <Kpis
        label="관심도 요약"
        items={[
          { title: "분석 키워드", value: d.items.length, unit: "개" },
          { title: "콘텐츠 후보(선정)", value: d.items.filter((k) => k.selected).length, unit: "개", star: true, help: "3·4·5단계 대상" },
          { title: "급상승", value: rising.length, unit: "개", help: "최근 7일이 평소보다 크게 오른 키워드" },
          { title: "상승 추세", value: up.length, unit: "개", help: "최근 4주 상대지수 +10% 이상" },
          { title: "검색 적음", value: low.length, unit: "개", help: "데이터 충분도 50% 미만 → 순위 제외" },
        ]}
      />
      <div className="adm-grid adm-grid--wide-left">
        <Card title="관심도 TOP 10" desc="우선순위 점수 순 · 막대는 1위 대비 점수">
          <RankList items={top} empty="점수가 있는 키워드가 없어요." />
        </Card>
        <div className="adm-studio__side">
          <Card title="급상승 키워드" desc="상대지수가 평소보다 갑자기 오른 키워드">
            {rising.length ? (
              <ul className="adm-list">
                {rising.map((k) => (
                  <li key={k.keyword}>
                    <strong>{k.keyword}</strong>
                    <span className="adm-muted">
                      상대지수 {fmtRate(k.growth)} · 급상승 정도 {k.spike?.toFixed(2) ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>이번 기간에는 급상승 키워드가 없어요.</Empty>
            )}
          </Card>
          <Card title="검색이 적은 키워드" desc="네이버 데이터랩이 값을 거의 주지 않음 (순위 제외)">
            {low.length ? (
              <ul className="adm-chips">
                {low.map((k) => (
                  <li key={k.keyword} className="adm-chip is-off">
                    <span>{k.keyword}</span>
                    <small>{k.presence === null ? "—" : `${Math.round(k.presence * 100)}%`}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>없어요.</Empty>
            )}
          </Card>
        </div>
      </div>
      <p className="adm-foot">상승률·급상승은 네이버 데이터랩 상대지수 기준(같은 키워드의 기간 비교)이며 실제 검색 건수가 아닙니다.</p>
    </div>
  );
}

/* ---------------- 연관 키워드 ---------------- */

export function RelatedView({ rows, copy, copyLabel }: { rows: string[][]; copy: Copy; copyLabel: CopyLabel }) {
  const { source, groups } = parseRelated(rows);
  if (!groups.length) return <Empty>연관 키워드 결과가 없어요. 시트 메뉴 [3. 연관 검색 키워드 분석]을 실행해 주세요.</Empty>;
  return (
    <div className="adm-studio">
      {source && <p className="adm-insight">{source}</p>}
      <div className="adm-grid">
        {groups.map((g) => {
          const key = `q-${g.keyword}`;
          return (
            <Card
              key={g.keyword}
              title={g.keyword}
              desc={`연관 ${g.words.length}개 · 질문 ${g.questions.length}개`}
              action={
                g.questions.length ? (
                  <button type="button" className="adm-btn adm-btn--ghost" onClick={() => copy(key, g.questions.join("\n"))}>
                    {copyLabel(key, "질문 복사")}
                  </button>
                ) : undefined
              }
            >
              {g.words.length > 0 && (
                <ul className="adm-chips">
                  {g.words.map((w) => (
                    <li key={w.word} className="adm-chip">
                      <span>{w.word}</span>
                      {w.count && <small>{w.count}</small>}
                    </li>
                  ))}
                </ul>
              )}
              {g.questions.length > 0 && (
                <>
                  <h3 className="adm-subhead">보호자들이 실제로 묻는 질문</h3>
                  <ul className="adm-questions">
                    {g.questions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- 검색 트렌드 ---------------- */

export function TrendView({ rows }: { rows: string[][] }) {
  const d = parseTrend(rows);
  if (!d || !d.summary.length) return <Empty>검색 트렌드 결과가 없어요. 시트 메뉴 [4. 검색 트렌드 분석]을 실행해 주세요.</Empty>;
  const series = d.series.map((s, i) => ({
    name: s.keyword,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
    data: s.values.map((v, j) => ({ label: d.weeks[j], range: `${d.weeks[j]} · ${s.keyword}`, value: v ?? 0 })),
  }));
  return (
    <div className="adm-studio">
      <section className="adm-kpis adm-kpis--studio" aria-label="키워드별 트렌드 요약">
        {d.summary.map((s) => (
          <article key={s.keyword} className="adm-kpi">
            <div className="adm-kpi__top">
              <h3>{s.keyword}</h3>
            </div>
            <p className="adm-kpi__value">{fmtRate(s.growth)}</p>
            <p className="adm-kpi__meta">
              <TrendBadge trend={s.judge} />
              {s.season !== null && (
                <span>
                  {d.seasonMonthLabel} 계절 지수 {s.season.toFixed(2)}
                </span>
              )}
            </p>
            <p className="adm-kpi__help">최근 4주 vs 이전 4주 (상대지수)</p>
          </article>
        ))}
      </section>
      {series.length > 0 && (
        <Card title="주간 검색 추이" desc="상대지수 · 키워드끼리 높이를 비교하지 말고 각 선의 흐름만 보세요">
          {series.map((s) => (
            <div key={s.name} className="adm-trend-line">
              <p className="adm-trend-line__name">
                <i style={{ background: s.color }} />
                {s.name}
              </p>
              <LineChart series={[s]} unit="" height={140} label={`${s.name} 주간 상대지수`} />
            </div>
          ))}
        </Card>
      )}
      {d.season.length > 0 && (
        <Card title="계절 지수" desc="1보다 크면 예년에 그 달 관심이 높았어요 (최근 5년 월간 상대지수)">
          <div className="adm-heat__wrap">
            <table className="adm-heat">
              <thead>
                <tr>
                  <th scope="col">키워드</th>
                  {Array.from({ length: 12 }, (_, m) => (
                    <th key={m} scope="col">
                      {m + 1}월
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.season.map((s) => (
                  <tr key={s.keyword}>
                    <th scope="row">{s.keyword}</th>
                    {s.months.map((v, m) => (
                      <td
                        key={m}
                        className={"adm-heat__cell" + (v === null ? " is-none" : "")}
                        style={v === null ? undefined : { background: `rgba(42,159,199,${Math.min(0.85, Math.max(0.06, (v - 0.6) / 0.8))})` }}
                      >
                        {v === null ? "—" : v.toFixed(2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---------------- 콘텐츠 ---------------- */

const STATUS_FILTERS = ["전체", "검수 대기", "보류", "생성 실패"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export function ContentView({ rows, copy, copyLabel }: { rows: string[][]; copy: Copy; copyLabel: CopyLabel }) {
  const [filter, setFilter] = useState<StatusFilter>("전체");
  const cards = contentCards(rows);
  if (!cards.length) return <Empty>아직 만든 콘텐츠가 없어요. 시트 메뉴 [냥집사 마케팅] &gt; [5. 냥집사 콘텐츠 만들기]를 실행해 주세요.</Empty>;
  const count = (s: string) => cards.filter((c) => c.status === s).length;
  const shown = filter === "전체" ? cards : cards.filter((c) => c.status === filter);
  return (
    <div className="adm-studio">
      <Kpis
        label="콘텐츠 요약"
        items={[
          { title: "전체 콘텐츠", value: cards.length, unit: "건" },
          { title: "검수 대기", value: count("검수 대기"), unit: "건", star: true, help: "확인 후 복사해서 발행" },
          { title: "보류", value: count("보류"), unit: "건", help: "자동 검사에 걸림 (금지 표현·가격·근거 없는 수치)" },
          { title: "생성 실패", value: count("생성 실패"), unit: "건" },
        ]}
      />
      <div className="adm-studio__filter">
        <Segmented
          label="상태로 보기"
          value={filter}
          options={STATUS_FILTERS.map((s) => ({ value: s, label: s === "전체" ? `전체 ${cards.length}` : `${s} ${count(s)}` }))}
          onChange={setFilter}
        />
      </div>
      {shown.length === 0 ? (
        <Empty>이 상태의 콘텐츠가 없어요.</Empty>
      ) : (
        <ul className="adm-cards" aria-label="콘텐츠 목록">
          {shown.map((c) => {
            const key = `card-${c.row}`;
            return (
              <li key={key} className="adm-ccard">
                <div className="adm-ccard__head">
                  <div className="adm-ccard__title">
                    <span className="adm-ccard__format">{c.format || "형식 없음"}</span>
                    <strong>{c.keyword}</strong>
                    <span className={`adm-status is-${statusTone(c.status)}`}>{c.status || "상태 없음"}</span>
                  </div>
                  <button type="button" className="adm-btn" onClick={() => copy(key, c.body)} disabled={!c.body} aria-label={`${c.keyword} ${c.format} 내용 복사`}>
                    {copyLabel(key, "내용 복사")}
                  </button>
                </div>
                {c.body ? <div className="adm-ccard__body">{c.body}</div> : <p className="adm-muted">내용이 없어요 ({c.check || "생성 실패"})</p>}
                <dl className="adm-ccard__meta">
                  <div>
                    <dt>시트 행</dt>
                    <dd>{c.row}</dd>
                  </div>
                  {c.createdAt && (
                    <div>
                      <dt>생성</dt>
                      <dd>{c.createdAt}</dd>
                    </div>
                  )}
                  {c.risk && (
                    <div>
                      <dt>위험 등급</dt>
                      <dd>{c.risk}</dd>
                    </div>
                  )}
                  {c.source && (
                    <div>
                      <dt>근거</dt>
                      <dd>{c.source}</dd>
                    </div>
                  )}
                  {c.check && (
                    <div>
                      <dt>자동 검사</dt>
                      <dd className={c.check === "통과" ? undefined : "adm-warn"}>{c.check}</dd>
                    </div>
                  )}
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------------- 성과 리포트 ---------------- */

export function ReportView({ rows }: { rows: string[][] }) {
  const pubs = parseReport(rows);
  const total = (k: "views" | "saves" | "shares" | "clicks") => sum(pubs.map((p) => p[k]));
  const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("ko-KR"));
  return (
    <div className="adm-studio">
      <Kpis
        label="성과 요약"
        items={[
          { title: "발행", value: pubs.length, unit: "건", star: true },
          { title: "조회", value: fmt(total("views")) },
          { title: "저장", value: fmt(total("saves")) },
          { title: "공유", value: fmt(total("shares")) },
          { title: "클릭", value: fmt(total("clicks")) },
        ]}
      />
      <Card title="발행 기록" desc="시트 '6_성과리포트' 탭에 발행일·채널·URL·조회 수를 적으면 여기에 모여요">
        {pubs.length === 0 ? (
          <Empty>아직 발행 기록이 없어요. 콘텐츠를 발행한 뒤 시트에 한 줄씩 적어 주세요.</Empty>
        ) : (
          <div className="adm-sheet__wrap">
            <table className="adm-sheet__table">
              <thead>
                <tr>
                  {["발행일", "키워드", "형식", "채널", "조회", "저장", "공유", "클릭", "링크"].map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pubs.map((p, i) => (
                  <tr key={i}>
                    <td>{p.date}</td>
                    <td>{p.keyword}</td>
                    <td>{p.format}</td>
                    <td>{p.channel}</td>
                    <td>{fmt(p.views)}</td>
                    <td>{fmt(p.saves)}</td>
                    <td>{fmt(p.shares)}</td>
                    <td>{fmt(p.clicks)}</td>
                    <td>
                      {/^https?:\/\//.test(p.url) ? (
                        <a href={p.url} target="_blank" rel="noreferrer noopener">
                          열기
                        </a>
                      ) : (
                        p.url
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// AI 건강 상담 (홈 핵심 기능): 메신저형 채팅 UI — 기존 home/js/components/chat.js
// 백엔드 POST /api/chat 과 통신. 요청 형식·화면 문구는 기존과 같습니다.
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { Link } from "react-router";
import { ROUTES, SITE, mapFocusUrl } from "../../services/config/site";
import { postChat } from "../../services/api/endpoints";
import type { ChatHistoryItem, ChatRequest, ChatResponse, PriceComparison } from "../../types/api";
import { requestMyLocation } from "../chatbot/geolocation";
import { SourceList } from "../chatbot/SourceList";
import type { LatLon } from "../chatbot/chatCore";
import { createConsultTracker } from "../../services/analytics/consult";

const SUGGESTIONS = [
  "고양이가 토를 너무 자주 해요.",
  "예방접종은 언제 해야 하나요?",
  "고양이가 밥을 잘 먹지 않아요.",
  "처음 고양이를 키울 때 필요한 검사는 무엇인가요?",
  "고양이가 평소보다 너무 조용해요.",
];
const IMPORTANCE: Record<string, string> = { high: "중요", medium: "참고", low: "알아두기" };
const PLACE_LABEL: Record<string, string> = { pharmacy: "동물약국", grooming: "미용", cremation: "장묘", boarding: "위탁" };

/** 홈의 다른 영역(히어로·가이드)이 상담 입력창을 채우고 포커스할 때 쓰는 핸들 */
export interface HomeChatHandle {
  setInput(text: string): void;
  focus(): void;
}

type Msg =
  | { id: number; who: "user"; text: string }
  | { id: number; who: "bot"; kind: "text"; content: ReactNode }
  | { id: number; who: "bot"; kind: "typing" }
  | { id: number; who: "bot"; kind: "reply"; reply: ChatResponse; last: { text: string; keyword?: string } }
  | { id: number; who: "bot"; kind: "error"; message: string };

/** 기존 askChat: history 는 최근 6개 항목만 */
async function askChat({ message, history, choiceKeyword, location }: { message: string; history: ChatHistoryItem[]; choiceKeyword?: string; location: LatLon | null }) {
  const body: ChatRequest = { message, history: history.slice(-6) };
  if (choiceKeyword) body.choice_keyword = choiceKeyword;
  if (location) {
    body.lat = location.lat;
    body.lon = location.lon;
  }
  return postChat(body);
}

let seq = 0;
const nextId = () => ++seq;

export function HomeChat({ ref }: { ref?: Ref<HomeChatHandle> }) {
  const [messages, setMessages] = useState<Msg[]>(() => [
    {
      id: nextId(),
      who: "bot",
      kind: "text",
      content: (
        <>
          안녕하세요! 저는 우리 고양이의 건강을 함께 관리하는 AI 간호사예요. 🐱<br />어떤 점이 궁금하신가요?
        </>
      ),
    },
  ]);
  const [input, setInput] = useState("");
  const [location, setLocation] = useState<LatLon | null>(null);
  const state = useRef({ history: [] as ChatHistoryItem[], location: null as LatLon | null, busy: false });
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  // 분석: 상담 시작·완료 (상담 문장은 보내지 않음)
  const consult = useRef(createConsultTracker("home"));

  useImperativeHandle(ref, () => ({
    setInput,
    focus: () => inputRef.current?.focus({ preventScroll: true }),
  }));

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  const addBot = (content: ReactNode) => setMessages((ms) => [...ms, { id: nextId(), who: "bot", kind: "text", content }]);

  /** 브라우저 위치 권한 요청. 좌표는 서버의 병원 검색에만 쓰이고 AI 에는 전달되지 않습니다. */
  const requestLocation = async (): Promise<boolean> => {
    if (!navigator.geolocation) {
      addBot("이 브라우저는 위치 기능을 지원하지 않아요.");
      return false;
    }
    const pos = await requestMyLocation({ timeout: 8000 });
    if (!pos) {
      addBot("위치 권한이 없어 근처 병원을 찾을 수 없어요. 브라우저 설정에서 위치를 허용해 주세요.");
      return false;
    }
    const loc = { lat: +pos.lat.toFixed(6), lon: +pos.lon.toFixed(6) };
    state.current.location = loc;
    setLocation(loc);
    return true;
  };

  const send = async (text: string, keyword?: string) => {
    if (state.current.busy) return;
    state.current.busy = true;
    const typingId = nextId();
    setMessages((ms) => [...ms, { id: nextId(), who: "user", text }, { id: typingId, who: "bot", kind: "typing" }]);
    let next: Msg;
    try {
      const r = await askChat({ message: text, history: state.current.history, choiceKeyword: keyword, location: state.current.location });
      state.current.history.push({ role: "user", text }, { role: "assistant", text: r.answer });
      consult.current.onReply({
        hospitals: r.hospitals?.length ?? 0,
        places: r.places?.length ?? 0,
        comparison: !!r.price_comparison,
        followUp: !!r.question || !!r.choices?.length,
        fallback: !!r.fallback,
      });
      next = { id: typingId, who: "bot", kind: "reply", reply: r, last: { text, keyword } };
    } catch (e) {
      next = { id: typingId, who: "bot", kind: "error", message: (e as Error).message };
    } finally {
      state.current.busy = false;
    }
    setMessages((ms) => ms.map((m) => (m.id === typingId ? next : m)));
  };

  const onShareLocation = async (last: { text: string; keyword?: string }): Promise<boolean> => {
    if (!(await requestLocation())) return false;
    state.current.busy = false;
    void send(last.text, last.keyword);
    return true;
  };

  return (
    <section id="chat" className="section">
      <div className="container">
        <div className="section__head reveal">
          <img className="section__mascot" src={SITE.characters.phone} alt="" />
          <span className="eyebrow">AI 건강 상담</span>
          <h2>
            우리 아이가 아픈 것 같다면?<br />AI에게 먼저 물어보세요.
          </h2>
          <p>작은 행동 변화부터 갑작스러운 이상 증상까지, 궁금한 점을 편하게 질문해 보세요.</p>
        </div>
        <div className="chat reveal">
          <div className="chat__suggest" aria-label="추천 질문">
            {SUGGESTIONS.map((q) => (
              <button key={q} className="chip" data-q={q} onClick={() => void send(q)}>{q}</button>
            ))}
          </div>
          <div className="chat__window">
            <div className="chat__top">
              <img src={SITE.appIcon} alt="" className="avatar" />
              <div>
                <strong>AI 간호사</strong>
                <small>수의사 진단을 대신하지 않는 참고용 상담이에요</small>
              </div>
              <button className={"chat__loc" + (location ? " on" : "")} data-loc title="근처 병원 안내에 사용" onClick={() => void requestLocation()}>
                {location ? "📍 위치 사용 중" : "📍 위치 사용"}
              </button>
              <a className="chat__loc" href={ROUTES.chat} target="_blank" rel="noopener" title="챗봇만 크게 보기">크게 보기 ↗</a>
            </div>
            <div className="chat__log" id="chat-log" aria-live="polite" ref={logRef}>
              {messages.map((m) =>
                m.who === "user" ? (
                  <div key={m.id} className="msg msg--user"><div className="bubble">{m.text}</div></div>
                ) : (
                  <div key={m.id} className="msg msg--bot">
                    <img src={SITE.appIcon} alt="" className="avatar avatar--sm" />
                    <div className="bubble">
                      {m.kind === "text" && m.content}
                      {m.kind === "typing" && <span className="typing"><i /><i /><i /></span>}
                      {m.kind === "error" && (
                        <>
                          지금은 AI 상담 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.<br />
                          <span className="muted">({m.message})</span>
                          <br />
                          응급 징후가 있다면 바로 동물병원에 연락해 주세요.
                        </>
                      )}
                      {m.kind === "reply" && (
                        <Reply r={m.reply} onChoice={(label, kw) => void send(label, kw)} onShareLocation={() => onShareLocation(m.last)} />
                      )}
                    </div>
                  </div>
                ),
              )}
            </div>
            <form
              className="chat__form"
              onSubmit={(e) => {
                e.preventDefault();
                const text = input.trim();
                if (text) {
                  setInput("");
                  void send(text);
                }
              }}
            >
              <label htmlFor="chat-input" className="sr-only">질문 입력</label>
              <input
                id="chat-input"
                ref={inputRef}
                maxLength={500}
                autoComplete="off"
                placeholder="예) 고양이가 하루 종일 밥을 안 먹어요"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <button className="btn btn--primary" aria-label="전송">전송</button>
            </form>
          </div>
          <p className="chat__emergency">
            🚨 호흡곤란, 의식 저하, 심한 출혈, 소변을 보지 못하는 등 <b>응급 징후</b>가 보이면 상담보다 먼저 <b>즉시 동물병원</b>에 방문하세요.
          </p>
        </div>
      </div>
    </section>
  );
}

function Reply({ r, onChoice, onShareLocation }: { r: ChatResponse; onChoice(label: string, keyword: string): void; onShareLocation(): Promise<boolean> }) {
  const [shared, setShared] = useState(false);
  return (
    <>
      <p>{r.answer}</p>
      {r.keywords?.length > 0 && (
        <div className="reply__block">
          <b>꼭 확인할 키워드</b>
          <ul className="kw">
            {r.keywords.map((k, i) => (
              <li key={i}>
                <span className={`kw__tag kw__tag--${k.importance}`}>{IMPORTANCE[k.importance] || "참고"}</span>
                <strong>{k.keyword}</strong> {k.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.price_comparison && <Comparison c={r.price_comparison} />}
      {/* 가격 비교표가 있으면 같은 병원 목록을 다시 보여 주지 않음 */}
      {!!r.hospitals?.length && !r.price_comparison && (
        <div className="reply__block">
          <b>가까운 동물병원</b>
          <ul className="list">
            {r.hospitals.map((h) => (
              <li key={h.id}>
                {h.name} <span className="muted">{h.distance_m}m · {h.phone || ""}</span>{" "}
                <a className="link link--sm" href={mapFocusUrl({ lat: h.lat, lon: h.lon, name: h.name, address: h.address, phone: h.phone, typeLabel: "동물병원" })} target="_blank" rel="noopener">
                  지도에서 보기
                </a>
              </li>
            ))}
          </ul>
          <Link className="link" to={ROUTES.map}>지도에서 주변 병원 모두 보기 →</Link>
        </div>
      )}
      {!!r.places?.length && (
        <div className="reply__block">
          <b>가까운 장소</b>
          <ul className="list">
            {r.places.map((p) => (
              <li key={`${p.type}-${p.id}`}>
                {PLACE_LABEL[p.type] || ""} · {p.name} <span className="muted">{p.distance_m}m</span>
                {/* 주소 번지가 가려진 업소는 서버가 좌표를 주지 않으므로 지도 링크도 없음 */}
                {p.lat != null && p.lon != null && (
                  <>
                    {" "}
                    <a
                      className="link link--sm"
                      href={mapFocusUrl({ lat: p.lat, lon: p.lon, name: p.name, address: p.road_address, phone: p.phone, typeLabel: PLACE_LABEL[p.type] || "" })}
                      target="_blank"
                      rel="noopener"
                    >
                      지도에서 보기
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.needs_location && (
        <div className="reply__block">
          <button
            className="btn btn--outline btn--sm"
            data-share-loc
            disabled={shared}
            onClick={async () => {
              if (await onShareLocation()) setShared(true);
            }}
          >
            📍 내 위치 공유하고 근처 병원 보기
          </button>
        </div>
      )}
      {r.question && <p className="reply__q">{r.question}</p>}
      {!!r.choices?.length && (
        <div className="choices">
          {r.choices.map((c, i) => (
            <button key={i} className={"chip " + (c.kind === "explore" ? "chip--explore" : "")} data-choice={i} onClick={() => onChoice(c.label, c.keyword)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      <SourceList sources={r.sources} className="reply__note reply__sources" />
      <p className="reply__note">
        {r.fallback ? "AI 연결이 원활하지 않아 기본 안내를 보여드려요. " : ""}
        {r.disclaimer || ""}
      </p>
    </>
  );
}

const won = (n: number | null) => (Number.isFinite(n) ? (n as number).toLocaleString("ko-KR") + "원" : "-");
const dist = (m: number) => (m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`);

/** 근처 병원 진료비 비교표 (가격 낮은 순). 숫자는 모두 서버(DB) 값입니다. */
function Comparison({ c }: { c: PriceComparison }) {
  const title = (
    <>
      {c.item_name}
      {c.condition && c.condition !== "-" && <> <span className="muted">({c.condition})</span></>}
    </>
  );
  if (!c.rows?.length) {
    return (
      <div className="reply__block">
        <b>{title} 가격 비교</b>
        <p className="muted">반경 안에 이 항목의 가격 정보가 있는 병원이 없어요.</p>
      </div>
    );
  }
  return (
    <div className="reply__block compare">
      <b>{title} · 근처 병원 가격 비교 ({c.rows.length}곳)</b>
      <div className="compare__sum">
        <span>최저 {won(c.min)}</span>
        <span>평균 {won(c.avg)}</span>
        <span>최고 {won(c.max)}</span>
      </div>
      <table className="compare__table">
        <tbody>
          {c.rows.map((r, i) => (
            <tr key={r.hospital_id} className={i === 0 ? "best" : ""}>
              <td className="rank">{i + 1}</td>
              <td>
                <strong>{r.name}</strong>
                <br />
                <span className="muted">{dist(r.distance_m)}{r.phone ? " · " + r.phone : ""}</span>
              </td>
              <td className="price">{won(r.price)}</td>
              <td>
                <a className="link link--sm" href={mapFocusUrl({ lat: r.lat, lon: r.lon, name: r.name, address: r.address, phone: r.phone, typeLabel: "동물병원" })} target="_blank" rel="noopener">
                  지도
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="reply__note">{c.notice || ""}</p>
    </div>
  );
}

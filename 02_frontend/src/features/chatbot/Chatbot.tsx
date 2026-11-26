// 냥집사 챗봇 화면 (기존 map-poc/chatbot/chatbot.js 를 React 로 옮김. 클래스·문구·동작 동일)
//   layout = "floating"(기본: 지도 위 플로팅 버튼 + 창) | "page"(챗봇 단독 화면)
//   map(선택) = { getCenter(), focus(card) } ← 지도 쪽이 제공하는 연결 지점
//
// 역할 분리
// - AI 답변: 백엔드 POST /api/chat (모델·키는 서버 환경변수. 프론트에는 키가 없습니다)
// - 병원·장소 정보: 백엔드가 DB 에서 붙여 준 값만 카드로 표시
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { getNearbyPlaces, postChat } from "../../services/api/endpoints";
import { ApiError, isAbortError } from "../../services/api/client";
import type { ChatRequest } from "../../types/api";
import * as C from "./chatCore";
import type { AssistantMessage, ChatMessage, Comparison, LatLon, PlaceCard } from "./chatCore";
import type { FocusCard, MapBridge } from "./mapBridge";
import { CloseIcon, PhoneIcon, PinIcon, ResetIcon, SendIcon } from "./icons";
import { requestMyLocation } from "./geolocation";
import { SourceList } from "./SourceList";
import { createConsultTracker } from "../../services/analytics/consult";

const SEARCH_RADIUS_M = 3000; // 백엔드 CHAT_RADIUS_M 과 동일
const FALLBACK_LIMIT = 5;
const MOBILE = "(max-width: 760px)";

interface Props {
  logoSrc: string;
  map?: MapBridge | null;
  layout?: "floating" | "page";
}

export function Chatbot({ logoSrc, map = null, layout = "floating" }: Props) {
  const isPage = layout === "page";
  const [open, setOpen] = useState(isPage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastRequest, setLastRequest] = useState<ChatRequest | null>(null);
  const [myLocation, setMyLocation] = useState<LatLon | null>(null);
  const [input, setInput] = useState("");
  const [myLocBtn, setMyLocBtn] = useState({ disabled: false, text: "내 위치 사용" });

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  // 분석: 상담 시작·완료 (상담 문장은 보내지 않음). 지도 위 챗봇 = map, 단독 화면 = chatbot
  const consult = useRef(createConsultTracker(isPage ? "chatbot" : "map"));
  // 비동기 콜백에서 최신 값을 읽기 위한 거울
  const latest = useRef({ busy, messages, myLocation, open });
  useLayoutEffect(() => {
    latest.current = { busy, messages, myLocation, open };
  });

  const currentLocation = useCallback((): LatLon | null => latest.current.myLocation || map?.getCenter?.() || null, [map]);

  // ---------- 열기/닫기 ----------
  const openPanel = useCallback(() => {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 120);
  }, []);
  const closePanel = useCallback(() => {
    if (isPage) return;
    setOpen(false);
    fabRef.current?.focus({ preventScroll: true });
  }, [isPage]);

  useEffect(() => {
    if (isPage) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && latest.current.open) closePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isPage, closePanel]);

  // 진행 중 요청은 화면을 떠날 때 취소
  useEffect(() => () => controllerRef.current?.abort(), []);

  // ---------- 모바일 키보드 대응: 보이는 영역 높이에 맞춤 ----------
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      rootRef.current?.style.setProperty("--nj-vh", vv.height + "px");
      if (panelRef.current) panelRef.current.style.top = window.matchMedia(MOBILE).matches ? vv.offsetTop + "px" : "";
      if (latest.current.open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, [open]);

  // 새 메시지·로딩·오류가 생기면 맨 아래로
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [messages, busy, error]);

  // 입력창 높이 자동 조절 (최대 120px)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
    el.classList.toggle("is-tall", el.scrollHeight > 120);
  }, [input]);

  // ---------- 전송 ----------
  // 병원 테이블이 비어 있을 때 업종 데이터로 같은 반경을 다시 조회 (둘 다 실제 DB)
  const searchHospitalsFallback = async (center: LatLon, signal: AbortSignal): Promise<PlaceCard[]> => {
    try {
      const body = await getNearbyPlaces({ lon: center.lon, lat: center.lat, radius_m: SEARCH_RADIUS_M, type: ["hospital"], limit: FALLBACK_LIMIT }, signal);
      return (body.items || []).map(C.placeToCard);
    } catch (e) {
      if (isAbortError(e)) throw e;
      return [];
    }
  };

  const request = async (req: ChatRequest) => {
    setLastRequest(req);
    setError(null);
    controllerRef.current?.abort();
    const controller = (controllerRef.current = new AbortController());
    setBusy(true);
    try {
      const data = await postChat(req, controller.signal);
      const msg: AssistantMessage = C.toAssistantMessage(data);
      if (C.needsHospitalFallback(data) && req.lat != null && req.lon != null) {
        const extra = await searchHospitalsFallback({ lat: req.lat, lon: req.lon }, controller.signal);
        msg.cards = msg.cards.concat(extra);
      }
      if (controller !== controllerRef.current) return;
      consult.current.onReply({
        hospitals: msg.cards.length,
        places: 0,
        comparison: !!msg.comparison,
        followUp: !!msg.question || msg.choices.length > 0,
        fallback: msg.fallback,
      });
      setMessages((ms) => [...ms, msg]);
      setLastRequest(null);
      setBusy(false);
    } catch (e) {
      if (isAbortError(e)) return;
      setBusy(false);
      setError(C.errorText(e instanceof ApiError ? e.status : 0));
    }
  };

  const send = (text: string, { choiceKeyword = null }: { choiceKeyword?: string | null } = {}) => {
    const prev = latest.current.messages;
    setMessages([...prev, { role: "user", text }]);
    void request(C.buildRequest({ message: text, messages: prev, location: currentLocation(), choiceKeyword }));
  };

  const sendFromInput = () => {
    const v = C.validateMessage(input);
    if (!v.ok || busy) return;
    setInput("");
    send(v.message);
  };

  const reset = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    consult.current.reset();
    setMessages([]);
    setLastRequest(null);
    setBusy(false);
    setError(null);
    setInput("");
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 전송, Shift+Enter 줄바꿈, 한글 조합 중 Enter 는 무시
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      sendFromInput();
    }
  };

  // ---------- 위치 ----------
  const onMyLocationLink = async () => {
    setMyLocBtn((b) => ({ ...b, disabled: true }));
    const loc = await requestMyLocation();
    if (!loc) {
      setMyLocBtn({ disabled: false, text: "위치 권한을 확인해 주세요" });
      return;
    }
    setMyLocBtn((b) => ({ ...b, disabled: false }));
    setMyLocation(loc);
  };

  const onSuggestion = async (q: string) => {
    // "내 주변" 질문은 내 위치를 먼저 요청 (거부하면 지도 중심 기준)
    if (q.startsWith("내 주변") && !latest.current.myLocation) {
      const loc = await requestMyLocation();
      if (loc) {
        setMyLocation(loc);
        latest.current.myLocation = loc;
      }
    }
    send(q);
  };

  // 위치를 정한 뒤 마지막 질문을 다시 보냄 (대화에 같은 질문을 또 쌓지 않음)
  const resendLastUser = () => {
    const ms = latest.current.messages;
    let idx = -1;
    ms.forEach((m, i) => {
      if (m.role === "user") idx = i;
    });
    if (idx < 0 || latest.current.busy) return;
    void request(C.buildRequest({ message: ms[idx].text, messages: ms.slice(0, idx), location: currentLocation() }));
  };

  const showOnMap = (card: FocusCard) => {
    if (!map) return;
    // 모바일(전체 화면 채팅)에서는 지도를 볼 수 있게 채팅을 닫고,
    // PC 에서는 채팅창이 가리는 만큼 지도 표시 위치를 비켜 줌
    const mobile = window.matchMedia(MOBILE).matches;
    if (isPage) return map.focus(card, { rightInset: 0 });
    if (mobile) closePanel();
    map.focus(card, { rightInset: mobile ? 0 : (panelRef.current?.offsetWidth || 0) + 20 });
  };

  const hasMapCenter = !!map?.getCenter?.();
  const locNote = myLocation ? "검색 기준: 내 위치" : hasMapCenter ? "검색 기준: 지도 중심 · " : "검색 기준: 위치 없음 · ";
  const sendDisabled = busy || !input.trim();
  const stateName = busy ? "busy" : error ? "error" : "ready";
  const stateLabel = busy ? "AI 도우미 · 답변 작성 중" : error ? "AI 도우미 · 연결 확인 필요" : "AI 도우미 · 대화 가능";
  const logo = (alt = "") => <img className="nj-logo " src={logoSrc} alt={alt} draggable={false} />;

  const panel = (
    <section ref={panelRef} id="nj-panel" className="nj-panel" role="dialog" aria-modal="false" aria-label="냥집사 AI 도우미">
      <header className="nj-head">
        {logo("냥집사 로고")}
        <div className="nj-head-text">
          <h2 className="nj-title">냥집사</h2>
          <div className="nj-state" data-state={stateName}>
            <span className="nj-dot" />
            <span>{stateLabel}</span>
          </div>
        </div>
        <button className="nj-icon-btn" type="button" aria-label="대화 초기화" title="대화 초기화" onClick={reset}>
          <ResetIcon />
        </button>
        {!isPage && (
          <button className="nj-icon-btn" type="button" aria-label="닫기" title="닫기" onClick={closePanel}>
            <CloseIcon />
          </button>
        )}
      </header>

      <div ref={bodyRef} className="nj-body" role="log" aria-live="polite" aria-relevant="additions">
        {!messages.length && (
          <div className="nj-welcome">
            {logo("냥집사 고양이 간호사")}
            <h2>안녕하세요, 냥집사예요!</h2>
            <p>주변 동물병원 찾기부터 연락처, 진료비 참고 정보까지 고양이 병원 고민을 함께 정리해 드릴게요. 진단은 수의사 선생님께 꼭 확인해 주세요.</p>
            <div className="nj-sugg-title">이렇게 물어보세요</div>
            <div className="nj-sugg">
              {C.SUGGESTIONS.map((q) => (
                <button key={q} type="button" onClick={() => void onSuggestion(q)}>{q}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="nj-msg is-user"><div className="nj-bubble">{m.text}</div></div>
          ) : (
            <AiMessage
              key={i}
              m={m}
              isLast={i === messages.length - 1}
              busy={busy}
              logo={logo()}
              canFocus={!!map?.focus}
              hasMapCenter={hasMapCenter}
              onChoice={(label, keyword) => send(label, { choiceKeyword: keyword })}
              onShowOnMap={showOnMap}
              onUseMyLocation={async () => {
                const loc = await requestMyLocation();
                if (!loc) return false;
                setMyLocation(loc);
                latest.current.myLocation = loc;
                resendLastUser();
                return true;
              }}
              onUseMapCenter={resendLastUser}
            />
          ),
        )}
        {busy && (
          <div className="nj-msg is-ai" aria-label="답변 작성 중">
            {logo()}
            <div className="nj-bubble nj-typing"><i /><i /><i /></div>
          </div>
        )}
        {error && (
          <div className="nj-error" role="alert">
            <span>{error}</span>
            {lastRequest && (
              <button type="button" className="nj-btn" onClick={() => void request(lastRequest)}>다시 시도</button>
            )}
          </div>
        )}
      </div>

      <footer className="nj-foot">
        <form className="nj-form" onSubmit={(e: FormEvent) => { e.preventDefault(); sendFromInput(); }}>
          <textarea
            ref={inputRef}
            className="nj-input"
            rows={1}
            placeholder="고양이 병원, 궁금한 걸 물어보세요"
            aria-label="메시지 입력"
            maxLength={C.MAX_MESSAGE_CHARS}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button className="nj-send" type="submit" aria-label="보내기" disabled={sendDisabled}>
            <SendIcon />
          </button>
        </form>
        <div className="nj-foot-note">
          <span>
            <span>{locNote}</span>
            <button type="button" className="nj-link" hidden={!!myLocation} disabled={myLocBtn.disabled} onClick={() => void onMyLocationLink()}>
              {myLocBtn.text}
            </button>
          </span>
          <span>{`${[...input].length}/${C.MAX_MESSAGE_CHARS}`}</span>
        </div>
      </footer>
    </section>
  );

  return (
    <div ref={rootRef} className={"nj-root" + (isPage ? " is-page" : "") + (open ? " is-open" : "")}>
      {!isPage && (
        <button
          ref={fabRef}
          className="nj-fab"
          type="button"
          aria-label="냥집사 AI 도우미 열기"
          aria-expanded={open}
          aria-controls="nj-panel"
          onClick={openPanel}
        >
          {logo()}
          <span className="nj-fab-tip">냥집사 도우미에게 물어보기</span>
        </button>
      )}
      {panel}
    </div>
  );
}

interface AiMessageProps {
  m: AssistantMessage;
  isLast: boolean;
  busy: boolean;
  logo: React.ReactNode;
  canFocus: boolean;
  hasMapCenter: boolean;
  onChoice(label: string, keyword: string): void;
  onShowOnMap(card: FocusCard): void;
  onUseMyLocation(): Promise<boolean>;
  onUseMapCenter(): void;
}

function AiMessage({ m, isLast, busy, logo, canFocus, hasMapCenter, onChoice, onShowOnMap, onUseMyLocation, onUseMapCenter }: AiMessageProps) {
  return (
    <div className="nj-msg is-ai">
      {logo}
      <div className="nj-col">
        <div className="nj-bubble">
          {m.text || "답변을 준비하지 못했어요. 다시 물어봐 주세요."}
          {m.question && <div className="nj-question">{m.question}</div>}
        </div>

        {m.keywords.length > 0 && (
          <div className="nj-kw" aria-label="중요 키워드">
            {m.keywords.map((k, i) => (
              <span key={i} className={"is-" + (["high", "medium", "low"].includes(k.importance) ? k.importance : "low")} title={k.reason || ""}>
                {k.keyword}
              </span>
            ))}
          </div>
        )}

        {m.comparison && <ComparisonTable cmp={m.comparison} canFocus={canFocus} onShowOnMap={onShowOnMap} />}

        {m.cards.length > 0 && <Cards list={m.cards} canFocus={canFocus} onShowOnMap={onShowOnMap} />}

        {m.needsLocation && <LocationAsk hasMapCenter={hasMapCenter} onUseMyLocation={onUseMyLocation} onUseMapCenter={onUseMapCenter} />}

        {m.choices.length > 0 && (
          <div className="nj-choices">
            {m.choices.map((c, i) => (
              <button key={i} type="button" className={c.kind === "explore" ? "is-explore" : undefined} disabled={!isLast || busy} onClick={() => onChoice(c.label, c.keyword)}>
                {c.label}
              </button>
            ))}
          </div>
        )}

        <SourceList sources={m.sources} className="nj-note nj-sources" />

        {m.disclaimer && (m.cards.length > 0 || isLast) && <div className="nj-note">{m.disclaimer}</div>}
      </div>
    </div>
  );
}

// 근처 병원 가격 비교표 (가격 낮은 순). 숫자는 서버(DB) 값만 사용
function ComparisonTable({ cmp, canFocus, onShowOnMap }: { cmp: Comparison; canFocus: boolean; onShowOnMap(c: FocusCard): void }) {
  const title = cmp.item + (cmp.condition ? ` (${cmp.condition})` : "");
  return (
    <div className="nj-compare" aria-label="진료비 비교">
      <div className="nj-cards-title">{`${title} · 근처 병원 가격 비교 (${cmp.rows.length}곳)`}</div>
      {!cmp.rows.length ? (
        <div className="nj-card-line">반경 안에 이 항목의 가격 정보가 있는 병원이 없어요.</div>
      ) : (
        <>
          <div className="nj-compare-sum">
            <span>{"최저 " + C.fmtPrice(cmp.min)}</span>
            <span>{"평균 " + C.fmtPrice(cmp.avg)}</span>
            <span>{"최고 " + C.fmtPrice(cmp.max)}</span>
          </div>
          <ol className="nj-compare-list">
            {cmp.rows.map((r, i) => {
              const canMap = r.lat != null && r.lon != null && canFocus;
              return (
                <li key={r.key} className={i === 0 ? "is-best" : undefined}>
                  <div className="nj-compare-name">
                    <b>{r.name}</b>
                    <small>{C.fmtDist(r.distance_m) + (r.phone ? " · " + r.phone : "")}</small>
                  </div>
                  <b className="nj-compare-price">{C.fmtPrice(r.price)}</b>
                  {canMap && <button type="button" className="nj-btn nj-compare-map" onClick={() => onShowOnMap(r)}>지도</button>}
                </li>
              );
            })}
          </ol>
          {cmp.notice && <div className="nj-note">{cmp.notice}</div>}
        </>
      )}
    </div>
  );
}

function Cards({ list, canFocus, onShowOnMap }: { list: PlaceCard[]; canFocus: boolean; onShowOnMap(c: FocusCard): void }) {
  return (
    <div className="nj-cards">
      <div className="nj-cards-title">{`검색 결과 ${list.length}곳 · 반경 ${SEARCH_RADIUS_M / 1000}km`}</div>
      {list.map((c) => {
        const canMap = c.lat != null && c.lon != null && canFocus;
        const tel = C.telHref(c.phone);
        return (
          <article key={c.key} className="nj-card">
            <div className="nj-card-top">
              <div className="nj-card-name">{c.name}</div>
              <div className="nj-card-dist">{C.fmtDist(c.distance_m)}</div>
            </div>
            {c.typeLabel && c.kind !== "hospital" && <span className="nj-card-type">{c.typeLabel}</span>}
            <div className="nj-card-line">{c.address || "주소 정보 없음"}</div>
            <div className="nj-card-line">{c.phone || "전화번호 정보 없음"}</div>
            {c.fees.length > 0 && (
              <ul className="nj-fees" aria-label="진료비 참고">
                {c.fees.slice(0, 4).map((f, i) => (
                  <li key={i}>
                    <span>{f.item_name + (f.condition ? ` (${f.condition})` : "") + (f.is_dummy ? " · 참고용" : "")}</span>
                    <b>{C.fmtPrice(f.price)}</b>
                  </li>
                ))}
              </ul>
            )}
            <div className="nj-card-actions">
              <button
                type="button"
                className="nj-btn is-primary"
                disabled={!canMap}
                title={canMap ? undefined : "정확한 위치가 공개되지 않은 곳이에요"}
                onClick={() => onShowOnMap(c)}
              >
                <PinIcon />
                <span>지도에서 보기</span>
              </button>
              {tel && (
                <a className="nj-btn" href={tel}>
                  <PhoneIcon />
                  <span>전화</span>
                </a>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function LocationAsk({ hasMapCenter, onUseMyLocation, onUseMapCenter }: { hasMapCenter: boolean; onUseMyLocation(): Promise<boolean>; onUseMapCenter(): void }) {
  const [btn, setBtn] = useState({ disabled: false, text: "내 위치 사용" });
  return (
    <div className="nj-loc">
      <div>주변 병원을 찾으려면 위치가 필요해요.</div>
      <div className="nj-loc-actions">
        <button
          type="button"
          className="nj-btn is-primary"
          disabled={btn.disabled}
          onClick={async () => {
            setBtn({ disabled: true, text: "내 위치 사용" });
            if (!(await onUseMyLocation())) setBtn({ disabled: false, text: "위치 권한을 확인해 주세요" });
          }}
        >
          {btn.text}
        </button>
        {hasMapCenter && <button type="button" className="nj-btn" onClick={onUseMapCenter}>지도 중심 기준</button>}
      </div>
    </div>
  );
}

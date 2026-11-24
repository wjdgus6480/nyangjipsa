// 냥집사 챗봇 화면 (의존성 없음)
// 사용: NyangChatbot.mount({ apiBase, logoSrc, map, layout })
//   map(선택) = { getCenter(): {lat, lon} | null, focus(card) }  ← 지도 쪽이 제공하는 연결 지점
//   layout = "floating"(기본: 지도 위 플로팅 버튼 + 창) | "page"(챗봇 단독 화면, chat.html)
//
// 역할 분리
// - AI 답변: 백엔드 POST /api/chat (모델·키는 서버 환경변수. 프론트에는 키가 없습니다)
// - 병원·장소 정보: 백엔드가 DB 에서 붙여 준 값만 카드로 표시
(function () {
  "use strict";
  const C = window.NyangChatCore;
  const SEARCH_RADIUS_M = 3000; // 백엔드 CHAT_RADIUS_M 과 동일
  const FALLBACK_LIMIT = 5;

  const ICON = {
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M12 5l7 7-7 7"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
  };

  function el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v; // 고정 아이콘 SVG 에만 사용
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of [].concat(children)) if (c) n.append(c);
    return n;
  }

  function mount({ apiBase, logoSrc, map = null, container = document.body, layout = "floating" }) {
    const isPage = layout === "page";
    const state = {
      open: false,
      busy: false,
      messages: [],        // {role, text, ...}
      lastRequest: null,   // 재시도용
      controller: null,
      myLocation: null,    // 사용자가 허용한 현재 위치
    };

    const logo = (cls, alt = "") => el("img", { class: "nj-logo " + (cls || ""), src: logoSrc, alt, draggable: "false" });

    // ---------- 뼈대 ----------
    const fab = el("button", { class: "nj-fab", type: "button", "aria-label": "냥집사 AI 도우미 열기", "aria-expanded": "false", "aria-controls": "nj-panel" }, [
      logo(""),
      el("span", { class: "nj-fab-tip", text: "냥집사 도우미에게 물어보기" }),
    ]);

    const stateLabel = el("span", { text: "AI 도우미 · 대화 가능" });
    const stateBox = el("div", { class: "nj-state", "data-state": "ready" }, [el("span", { class: "nj-dot" }), stateLabel]);
    const btnReset = el("button", { class: "nj-icon-btn", type: "button", "aria-label": "대화 초기화", title: "대화 초기화", html: ICON.reset, onclick: reset });
    const btnClose = isPage ? null : el("button", { class: "nj-icon-btn", type: "button", "aria-label": "닫기", title: "닫기", html: ICON.close, onclick: close });

    const body = el("div", { class: "nj-body", role: "log", "aria-live": "polite", "aria-relevant": "additions" });
    const input = el("textarea", { class: "nj-input", rows: "1", placeholder: "고양이 병원, 궁금한 걸 물어보세요", "aria-label": "메시지 입력", maxlength: String(C.MAX_MESSAGE_CHARS) });
    const btnSend = el("button", { class: "nj-send", type: "submit", "aria-label": "보내기", html: ICON.send, disabled: true });
    const form = el("form", { class: "nj-form", onsubmit: (e) => { e.preventDefault(); sendFromInput(); } }, [input, btnSend]);
    const locNote = el("span");
    const btnMyLoc = el("button", { type: "button", class: "nj-link", text: "내 위치 사용", onclick: useMyLocation });
    const counter = el("span", { text: `0/${C.MAX_MESSAGE_CHARS}` });

    const panel = el("section", { id: "nj-panel", class: "nj-panel", role: "dialog", "aria-modal": "false", "aria-label": "냥집사 AI 도우미" }, [
      el("header", { class: "nj-head" }, [
        logo("", "냥집사 로고"),
        el("div", { class: "nj-head-text" }, [el("h2", { class: "nj-title", text: "냥집사" }), stateBox]),
        btnReset,
        btnClose,
      ]),
      body,
      el("footer", { class: "nj-foot" }, [form, el("div", { class: "nj-foot-note" }, [el("span", {}, [locNote, btnMyLoc]), counter])]),
    ]);

    const root = el("div", { class: "nj-root" + (isPage ? " is-page" : "") }, isPage ? [panel] : [fab, panel]);
    container.append(root);

    // ---------- 열기/닫기 ----------
    fab.addEventListener("click", open);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.open && !isPage) close(); });

    function open() {
      state.open = true;
      root.classList.add("is-open");
      fab.setAttribute("aria-expanded", "true");
      if (!state.messages.length) renderAll();
      updateLocNote();
      syncViewport();
      setTimeout(() => input.focus({ preventScroll: true }), 120);
    }
    function close() {
      if (isPage) return;
      state.open = false;
      root.classList.remove("is-open");
      fab.setAttribute("aria-expanded", "false");
      fab.focus({ preventScroll: true });
    }
    function reset() {
      state.controller?.abort();
      state.messages = [];
      state.lastRequest = null;
      setBusy(false);
      renderAll();
      input.value = "";
      onInput();
      input.focus();
    }

    // ---------- 입력 ----------
    input.addEventListener("input", onInput);
    input.addEventListener("keydown", (e) => {
      // Enter 전송, Shift+Enter 줄바꿈, 한글 조합 중 Enter 는 무시
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        sendFromInput();
      }
    });
    function onInput() {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
      input.classList.toggle("is-tall", input.scrollHeight > 120);
      const n = [...input.value].length;
      counter.textContent = `${n}/${C.MAX_MESSAGE_CHARS}`;
      btnSend.disabled = state.busy || !input.value.trim();
    }
    function sendFromInput() {
      const v = C.validateMessage(input.value);
      if (!v.ok || state.busy) return;
      input.value = "";
      onInput();
      send(v.message);
    }

    // ---------- 위치 ----------
    function currentLocation() {
      if (state.myLocation) return state.myLocation;
      return map?.getCenter?.() || null;
    }
    function updateLocNote() {
      locNote.textContent = state.myLocation ? "검색 기준: 내 위치" : map?.getCenter?.() ? "검색 기준: 지도 중심 · " : "검색 기준: 위치 없음 · ";
      btnMyLoc.hidden = !!state.myLocation;
    }
    async function useMyLocation() {
      btnMyLoc.disabled = true;
      const loc = await requestMyLocation();
      btnMyLoc.disabled = false;
      if (!loc) { btnMyLoc.textContent = "위치 권한을 확인해 주세요"; return; }
      state.myLocation = loc;
      updateLocNote();
    }
    function requestMyLocation() {
      return new Promise((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
        );
      });
    }

    // ---------- 전송 ----------
    async function send(text, { choiceKeyword = null } = {}) {
      state.messages.push({ role: "user", text });
      renderAll();
      const req = C.buildRequest({ message: text, messages: state.messages.slice(0, -1), location: currentLocation(), choiceKeyword });
      await request(req);
    }

    async function request(req) {
      state.lastRequest = req;
      state.controller?.abort();
      const controller = (state.controller = new AbortController());
      setBusy(true);
      try {
        const res = await fetch(`${apiBase}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(req),
          signal: controller.signal,
        });
        if (!res.ok) throw Object.assign(new Error("http"), { status: res.status });
        const data = await res.json();
        const msg = C.toAssistantMessage(data);
        if (C.needsHospitalFallback(data) && req.lat != null) {
          const extra = await searchHospitalsFallback({ lat: req.lat, lon: req.lon }, controller.signal);
          msg.cards = msg.cards.concat(extra);
        }
        if (controller !== state.controller) return;
        state.messages.push(msg);
        state.lastRequest = null;
        setBusy(false);
        renderAll();
      } catch (e) {
        if (e.name === "AbortError") return;
        setBusy(false, true);
        renderAll(C.errorText(e.status || 0));
      }
    }

    // 병원 테이블이 비어 있을 때 업종 데이터로 같은 반경을 다시 조회 (둘 다 실제 DB)
    async function searchHospitalsFallback(center, signal) {
      const q = new URLSearchParams({ lon: center.lon, lat: center.lat, radius_m: SEARCH_RADIUS_M, type: "hospital", limit: FALLBACK_LIMIT });
      try {
        const res = await fetch(`${apiBase}/api/places/nearby?${q}`, { signal });
        if (!res.ok) return [];
        const body = await res.json();
        return (body.items || []).map(C.placeToCard);
      } catch (e) {
        if (e.name === "AbortError") throw e;
        return [];
      }
    }

    function setBusy(busy, error = false) {
      state.busy = busy;
      stateBox.dataset.state = busy ? "busy" : error ? "error" : "ready";
      stateLabel.textContent = busy ? "AI 도우미 · 답변 작성 중" : error ? "AI 도우미 · 연결 확인 필요" : "AI 도우미 · 대화 가능";
      onInput();
    }

    // ---------- 그리기 ----------
    function renderAll(errorMsg = null) {
      body.replaceChildren();
      if (!state.messages.length) body.append(welcome());
      state.messages.forEach((m, i) => body.append(m.role === "user" ? userMsg(m) : aiMsg(m, i === state.messages.length - 1)));
      if (state.busy) body.append(typing());
      if (errorMsg) body.append(errorBox(errorMsg));
      updateLocNote();
      requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
    }

    function welcome() {
      return el("div", { class: "nj-welcome" }, [
        logo("", "냥집사 고양이 간호사"),
        el("h2", { text: "안녕하세요, 냥집사예요!" }),
        el("p", { text: "주변 동물병원 찾기부터 연락처, 진료비 참고 정보까지 고양이 병원 고민을 함께 정리해 드릴게요. 진단은 수의사 선생님께 꼭 확인해 주세요." }),
        el("div", { class: "nj-sugg-title", text: "이렇게 물어보세요" }),
        el("div", { class: "nj-sugg" }, C.SUGGESTIONS.map((q) => el("button", { type: "button", text: q, onclick: () => onSuggestion(q) }))),
      ]);
    }

    async function onSuggestion(q) {
      // "내 주변" 질문은 내 위치를 먼저 요청 (거부하면 지도 중심 기준)
      if (q.startsWith("내 주변") && !state.myLocation) {
        const loc = await requestMyLocation();
        if (loc) { state.myLocation = loc; updateLocNote(); }
      }
      send(q);
    }

    function userMsg(m) {
      return el("div", { class: "nj-msg is-user" }, [el("div", { class: "nj-bubble", text: m.text })]);
    }

    function aiMsg(m, isLast) {
      const col = el("div", { class: "nj-col" });
      const bubble = el("div", { class: "nj-bubble" }, [document.createTextNode(m.text || "답변을 준비하지 못했어요. 다시 물어봐 주세요.")]);
      if (m.question) bubble.append(el("div", { class: "nj-question", text: m.question }));
      col.append(bubble);

      if (m.keywords.length) {
        col.append(el("div", { class: "nj-kw", "aria-label": "중요 키워드" }, m.keywords.map((k) =>
          el("span", { class: "is-" + (["high", "medium", "low"].includes(k.importance) ? k.importance : "low"), title: k.reason || "", text: k.keyword }))));
      }

      if (m.comparison) col.append(comparisonTable(m.comparison));

      if (m.cards.length) col.append(cards(m.cards));

      if (m.needsLocation) col.append(locationAsk());

      if (m.choices.length) {
        col.append(el("div", { class: "nj-choices" }, m.choices.map((c) =>
          el("button", {
            type: "button",
            class: c.kind === "explore" ? "is-explore" : "",
            text: c.label,
            disabled: !isLast || state.busy,
            onclick: () => send(c.label, { choiceKeyword: c.keyword }),
          }))));
      }

      if (m.disclaimer && (m.cards.length || isLast)) col.append(el("div", { class: "nj-note", text: m.disclaimer }));
      return el("div", { class: "nj-msg is-ai" }, [logo(""), col]);
    }

    // 근처 병원 가격 비교표 (가격 낮은 순). 숫자는 서버(DB) 값만 사용
    function comparisonTable(cmp) {
      const title = cmp.item + (cmp.condition ? ` (${cmp.condition})` : "");
      const wrap = el("div", { class: "nj-compare", "aria-label": "진료비 비교" }, [
        el("div", { class: "nj-cards-title", text: `${title} · 근처 병원 가격 비교 (${cmp.rows.length}곳)` }),
      ]);
      if (!cmp.rows.length) {
        wrap.append(el("div", { class: "nj-card-line", text: "반경 안에 이 항목의 가격 정보가 있는 병원이 없어요." }));
        return wrap;
      }
      wrap.append(el("div", { class: "nj-compare-sum" }, [
        el("span", { text: "최저 " + C.fmtPrice(cmp.min) }),
        el("span", { text: "평균 " + C.fmtPrice(cmp.avg) }),
        el("span", { text: "최고 " + C.fmtPrice(cmp.max) }),
      ]));
      const ol = el("ol", { class: "nj-compare-list" });
      cmp.rows.forEach((r, i) => {
        const canMap = r.lat != null && r.lon != null && !!map?.focus;
        ol.append(el("li", { class: i === 0 ? "is-best" : "" }, [
          el("div", { class: "nj-compare-name" }, [
            el("b", { text: r.name }),
            el("small", { text: C.fmtDist(r.distance_m) + (r.phone ? " · " + r.phone : "") }),
          ]),
          el("b", { class: "nj-compare-price", text: C.fmtPrice(r.price) }),
          canMap ? el("button", { type: "button", class: "nj-btn nj-compare-map", text: "지도", onclick: () => showOnMap(r) }) : null,
        ]));
      });
      wrap.append(ol);
      if (cmp.notice) wrap.append(el("div", { class: "nj-note", text: cmp.notice }));
      return wrap;
    }

    function cards(list) {
      const wrap = el("div", { class: "nj-cards" }, [el("div", { class: "nj-cards-title", text: `검색 결과 ${list.length}곳 · 반경 ${SEARCH_RADIUS_M / 1000}km` })]);
      for (const c of list) {
        const canMap = c.lat != null && c.lon != null && !!map?.focus;
        const tel = C.telHref(c.phone);
        const card = el("article", { class: "nj-card" }, [
          el("div", { class: "nj-card-top" }, [el("div", { class: "nj-card-name", text: c.name }), el("div", { class: "nj-card-dist", text: C.fmtDist(c.distance_m) })]),
          c.typeLabel && c.kind !== "hospital" ? el("span", { class: "nj-card-type", text: c.typeLabel }) : null,
          el("div", { class: "nj-card-line", text: c.address || "주소 정보 없음" }),
          el("div", { class: "nj-card-line", text: c.phone || "전화번호 정보 없음" }),
        ]);
        if (c.fees.length) {
          card.append(el("ul", { class: "nj-fees", "aria-label": "진료비 참고" }, c.fees.slice(0, 4).map((f) =>
            el("li", {}, [el("span", { text: f.item_name + (f.condition ? ` (${f.condition})` : "") + (f.is_dummy ? " · 참고용" : "") }), el("b", { text: C.fmtPrice(f.price) })]))));
        }
        card.append(el("div", { class: "nj-card-actions" }, [
          el("button", { type: "button", class: "nj-btn is-primary", html: ICON.pin + "<span>지도에서 보기</span>", disabled: !canMap, title: canMap ? null : "정확한 위치가 공개되지 않은 곳이에요", onclick: () => showOnMap(c) }),
          tel ? el("a", { class: "nj-btn", href: tel, html: ICON.phone + "<span>전화</span>" }) : null,
        ]));
        wrap.append(card);
      }
      return wrap;
    }

    function showOnMap(card) {
      // 모바일(전체 화면 채팅)에서는 지도를 볼 수 있게 채팅을 닫고,
      // PC 에서는 채팅창이 가리는 만큼 지도 표시 위치를 비켜 줌
      const mobile = window.matchMedia("(max-width: 760px)").matches;
      if (isPage) return map.focus(card, { rightInset: 0 });
      if (mobile) close();
      map.focus(card, { rightInset: mobile ? 0 : panel.offsetWidth + 20 });
    }

    function locationAsk() {
      const box = el("div", { class: "nj-loc" }, [el("div", { text: "주변 병원을 찾으려면 위치가 필요해요." })]);
      const btnMe = el("button", {
        type: "button", class: "nj-btn is-primary", text: "내 위치 사용",
        onclick: async () => {
          btnMe.disabled = true;
          const loc = await requestMyLocation();
          if (!loc) { btnMe.disabled = false; btnMe.textContent = "위치 권한을 확인해 주세요"; return; }
          state.myLocation = loc;
          resendLastUser();
        },
      });
      const actions = el("div", { class: "nj-loc-actions" }, [btnMe]);
      if (map?.getCenter?.()) actions.append(el("button", { type: "button", class: "nj-btn", text: "지도 중심 기준", onclick: resendLastUser }));
      box.append(actions);
      return box;
    }

    // 위치를 정한 뒤 마지막 질문을 다시 보냄 (대화에 같은 질문을 또 쌓지 않음)
    function resendLastUser() {
      let idx = -1;
      state.messages.forEach((m, i) => { if (m.role === "user") idx = i; });
      if (idx < 0 || state.busy) return;
      updateLocNote();
      renderAll();
      request(C.buildRequest({ message: state.messages[idx].text, messages: state.messages.slice(0, idx), location: currentLocation() }));
    }

    function typing() {
      return el("div", { class: "nj-msg is-ai", "aria-label": "답변 작성 중" }, [
        logo(""),
        el("div", { class: "nj-bubble nj-typing" }, [el("i"), el("i"), el("i")]),
      ]);
    }

    function errorBox(text) {
      return el("div", { class: "nj-error", role: "alert" }, [
        el("span", { text }),
        state.lastRequest ? el("button", { type: "button", class: "nj-btn", text: "다시 시도", onclick: () => { renderAll(); request(state.lastRequest); } }) : null,
      ]);
    }

    // ---------- 모바일 키보드 대응: 보이는 영역 높이에 맞춤 ----------
    function syncViewport() {
      const vv = window.visualViewport;
      if (!vv) return;
      root.style.setProperty("--nj-vh", vv.height + "px");
      panel.style.top = window.matchMedia("(max-width: 760px)").matches ? vv.offsetTop + "px" : "";
      if (state.open) body.scrollTop = body.scrollHeight;
    }
    window.visualViewport?.addEventListener("resize", syncViewport);
    window.visualViewport?.addEventListener("scroll", syncViewport);

    renderAll();
    updateLocNote();
    if (isPage) open();
    return { open, close, reset, send };
  }

  window.NyangChatbot = { mount };
})();

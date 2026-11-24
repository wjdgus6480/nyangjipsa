// AI 건강 상담 (핵심 기능): 메신저형 채팅 UI
import { CONFIG, mapFocusUrl } from "../config.js";
import { askChat } from "../api/chatApi.js";
import { esc } from "./ui.js";

const SUGGESTIONS = [
  "고양이가 토를 너무 자주 해요.",
  "예방접종은 언제 해야 하나요?",
  "고양이가 밥을 잘 먹지 않아요.",
  "처음 고양이를 키울 때 필요한 검사는 무엇인가요?",
  "고양이가 평소보다 너무 조용해요.",
];
const IMPORTANCE = { high: "중요", medium: "참고", low: "알아두기" };
const PLACE_LABEL = { pharmacy: "동물약국", grooming: "미용", cremation: "장묘", boarding: "위탁" };

const state = { history: [], location: null, busy: false, lastUser: null };

export function renderChat(el) {
  el.innerHTML = `
    <div class="container">
      <div class="section__head reveal">
        <span class="eyebrow">AI 건강 상담</span>
        <h2>우리 아이가 아픈 것 같다면?<br>AI에게 먼저 물어보세요.</h2>
        <p>작은 행동 변화부터 갑작스러운 이상 증상까지, 궁금한 점을 편하게 질문해 보세요.</p>
      </div>
      <div class="chat reveal">
        <div class="chat__suggest" aria-label="추천 질문">
          ${SUGGESTIONS.map((q) => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join("")}
        </div>
        <div class="chat__window">
          <div class="chat__top">
            <img src="${CONFIG.logo}" alt="" class="avatar">
            <div><strong>AI 간호사</strong><small>수의사 진단을 대신하지 않는 참고용 상담이에요</small></div>
            <button class="chat__loc" data-loc title="근처 병원 안내에 사용">📍 위치 사용</button>
            <a class="chat__loc" href="${CONFIG.chatPage}" target="_blank" rel="noopener" title="챗봇만 크게 보기">크게 보기 ↗</a>
          </div>
          <div class="chat__log" id="chat-log" aria-live="polite"></div>
          <form class="chat__form">
            <label for="chat-input" class="sr-only">질문 입력</label>
            <input id="chat-input" maxlength="500" autocomplete="off" placeholder="예) 고양이가 하루 종일 밥을 안 먹어요">
            <button class="btn btn--primary" aria-label="전송">전송</button>
          </form>
        </div>
        <p class="chat__emergency">🚨 호흡곤란, 의식 저하, 심한 출혈, 소변을 보지 못하는 등 <b>응급 징후</b>가 보이면 상담보다 먼저 <b>즉시 동물병원</b>에 방문하세요.</p>
      </div>
    </div>`;

  addBot(`안녕하세요! 저는 우리 고양이의 건강을 함께 관리하는 AI 간호사예요. 🐱<br>어떤 점이 궁금하신가요?`);

  el.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => send(b.dataset.q)));
  el.querySelector(".chat__form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = el.querySelector("#chat-input");
    const text = input.value.trim();
    if (text) { input.value = ""; send(text); }
  });
  el.querySelector("[data-loc]").addEventListener("click", (e) => requestLocation(e.currentTarget));
}

const log = () => document.getElementById("chat-log");

function addMsg(who, html) {
  const row = document.createElement("div");
  row.className = `msg msg--${who}`;
  row.innerHTML = who === "bot"
    ? `<img src="${CONFIG.logo}" alt="" class="avatar avatar--sm"><div class="bubble">${html}</div>`
    : `<div class="bubble">${html}</div>`;
  log().appendChild(row);
  log().scrollTop = log().scrollHeight;
  return row.querySelector(".bubble");
}
const addBot = (html) => addMsg("bot", html);

async function send(text, keyword) {
  if (state.busy) return;
  state.busy = true;
  state.lastUser = { text, keyword };
  addMsg("user", esc(text));
  const bubble = addBot(`<span class="typing"><i></i><i></i><i></i></span>`);
  try {
    const r = await askChat({ message: text, history: state.history, choiceKeyword: keyword, location: state.location });
    state.history.push({ role: "user", text }, { role: "assistant", text: r.answer });
    bubble.innerHTML = renderReply(r);
    bubble.querySelectorAll("[data-choice]").forEach((b) =>
      b.addEventListener("click", () => { const c = r.choices[+b.dataset.choice]; send(c.label, c.keyword); })
    );
    bubble.querySelector("[data-share-loc]")?.addEventListener("click", async (e) => {
      if (await requestLocation(document.querySelector("[data-loc]"))) {
        e.target.disabled = true;
        state.busy = false;
        send(state.lastUser.text, state.lastUser.keyword);
      }
    });
  } catch (e) {
    bubble.innerHTML = `지금은 AI 상담 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.<br><span class="muted">(${esc(e.message)})</span><br>응급 징후가 있다면 바로 동물병원에 연락해 주세요.`;
  } finally {
    state.busy = false;
    log().scrollTop = log().scrollHeight;
  }
}

function renderReply(r) {
  let html = `<p>${esc(r.answer)}</p>`;
  if (r.keywords?.length) {
    html += `<div class="reply__block"><b>꼭 확인할 키워드</b><ul class="kw">` +
      r.keywords.map((k) => `<li><span class="kw__tag kw__tag--${esc(k.importance)}">${IMPORTANCE[k.importance] || "참고"}</span><strong>${esc(k.keyword)}</strong> ${esc(k.reason)}</li>`).join("") +
      `</ul></div>`;
  }
  if (r.hospitals?.length) {
    html += `<div class="reply__block"><b>가까운 동물병원</b><ul class="list">` +
      r.hospitals.map((h) => {
        const url = mapFocusUrl({ lat: h.lat, lon: h.lon, name: h.name, address: h.address || "", phone: h.phone || "", typeLabel: "동물병원" });
        return `<li>${esc(h.name)} <span class="muted">${h.distance_m}m · ${esc(h.phone || "")}</span> <a class="link link--sm" href="${esc(url)}" target="_blank" rel="noopener">지도에서 보기</a></li>`;
      }).join("") +
      `</ul><a class="link" href="${CONFIG.hospitalPage}">지도에서 주변 병원 모두 보기 →</a></div>`;
  }
  if (r.places?.length) {
    html += `<div class="reply__block"><b>가까운 장소</b><ul class="list">` +
      r.places.map((p) => {
        // 주소 번지가 가려진 업소는 서버가 좌표를 주지 않으므로 지도 링크도 없음
        const link = p.lat != null && p.lon != null
          ? ` <a class="link link--sm" href="${esc(mapFocusUrl({ lat: p.lat, lon: p.lon, name: p.name, address: p.road_address || "", phone: p.phone || "", typeLabel: PLACE_LABEL[p.type] || "" }))}" target="_blank" rel="noopener">지도에서 보기</a>`
          : "";
        return `<li>${PLACE_LABEL[p.type] || ""} · ${esc(p.name)} <span class="muted">${p.distance_m}m</span>${link}</li>`;
      }).join("") +
      `</ul></div>`;
  }
  if (r.needs_location) {
    html += `<div class="reply__block"><button class="btn btn--outline btn--sm" data-share-loc>📍 내 위치 공유하고 근처 병원 보기</button></div>`;
  }
  if (r.question) html += `<p class="reply__q">${esc(r.question)}</p>`;
  if (r.choices?.length) {
    html += `<div class="choices">` +
      r.choices.map((c, i) => `<button class="chip ${c.kind === "explore" ? "chip--explore" : ""}" data-choice="${i}">${esc(c.label)}</button>`).join("") +
      `</div>`;
  }
  html += `<p class="reply__note">${r.fallback ? "AI 연결이 원활하지 않아 기본 안내를 보여드려요. " : ""}${esc(r.disclaimer || "")}</p>`;
  return html;
}

/** 브라우저 위치 권한 요청. 좌표는 서버의 병원 검색에만 쓰이고 AI 에는 전달되지 않습니다. */
function requestLocation(button) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { addBot("이 브라우저는 위치 기능을 지원하지 않아요."); return resolve(false); }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.location = { lat: +pos.coords.latitude.toFixed(6), lon: +pos.coords.longitude.toFixed(6) };
        if (button) { button.textContent = "📍 위치 사용 중"; button.classList.add("on"); }
        resolve(true);
      },
      () => { addBot("위치 권한이 없어 근처 병원을 찾을 수 없어요. 브라우저 설정에서 위치를 허용해 주세요."); resolve(false); },
      { timeout: 8000 }
    );
  });
}

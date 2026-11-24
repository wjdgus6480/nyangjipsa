// 페이지 조립: 각 컴포넌트를 해당 영역에 마운트합니다.
import { renderHeader } from "./components/header.js";
import { renderHero } from "./components/hero.js";
import { renderChat } from "./components/chat.js";
import { renderServices } from "./components/services.js";
import { renderGuides } from "./components/guides.js";
import { renderHospitalCta } from "./components/hospitalCta.js";
import { renderFooter } from "./components/footer.js";
import { setupReveal } from "./components/reveal.js";

renderHeader(document.getElementById("header"));
renderHero(document.getElementById("hero"));
renderChat(document.getElementById("chat"));
renderServices(document.getElementById("services"));
renderGuides(document.getElementById("guide"));
renderHospitalCta(document.getElementById("hospital-cta"));
renderFooter(document.getElementById("footer"));
setupReveal();

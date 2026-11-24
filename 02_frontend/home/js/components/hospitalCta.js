import { CONFIG } from "../config.js";
import { ICONS } from "./icons.js";

export function renderHospitalCta(el) {
  el.innerHTML = `
    <div class="container cta reveal">
      <div class="cta__copy">
        <span class="eyebrow">병원 찾기</span>
        <h2>우리 동네 믿을 수 있는<br>동물병원을 찾아보세요.</h2>
        <p>갑작스러운 건강 이상부터 정기검진까지, 주변 동물병원의 진료 정보와 가격을 비교해 보세요.</p>
        <a class="btn btn--navy btn--lg" href="${CONFIG.hospitalPage}">주변 동물병원 비교하기</a>
        <p class="muted small">공공데이터(행정안전부 인허가, 농림축산식품부 진료비 조사)를 기반으로 제공됩니다.</p>
      </div>
      <div class="cta__art" aria-hidden="true">
        <div class="map-art">
          <span class="map-art__road map-art__road--1"></span>
          <span class="map-art__road map-art__road--2"></span>
          <span class="map-art__pin map-art__pin--a">${ICONS.hospital}</span>
          <span class="map-art__pin map-art__pin--b">${ICONS.pin}</span>
          <span class="map-art__pin map-art__pin--c">${ICONS.hospital}</span>
        </div>
      </div>
    </div>`;
}

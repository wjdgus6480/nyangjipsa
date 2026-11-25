import { Link } from "react-router";
import { ROUTES } from "../../services/config/site";
import { ICONS } from "./icons";

export function HospitalCta() {
  return (
    <section id="hospital-cta" className="section section--sky">
      <div className="container cta reveal">
        <div className="cta__copy">
          <span className="eyebrow">병원 찾기</span>
          <h2>
            우리 동네 믿을 수 있는<br />동물병원을 찾아보세요.
          </h2>
          <p>갑작스러운 건강 이상부터 정기검진까지, 주변 동물병원의 진료 정보와 가격을 비교해 보세요.</p>
          <Link className="btn btn--navy btn--lg" to={ROUTES.map}>주변 동물병원 비교하기</Link>
          <p className="muted small">공공데이터(행정안전부 인허가, 농림축산식품부 진료비 조사)를 기반으로 제공됩니다.</p>
        </div>
        <div className="cta__art" aria-hidden="true">
          <div className="map-art">
            <span className="map-art__road map-art__road--1" />
            <span className="map-art__road map-art__road--2" />
            <span className="map-art__pin map-art__pin--a">{ICONS.hospital}</span>
            <span className="map-art__pin map-art__pin--b">{ICONS.pin}</span>
            <span className="map-art__pin map-art__pin--c">{ICONS.hospital}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

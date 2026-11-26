import type { CSSProperties } from "react";
import { Link } from "react-router";
import { HeroCat } from "./heroCat/HeroCat";
import { ROUTES, SITE } from "../../services/config/site";

export function Hero({ onStartChat }: { onStartChat(): void }) {
  return (
    <section id="hero" className="hero" style={{ "--hero-img": `url(${SITE.heroImage})` } as CSSProperties}>
      <HeroCat />
      <div className="container hero__inner">
        <div className="hero__copy reveal">
          <span className="pill">초보 집사를 위한 AI 반려묘 헬스케어</span>
          <h1>
            처음 만난 우리 고양이,<br /><span className="accent">건강한 하루</span>를 함께해요.
          </h1>
          <p className="lead">
            고양이의 작은 이상 증상부터 예방접종, 건강검진까지.<br />AI가 초보 집사의 든든한 건강관리 파트너가 되어드립니다.
          </p>
          <div className="hero__cta">
            <button className="btn btn--navy btn--lg" onClick={onStartChat}>AI 건강 상담 시작하기</button>
            <Link className="btn btn--white btn--lg" to={ROUTES.map}>우리 동네 동물병원 찾기</Link>
          </div>
          <ul className="hero__points">
            <li>24시간 AI 상담</li><li>응급 징후 안내</li><li>공공데이터 기반 병원 정보</li><li>진료비 확인</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

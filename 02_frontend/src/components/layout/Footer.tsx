// 사이트 푸터 (기존 home/js/components/footer.js)
import type { ReactNode } from "react";
import { SITE } from "../../services/config/site";
import { useModal } from "../ui/Modal";

const DOCS: [key: string, title: string, body: ReactNode][] = [
  ["about", "서비스 소개", <p>{SITE.brandName}은 처음 고양이를 키우는 보호자를 위한 AI 반려묘 건강관리 서비스입니다. AI 건강 상담, 예방접종·건강검진 가이드, 공공데이터 기반 주변 동물병원 정보를 제공합니다.</p>],
  ["terms", "이용약관", <p className="notice">이용약관은 서비스 정식 오픈 전에 게시될 예정입니다.</p>],
  [
    "privacy",
    "개인정보 처리방침",
    <>
      <p className="notice">개인정보 처리방침은 서비스 정식 오픈 전에 게시될 예정입니다.</p>
      <p>AI 상담 시 입력한 위치 좌표는 주변 병원 검색에만 사용되며 AI에는 전달되지 않습니다.</p>
    </>,
  ],
  ["contact", "고객 문의", <p className="notice">고객 문의 창구는 준비 중입니다.</p>],
];

export function Footer() {
  const modal = useModal();
  return (
    <div id="footer">
      <footer className="footer">
        <div className="container footer__inner">
          <div className="footer__brand">
            <img src={SITE.logo} alt="" className="brand__logo" />
            <div>
              <strong>{SITE.brandName}</strong>
              <p>{SITE.brandTagline}</p>
            </div>
          </div>
          <nav className="footer__links" aria-label="하단 메뉴">
            {DOCS.map(([k, t, body]) => (
              <a
                key={k}
                href="#"
                data-doc={k}
                onClick={(e) => {
                  e.preventDefault();
                  modal.open(t, body);
                }}
              >
                {t}
              </a>
            ))}
          </nav>
        </div>
        <div className="container footer__legal">
          <p>⚠️ AI 건강 상담은 일반적인 정보 제공을 목적으로 하며, 수의사의 전문적인 진료 및 진단을 대체하지 않습니다. 응급 상황에서는 즉시 가까운 동물병원에 방문하세요.</p>
          <p>병원 정보: 행정안전부 동물병원 인허가 데이터 · 진료비 통계: 농림축산식품부 동물병원 진료비 조사·공개 시스템(2025년 조사)</p>
          <p>© {new Date().getFullYear()} {SITE.brandName}</p>
        </div>
      </footer>
    </div>
  );
}

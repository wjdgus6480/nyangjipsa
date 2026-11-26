// 병원 관리·설정 — 추후 확장. 가짜 숫자 없이 "무엇이 들어올지" 만 안내합니다. (성장 분석은 GrowthPage.tsx)
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ROUTES } from "../../services/config/site";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";

function Placeholder({ title, desc, plans, note }: { title: string; desc: string; plans: string[]; note?: ReactNode }) {
  useDocumentTitle(`냥집사 ADMIN — ${title}`);
  return (
    <div className="adm-page">
      <header className="adm-head">
        <div>
          <h1>
            {title} <span className="adm-badge is-soon">준비 중</span>
          </h1>
          <p className="adm-head__sub">{desc}</p>
        </div>
      </header>
      <section className="adm-card adm-soon">
        <h2>들어올 기능</h2>
        <ul>
          {plans.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        {note && <p className="adm-foot">{note}</p>}
      </section>
    </div>
  );
}

export function HospitalsAdminPage() {
  return (
    <Placeholder
      title="병원 관리"
      desc="동물병원 데이터 운영 및 관리"
      plans={["병원 정보 조회 및 관리", "등록·수정·삭제", "지역별 병원 분포"]}
      note="병원·진료비 데이터는 팀 확인 없이 바꾸지 않습니다. 수정 기능은 기록(누가·언제)과 함께 추가할 예정이에요."
    />
  );
}

export function SettingsAdminPage() {
  return (
    <Placeholder
      title="설정 및 관리"
      desc="관리자와 시스템 설정"
      plans={["관리자 권한 (관리자 지정은 서버의 create_admin 명령으로만)", "분석 도구 및 데이터 연동 상태"]}
      note={
        <>
          데이터 연결 상태는 <Link to={ROUTES.admin}>대시보드</Link> 맨 아래에서 볼 수 있어요.
        </>
      }
    />
  );
}

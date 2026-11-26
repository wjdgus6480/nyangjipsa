// 회원 화면 공통 UI. 기존 디자인 토큰·버튼(.btn)·모달을 그대로 씁니다.
import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import "../../styles/auth.css";
import { SiteLayout } from "../../components/layout/SiteLayout";
import { useModal } from "../../components/ui/Modal";
import { socialLoginUrl } from "../../services/api/auth";
import type { SocialProvider } from "../../types/api";
import type { Notice } from "./authForm";

/** 사이트 공통 틀 안의 가운데 카드 */
export function AuthLayout({ title, lead, children, wide }: { title: string; lead?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <SiteLayout>
      <section className="section auth-page">
        <div className="container">
          <div className={"auth-card" + (wide ? " auth-card--wide" : "")}>
            <h1 className="auth-card__title">{title}</h1>
            {lead && <p className="auth-card__lead">{lead}</p>}
            {children}
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
  hint?: ReactNode;
  optional?: boolean;
}

function describedBy(fid: string, hint: ReactNode, error: string | null | undefined) {
  const v = [hint ? `${fid}-hint` : null, error ? `${fid}-err` : null].filter(Boolean).join(" ");
  return v || undefined;
}

export function Field({ label, error, hint, optional, id, ...input }: FieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className="field">
      <label htmlFor={fid}>
        {label}
        {optional && <span className="field__opt"> (선택)</span>}
      </label>
      <input id={fid} aria-invalid={error ? true : undefined} aria-describedby={describedBy(fid, hint, error)} {...input} />
      {hint && <p id={`${fid}-hint`} className="field__hint">{hint}</p>}
      {error && <p id={`${fid}-err`} className="field__error">{error}</p>}
    </div>
  );
}

/** 비밀번호 입력 + 보기/숨기기 */
export function PasswordField({ label, error, hint, id, ...input }: Omit<FieldProps, "type" | "optional">) {
  const auto = useId();
  const fid = id ?? auto;
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      <div className="field__pw">
        <input
          id={fid}
          type={show ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(fid, hint, error)}
          {...input}
        />
        <button
          type="button"
          className="field__toggle"
          aria-label={show ? `${label} 숨기기` : `${label} 보기`}
          aria-pressed={show}
          aria-controls={fid}
          onClick={() => setShow((v) => !v)}
        >
          {show ? "숨기기" : "보기"}
        </button>
      </div>
      {hint && <p id={`${fid}-hint`} className="field__hint">{hint}</p>}
      {error && <p id={`${fid}-err`} className="field__error">{error}</p>}
    </div>
  );
}

/** 폼 전체 안내 (서버 오류·성공). 오류는 스크린리더가 바로 읽도록 role=alert */
export function FormNotice({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <div className={`form-notice form-notice--${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
      {notice.text}
    </div>
  );
}

export function SubmitButton({ busy, busyText, children }: { busy: boolean; busyText: string; children: ReactNode }) {
  return (
    <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy} aria-busy={busy}>
      {busy ? busyText : children}
    </button>
  );
}

const KakaoIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path fill="currentColor" d="M12 3.5C6.75 3.5 2.5 6.84 2.5 10.96c0 2.66 1.77 4.99 4.43 6.3l-.9 3.3c-.08.29.25.52.5.35l3.94-2.6c.5.06 1 .1 1.53.1 5.25 0 9.5-3.34 9.5-7.45S17.25 3.5 12 3.5z" />
  </svg>
);

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path fill="#4285F4" d="M22.6 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.07 5.07 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.32-4.74 3.32-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.05-3.72 1.05-2.86 0-5.29-1.93-6.15-4.53H2.17v2.84A11 11 0 0 0 12 23z" />
    <path fill="#FBBC05" d="M5.85 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.17a11 11 0 0 0 0 9.88l3.68-2.84z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.6 10.6 0 0 0 12 1 11 11 0 0 0 2.17 7.06l3.68 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
  </svg>
);

/** 카카오·구글 시작 버튼 (브라우저 이동. 토큰·비밀키는 서버에서만 처리) */
export function SocialButtons({ verb = "시작하기" }: { verb?: string }) {
  const items: [SocialProvider, string, () => ReactNode][] = [
    ["kakao", `카카오로 ${verb}`, KakaoIcon],
    ["google", `구글로 ${verb}`, GoogleIcon],
  ];
  return (
    <div className="social">
      {items.map(([p, label, Icon]) => (
        <a key={p} className={`btn btn--block social__btn social__btn--${p}`} href={socialLoginUrl(p)}>
          <Icon />
          <span>{label}</span>
        </a>
      ))}
    </div>
  );
}

export function Divider({ children = "또는" }: { children?: ReactNode }) {
  return (
    <div className="auth-divider" role="separator">
      <span>{children}</span>
    </div>
  );
}

/** 약관 요약 (정식 문서는 서비스 오픈 전 게시 — 법무 검토 필요) */
function TermsSummary() {
  return (
    <>
      <p className="notice">정식 이용약관은 서비스 정식 오픈 전에 게시될 예정입니다. 아래는 주요 내용 요약입니다.</p>
      <ul>
        <li>냥집사는 AI 반려묘 건강 상담, 건강관리 가이드, 주변 동물병원 정보를 제공합니다.</li>
        <li>AI 상담은 일반 정보이며 수의사의 진료·진단을 대신하지 않습니다.</li>
        <li>진료비 정보는 참고용이며 실제 가격과 다를 수 있습니다.</li>
        <li>타인의 정보를 도용하거나 서비스를 방해하면 이용이 제한될 수 있습니다.</li>
      </ul>
    </>
  );
}

function PrivacySummary() {
  return (
    <>
      <p className="notice">정식 개인정보 처리방침은 서비스 정식 오픈 전에 게시될 예정입니다. 아래는 주요 내용 요약입니다.</p>
      <ul>
        <li>수집 항목: 이메일, 닉네임(선택), 비밀번호(복원할 수 없게 암호화 저장), 소셜 로그인 식별자, 로그인 기록, 반려묘 정보(선택: 이름·체중·성별·나이·건강 상태·건강관리 기록)</li>
        <li>이용 목적: 회원 식별, 로그인 유지, 본인 확인 메일 발송, 반려묘 건강관리 안내, 서비스 이용 통계(개인을 알아볼 수 없는 형태)</li>
        <li>보유 기간: 회원 탈퇴 시 이메일·닉네임·비밀번호·반려묘 정보 등 개인정보를 지체 없이 삭제합니다.</li>
        <li>AI 상담 시 입력한 위치 좌표는 주변 병원 검색에만 사용되며 AI에는 전달되지 않습니다.</li>
      </ul>
    </>
  );
}

export interface Consents {
  terms: boolean;
  privacy: boolean;
}

/** 전체 동의 + 이용약관 + 개인정보 처리방침 (각 "보기"는 모달) */
export function ConsentChecks({ value, onChange, error }: { value: Consents; onChange(v: Consents): void; error?: string | null }) {
  const modal = useModal();
  const errId = useId();
  const all = value.terms && value.privacy;
  return (
    <fieldset className="consents" aria-describedby={error ? errId : undefined}>
      <legend className="sr-only">약관 동의</legend>
      <label className="check check--all">
        <input type="checkbox" checked={all} onChange={(e) => onChange({ terms: e.target.checked, privacy: e.target.checked })} />
        <span>전체 동의</span>
      </label>
      <div className="consents__row">
        <label className="check">
          <input type="checkbox" checked={value.terms} onChange={(e) => onChange({ ...value, terms: e.target.checked })} />
          <span>[필수] 이용약관 동의</span>
        </label>
        <button type="button" className="link-btn" onClick={() => modal.open("이용약관", <TermsSummary />)}>
          보기
        </button>
      </div>
      <div className="consents__row">
        <label className="check">
          <input type="checkbox" checked={value.privacy} onChange={(e) => onChange({ ...value, privacy: e.target.checked })} />
          <span>[필수] 개인정보 수집·이용 동의</span>
        </label>
        <button type="button" className="link-btn" onClick={() => modal.open("개인정보 처리방침", <PrivacySummary />)}>
          보기
        </button>
      </div>
      {error && <p id={errId} className="field__error">{error}</p>}
    </fieldset>
  );
}

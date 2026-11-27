// 관리자 — 회원 관리: 가입자 목록(검색·상태별), 로그인 수단·고양이·문의 수, 이용 정지·해제
// 이메일은 서버가 가려서 보냄 (ab***@gmail.com). 관리자 권한 지정은 지금처럼 서버 명령(create_admin)으로만.
import { useEffect, useState, type FormEvent } from "react";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { getAdminMembers, updateAdminMember } from "../../services/api/admin";
import { isAbortError } from "../../services/api/client";
import type { AdminMember, AdminMemberList, MemberStatus } from "../../types/api";
import { useAuth } from "../auth/authContext";
import { Card, Segmented } from "./adminUi";

const STATUS_FILTERS: { value: "" | MemberStatus; label: string }[] = [
  { value: "", label: "전체" },
  { value: "active", label: "정상" },
  { value: "pending", label: "가입 대기" },
  { value: "suspended", label: "정지" },
  { value: "withdrawn", label: "탈퇴" },
];
const STATUS_LABEL: Record<MemberStatus, string> = { active: "정상", pending: "가입 대기", suspended: "정지", withdrawn: "탈퇴" };
const PROVIDER_LABEL: Record<string, string> = { email: "이메일", kakao: "카카오", google: "구글" };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ko-KR") : "-");

export function MembersPage() {
  useDocumentTitle("냥집사 ADMIN — 회원 관리");
  const { user: me } = useAuth();
  const [status, setStatus] = useState<"" | MemberStatus>("");
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<AdminMemberList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    getAdminMembers({ page, status, q }, ac.signal)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (!isAbortError(e)) setError(e instanceof Error ? e.message : "불러오지 못했습니다");
      });
    return () => ac.abort();
  }, [page, status, q, reload]);

  const search = (e: FormEvent) => {
    e.preventDefault();
    setPage(1);
    setQ(input.trim());
  };

  const toggleSuspend = async (m: AdminMember) => {
    const next = m.status === "suspended" ? "active" : "suspended";
    const name = m.nickname ?? m.email ?? "이 회원";
    const ok = window.confirm(next === "suspended" ? `${name} 님을 이용 정지할까요? 바로 로그아웃되고 로그인할 수 없게 돼요.` : `${name} 님의 이용 정지를 풀까요?`);
    if (!ok) return;
    setBusyId(m.id);
    setNotice(null);
    try {
      await updateAdminMember(m.id, next);
      setNotice(next === "suspended" ? `${name} 님을 이용 정지했어요.` : `${name} 님의 이용 정지를 풀었어요.`);
      setReload((n) => n + 1);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "바꾸지 못했어요");
    } finally {
      setBusyId(null);
    }
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div className="adm-page">
      <header className="adm-head">
        <div>
          <h1>회원 관리</h1>
          <p className="adm-head__sub">가입자 목록과 이용 상태 · 이메일은 일부만 보여 드려요</p>
        </div>
        <div className="adm-filters" role="group" aria-label="조회 조건">
          <Segmented
            label="회원 상태"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={STATUS_FILTERS}
          />
        </div>
      </header>

      {error && (
        <div className="adm-alert is-error" role="alert">
          <strong>회원 목록을 불러오지 못했어요.</strong> {error}
          <button type="button" className="adm-btn" onClick={() => setReload((n) => n + 1)}>
            다시 시도
          </button>
        </div>
      )}
      {notice && (
        <div className="adm-alert is-info" role="status">
          {notice}
        </div>
      )}

      <Card
        title="가입자 목록"
        desc={data ? `${data.total.toLocaleString("ko-KR")}명${q ? ` · "${q}" 검색 결과` : ""}` : "불러오는 중…"}
        action={
          <form className="adm-search" role="search" onSubmit={search}>
            <input type="search" value={input} onChange={(e) => setInput(e.target.value)} placeholder="닉네임·이메일 검색" aria-label="닉네임·이메일 검색" maxLength={50} />
            <button type="submit" className="adm-btn">검색</button>
          </form>
        }
      >
        {data && data.items.length === 0 ? (
          <div className="adm-empty adm-empty--short">
            <p>{q || status ? "조건에 맞는 회원이 없어요." : "아직 가입한 회원이 없어요."}</p>
          </div>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">회원</th>
                  <th scope="col">로그인 수단</th>
                  <th scope="col">상태</th>
                  <th scope="col" className="is-num">고양이</th>
                  <th scope="col" className="is-num">문의</th>
                  <th scope="col">가입일</th>
                  <th scope="col">마지막 이용</th>
                  <th scope="col"><span className="sr-only">관리</span></th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).map((m) => {
                  const self = me?.id === m.id;
                  const canToggle = !self && (m.status === "active" || m.status === "suspended");
                  return (
                    <tr key={m.id}>
                      <td>
                        <b className="adm-table__name">
                          {m.nickname ?? (m.status === "withdrawn" ? "(탈퇴한 회원)" : "(닉네임 없음)")}
                          {m.role === "admin" && <span className="adm-badge">관리자</span>}
                        </b>
                        <span className="adm-table__sub">{m.email ?? "-"}</span>
                      </td>
                      <td>{m.providers.length ? m.providers.map((p) => PROVIDER_LABEL[p] ?? p).join(" · ") : "-"}</td>
                      <td>
                        <span className={`adm-pill is-${m.status}`}>{STATUS_LABEL[m.status]}</span>
                      </td>
                      <td className="is-num">{m.cat_count}</td>
                      <td className="is-num">{m.inquiry_count}</td>
                      <td>{day(m.created_at)}</td>
                      <td>{day(m.last_seen_at)}</td>
                      <td className="is-act">
                        {canToggle && (
                          <button type="button" className={"adm-btn adm-btn--sm" + (m.status === "suspended" ? "" : " adm-btn--ghost")} disabled={busyId === m.id} onClick={() => void toggleSuspend(m)}>
                            {m.status === "suspended" ? "정지 해제" : "이용 정지"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && pages > 1 && (
          <nav className="adm-pager" aria-label="쪽 이동">
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              이전
            </button>
            <span>
              {page} / {pages}
            </span>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              다음
            </button>
          </nav>
        )}
      </Card>
    </div>
  );
}

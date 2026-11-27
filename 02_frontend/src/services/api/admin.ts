// 관리자 API. 서버가 매 요청 관리자 권한을 확인합니다 (비로그인 401, 일반 회원 403).
import { request } from "./client";
import type {
  AdminDashboard,
  AdminGrowth,
  AdminInquiryList,
  AdminMemberList,
  AdminSheet,
  DashboardPeriodKey,
  GrowthPeriodKey,
  InquiryCategory,
  InquiryStatus,
} from "../../types/api";

/** GET /api/admin/dashboard — Amplitude 행동 데이터 + DB 운영 숫자 (서버에서 5분 캐시) */
export const getAdminDashboard = (period: DashboardPeriodKey, signal?: AbortSignal) =>
  request<AdminDashboard>("/api/admin/dashboard", { query: { period }, signal });

/** GET /api/admin/growth — 성장 분석 (Amplitude). 직접 설정은 start·end (YYYY-MM-DD, 최대 31일) */
export const getAdminGrowth = (period: GrowthPeriodKey, range: { start: string; end: string } | null, signal?: AbortSignal) =>
  request<AdminGrowth>("/api/admin/growth", { query: period === "custom" && range ? { period, ...range } : { period }, signal });

/** GET /api/admin/content/sheet — 콘텐츠 스튜디오: 시트 탭 하나의 내용 (백엔드 → GAS, 읽기 전용) */
export const getAdminSheet = (name: string, signal?: AbortSignal) =>
  request<AdminSheet>("/api/admin/content/sheet", { query: { name }, signal });

/** GET /api/admin/users — 회원 목록 (이메일은 가려서 옴). q = 닉네임·이메일 일부 */
export const getAdminMembers = (q: { page: number; status?: string; q?: string }, signal?: AbortSignal) =>
  request<AdminMemberList>("/api/admin/users", { query: { page: q.page, page_size: 20, ...(q.status ? { status: q.status } : {}), ...(q.q ? { q: q.q } : {}) }, signal });

/** PATCH /api/admin/users/{id} — 이용 정지·해제 (정지하면 그 회원은 바로 로그아웃) */
export const updateAdminMember = (id: string, status: "active" | "suspended") =>
  request<{ ok: true; status: string }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body: { status } });

/** GET /api/admin/inquiries — 1:1 문의함 (접수 → 처리 중 → 답변 완료 순, 상태별 개수 포함) */
export const getAdminInquiries = (q: { page: number; status?: InquiryStatus | ""; category?: InquiryCategory | "" }, signal?: AbortSignal) =>
  request<AdminInquiryList>("/api/admin/inquiries", { query: { page: q.page, page_size: 20, ...(q.status ? { status: q.status } : {}), ...(q.category ? { category: q.category } : {}) }, signal });

/** PATCH /api/admin/inquiries/{id} — 처리 중으로 바꾸기 또는 답변 저장(답변 완료) */
export const updateAdminInquiry = (id: string, body: { status: "received" | "in_progress" } | { answer: string }) =>
  request<{ ok: true }>(`/api/admin/inquiries/${encodeURIComponent(id)}`, { method: "PATCH", body });

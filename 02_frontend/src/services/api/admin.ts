// 관리자 API. 서버가 매 요청 관리자 권한을 확인합니다 (비로그인 401, 일반 회원 403).
import { request } from "./client";
import type { AdminDashboard, AdminGrowth, DashboardPeriodKey, GrowthPeriodKey } from "../../types/api";

/** GET /api/admin/dashboard — Amplitude 행동 데이터 + DB 운영 숫자 (서버에서 5분 캐시) */
export const getAdminDashboard = (period: DashboardPeriodKey, signal?: AbortSignal) =>
  request<AdminDashboard>("/api/admin/dashboard", { query: { period }, signal });

/** GET /api/admin/growth — 성장 분석 (Amplitude). 직접 설정은 start·end (YYYY-MM-DD, 최대 31일) */
export const getAdminGrowth = (period: GrowthPeriodKey, range: { start: string; end: string } | null, signal?: AbortSignal) =>
  request<AdminGrowth>("/api/admin/growth", { query: period === "custom" && range ? { period, ...range } : { period }, signal });

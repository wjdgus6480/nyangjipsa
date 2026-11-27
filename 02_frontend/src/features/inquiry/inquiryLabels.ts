// 1:1 문의 표시 이름 (QnA 문의 칸·내 정보·관리자 문의함이 함께 씀)
import type { InquiryCategory, InquiryStatus } from "../../types/api";

export const INQUIRY_CATEGORIES: { value: InquiryCategory; label: string }[] = [
  { value: "service", label: "서비스 이용" },
  { value: "hospital_info", label: "병원 정보 수정 요청" },
  { value: "fee", label: "진료비 정보" },
  { value: "account", label: "회원·계정" },
  { value: "etc", label: "기타" },
];

export const CATEGORY_LABEL: Record<InquiryCategory, string> = Object.fromEntries(INQUIRY_CATEGORIES.map((c) => [c.value, c.label])) as Record<InquiryCategory, string>;

export const STATUS_LABEL: Record<InquiryStatus, string> = {
  received: "접수",
  in_progress: "처리 중",
  answered: "답변 완료",
};

export const MAX_TITLE = 100;
export const MAX_BODY = 2000;
export const MAX_ANSWER = 4000;

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("ko-KR");
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });

-- 회원이 "내 1:1 문의"에서 지운 문의
--
-- 회원 화면에서만 숨기고 행은 남긴다 (관리자 문의함에는 계속 보이고 "회원이 삭제함" 표시).
-- 회원 탈퇴 시에는 기존대로 문의도 삭제된다 (routes/users.rs withdraw, ON DELETE CASCADE).
ALTER TABLE inquiries ADD COLUMN user_deleted_at TIMESTAMPTZ;

// 챗봇의 "내 고양이 기준 답변" 상태
// - 로그인한 정상 회원의 고양이 목록을 불러옴 (기본: 첫 번째 고양이)
// - 고른 고양이의 id 만 보내고, 서버가 본인 고양이인지 확인한 뒤 이름을 뺀 건강 정보만 AI 답변에 씀
import { useContext, useEffect, useState } from "react";
import { getMyCats } from "../../services/api/auth";
import type { Cat, ChatRequest } from "../../types/api";
import { AuthContext } from "../auth/authContext";

export interface ChatCat {
  cats: Cat[];
  /** 답변 기준 고양이 id. null 이면 사용 안 함 */
  catId: string | null;
  setCatId(id: string | null): void;
  /** 챗봇 요청에 cat_id 를 붙임 (고른 고양이가 없으면 그대로) */
  withCat(req: ChatRequest): ChatRequest;
}

export function useChatCat(): ChatCat {
  // AuthProvider 밖(단독 테스트 등)에서도 오류 없이 "고양이 없음"으로 동작
  const auth = useContext(AuthContext);
  const userId = auth?.user?.status === "active" ? auth.user.id : null;
  const [loaded, setLoaded] = useState<{ userId: string; cats: Cat[] } | null>(null);
  // undefined = 아직 고르지 않음 → 첫 번째 고양이
  const [picked, setPicked] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!userId) return;
    const ctrl = new AbortController();
    getMyCats(ctrl.signal)
      .then((r) => setLoaded({ userId, cats: Array.isArray(r.cats) ? r.cats : [] }))
      .catch(() => {});
    return () => ctrl.abort();
  }, [userId]);

  const cats = userId && loaded?.userId === userId ? loaded.cats : [];
  const catId = picked === undefined ? (cats[0]?.id ?? null) : picked && cats.some((c) => c.id === picked) ? picked : null;
  return {
    cats,
    catId,
    setCatId: setPicked,
    withCat: (req) => (catId ? { ...req, cat_id: catId } : req),
  };
}

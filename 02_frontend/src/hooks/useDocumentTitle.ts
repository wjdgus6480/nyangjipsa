import { useEffect } from "react";

/** 화면별 문서 제목 (기존 HTML 마다 달랐던 <title>) */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => {
      document.title = prev;
    };
  }, [title]);
}

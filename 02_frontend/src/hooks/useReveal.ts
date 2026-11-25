import { useEffect, type RefObject } from "react";

/** 스크롤 시 자연스럽게 나타나는 애니메이션 (움직임 줄이기 설정은 존중). 기존 reveal.js */
export function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const items = root.current?.querySelectorAll<HTMLElement>(".reveal") ?? [];
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [root]);
}

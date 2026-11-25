// 서비스 카드 아이콘 (인라인 SVG, currentColor 사용) — 기존 home/js/components/icons.js
import type { ReactNode } from "react";
import type { IconName } from "./content";

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const ICONS: Record<IconName, ReactNode> = {
  nurse: (
    svg(<>
      <path d="M4 15a8 8 0 0 1 16 0v5H4z" /><path d="M9 4h6v4H9z" /><path d="M12 5v2M11 6h2" /><circle cx="9.5" cy="14" r=".8" /><circle cx="14.5" cy="14" r=".8" />
    </>)
  ),
  syringe: (
    svg(<>
      <path d="m18 2 4 4" /><path d="m17 7 3-3" /><path d="M19 9 8.7 19.3a2 2 0 0 1-2.8 0l-1.2-1.2a2 2 0 0 1 0-2.8L15 5" /><path d="m9 11 4 4" /><path d="m5 19-3 3" /><path d="m14 4 6 6" />
    </>)
  ),
  book: (
    svg(<>
      <path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z" /><path d="M12 7v6M9 10h6" />
    </>)
  ),
  pin: (
    svg(<>
      <path d="M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12z" /><path d="M12 7v6M9 10h6" />
    </>)
  ),
  hospital: (
    svg(<>
      <path d="M3 21h18" /><path d="M5 21V8l7-4 7 4v13" /><path d="M12 10v5M9.5 12.5h5" /><path d="M10 21v-3h4v3" />
    </>)
  ),
};

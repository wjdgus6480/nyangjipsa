// 챗봇 답변에 참고한 자료 출처 (서버가 DB 에서 찾은 자료만 내려줌)
import type { ChatSource } from "../../types/api";
import { toSources } from "./chatCore";

export function SourceList({ sources, className }: { sources: unknown; className?: string }) {
  const list: ChatSource[] = toSources(sources);
  if (list.length === 0) return null;
  return (
    <div className={className} aria-label="참고한 자료">
      <span>참고 자료: </span>
      {list.map((s, i) => (
        <span key={s.name}>
          {i > 0 && " / "}
          {s.kind} ·{" "}
          {s.url ? (
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              {s.name}
            </a>
          ) : (
            s.name
          )}
          {s.license && ` (${s.license}, 요약·번역)`}
        </span>
      ))}
    </div>
  );
}

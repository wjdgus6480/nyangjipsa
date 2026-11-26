// 챗봇의 "내 고양이 기준 답변" 선택 칸 (고양이를 등록한 로그인 회원에게만 보임)
import "../../styles/chat-cat.css";
import type { ChatCat } from "./useChatCat";

export function ChatCatPicker({ chatCat }: { chatCat: ChatCat }) {
  if (chatCat.cats.length === 0) return null;
  return (
    <label className="chat-cat">
      <span className="chat-cat__label">내 고양이 기준 답변</span>
      <select className="chat-cat__select" value={chatCat.catId ?? ""} onChange={(e) => chatCat.setCatId(e.target.value || null)}>
        {chatCat.cats.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value="">사용 안 함</option>
      </select>
    </label>
  );
}

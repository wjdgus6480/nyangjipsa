// 공통 모달 (기존 home/js/components/ui.js openModal)
// - 열면 닫기 버튼에 포커스, Esc·배경·× 로 닫힘
// - useModal().open(title, body) → close() 를 돌려줌. body 는 React 요소라 이스케이프가 자동
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

interface ModalState {
  title: string;
  body: ReactNode;
}

interface ModalApi {
  open(title: string, body: ReactNode): () => void;
  close(): void;
}

const ModalContext = createContext<ModalApi | null>(null);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<ModalState | null>(null);
  const close = useCallback(() => setModal(null), []);
  const open = useCallback(
    (title: string, body: ReactNode) => {
      setModal({ title, body });
      return close;
    },
    [close],
  );
  const api = useMemo(() => ({ open, close }), [open, close]);
  return (
    <ModalContext.Provider value={api}>
      {children}
      <div id="modal-root">{modal && <ModalView title={modal.title} onClose={close}>{modal.body}</ModalView>}</div>
    </ModalContext.Provider>
  );
}

function ModalView({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel">
        <button ref={closeRef} className="modal__close" aria-label="닫기" onClick={onClose}>×</button>
        <h3 id="modal-title">{title}</h3>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

export function useModal(): ModalApi {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal 은 ModalProvider 안에서만 쓸 수 있습니다.");
  return ctx;
}

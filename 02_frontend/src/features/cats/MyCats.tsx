// 내 정보(/me)의 "우리 고양이": 저장된 건강 프로필 보기·추가·수정·삭제
// 고양이 정보가 없는 기존 회원도 그대로 이용 (등록 버튼만 보임)
import { useEffect, useState, type FormEvent } from "react";
import { createCat, deleteCat, getMyCats, updateCat } from "../../services/api/auth";
import { isAbortError } from "../../services/api/client";
import type { Cat } from "../../types/api";
import { errorMessage, type Notice } from "../auth/authForm";
import { FormNotice } from "../auth/AuthUi";
import { CatProfileFields } from "./CatProfileFields";
import {
  ageText,
  ALLERGY_OPTIONS,
  catFormToInput,
  catToForm,
  CHECKUP_OPTIONS,
  CONDITION_OPTIONS,
  emptyCatForm,
  hasCatErrors,
  labelOf,
  labelsOf,
  MEDICATION_OPTIONS,
  NEUTERED_OPTIONS,
  PARASITE_OPTIONS,
  SEX_OPTIONS,
  VACCINATION_OPTIONS,
  validateCatForm,
  type CatForm,
  type CatFormErrors,
} from "./catProfile";

export const MAX_CATS = 10;

function conditionsText(c: Cat): string | null {
  const base = labelsOf(CONDITION_OPTIONS, c.conditions);
  if (!base) return null;
  return c.condition_other ? base.replace("기타", `기타(${c.condition_other})`) : base;
}

function CatSummary({ cat }: { cat: Cat }) {
  const rows: [string, string | null][] = [
    ["체중", cat.weight_kg == null ? null : `${cat.weight_kg}kg`],
    ["성별", labelOf(SEX_OPTIONS, cat.sex)],
    ["중성화", labelOf(NEUTERED_OPTIONS, cat.neutered)],
    ["나이", ageText(cat)],
    ["건강 상태", conditionsText(cat)],
    ["알레르기", labelOf(ALLERGY_OPTIONS, cat.allergy)],
    ["약 복용", labelOf(MEDICATION_OPTIONS, cat.medication)],
    ["예방접종", labelOf(VACCINATION_OPTIONS, cat.vaccination)],
    ["기생충 예방", labelsOf(PARASITE_OPTIONS, cat.parasite_prevention)],
    ["건강검진", labelOf(CHECKUP_OPTIONS, cat.checkup)],
  ];
  return (
    <dl className="profile">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd className={v ? undefined : "is-empty"}>{v ?? "미입력"}</dd>
        </div>
      ))}
    </dl>
  );
}

function CatEditor({ cat, onSaved, onCancel, onDeleted }: { cat?: Cat; onSaved(c: Cat): void; onCancel(): void; onDeleted?(id: string): void }) {
  const [form, setForm] = useState<CatForm>(() => (cat ? catToForm(cat) : emptyCatForm()));
  const [errors, setErrors] = useState<CatFormErrors>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const errs = validateCatForm(form);
    setErrors(errs);
    setNotice(null);
    if (hasCatErrors(errs)) return;
    setBusy(true);
    try {
      const res = cat ? await updateCat(cat.id, catFormToInput(form)) : await createCat(catFormToInput(form));
      onSaved(res.cat);
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!cat || busy) return;
    if (!window.confirm(`${cat.name}의 정보를 삭제할까요? 삭제하면 되돌릴 수 없어요.`)) return;
    setBusy(true);
    try {
      await deleteCat(cat.id);
      onDeleted?.(cat.id);
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
      setBusy(false);
    }
  };

  return (
    <form className="auth-form cat-editor" onSubmit={save} noValidate aria-label={cat ? `${cat.name} 정보 수정` : "고양이 추가"}>
      <FormNotice notice={notice} />
      <CatProfileFields value={form} onChange={setForm} errors={errors} />
      <div className="auth-actions">
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
          {busy ? "저장 중…" : "저장"}
        </button>
        <button type="button" className="btn btn--outline" onClick={onCancel} disabled={busy}>
          취소
        </button>
        {cat && (
          <button type="button" className="btn btn--ghost" onClick={remove} disabled={busy}>
            삭제
          </button>
        )}
      </div>
    </form>
  );
}

export function MyCats() {
  const [cats, setCats] = useState<Cat[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // 수정 중인 고양이 id, 새로 추가 중이면 "new"
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    getMyCats(ctrl.signal)
      .then((r) => {
        setCats(Array.isArray(r.cats) ? r.cats : []);
        setLoadError(null);
      })
      .catch((e: unknown) => {
        if (!isAbortError(e)) setLoadError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [reload]);

  if (loadError) {
    return (
      <div className="form-notice form-notice--error" role="alert">
        고양이 정보를 불러오지 못했어요. {loadError}{" "}
        <button type="button" className="link-btn" onClick={() => setReload((n) => n + 1)}>
          다시 시도
        </button>
      </div>
    );
  }
  if (!cats) return <p role="status" className="muted">고양이 정보를 불러오는 중…</p>;

  const saved = (c: Cat, isNew: boolean) => {
    setCats((list) => (isNew ? [...(list ?? []), c] : (list ?? []).map((x) => (x.id === c.id ? c : x))));
    setEditing(null);
    setNotice({ kind: "success", text: `${c.name}의 정보를 저장했어요.` });
  };

  return (
    <div className="cat-list">
      <FormNotice notice={notice} />
      {cats.length === 0 && editing !== "new" && <p className="muted">등록된 고양이가 없어요. 건강 상담에 쓸 정보를 등록해 보세요.</p>}
      {cats.map((c) =>
        editing === c.id ? (
          <CatEditor
            key={c.id}
            cat={c}
            onSaved={(x) => saved(x, false)}
            onCancel={() => setEditing(null)}
            onDeleted={(id) => {
              setCats((list) => (list ?? []).filter((x) => x.id !== id));
              setEditing(null);
              setNotice({ kind: "success", text: `${c.name}의 정보를 삭제했어요.` });
            }}
          />
        ) : (
          <article key={c.id} className="cat-item" aria-label={c.name}>
            <div className="cat-item__head">
              <h3 className="cat-item__name">{c.name}</h3>
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => {
                  setNotice(null);
                  setEditing(c.id);
                }}
                disabled={editing !== null}
              >
                수정
              </button>
            </div>
            <CatSummary cat={c} />
          </article>
        ),
      )}
      {editing === "new" ? (
        <CatEditor onSaved={(x) => saved(x, true)} onCancel={() => setEditing(null)} />
      ) : (
        cats.length < MAX_CATS && (
          <div className="auth-actions">
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => {
                setNotice(null);
                setEditing("new");
              }}
              disabled={editing !== null}
            >
              {cats.length === 0 ? "고양이 등록" : "고양이 추가"}
            </button>
          </div>
        )
      )}
    </div>
  );
}

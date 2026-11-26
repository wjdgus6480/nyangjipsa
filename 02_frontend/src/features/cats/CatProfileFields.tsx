// 반려묘 건강 프로필 입력 칸 (회원가입·소셜 가입 마무리·내 정보에서 같이 씀)
// 선택 버튼은 한 번 더 누르면 해제되어 "미입력"으로 돌아간다 ("모름"과 구분).
import { useId, type ReactNode } from "react";
import "../../styles/cats.css";
import {
  ALLERGY_OPTIONS,
  CAT_NAME_MAX,
  CHECKUP_OPTIONS,
  CONDITION_OPTIONS,
  CONDITION_OTHER_MAX,
  MEDICATION_OPTIONS,
  NEUTERED_OPTIONS,
  PARASITE_OPTIONS,
  SEX_OPTIONS,
  toggleExclusive,
  VACCINATION_OPTIONS,
  type BirthMode,
  type CatForm,
  type CatFormErrors,
  type Option,
} from "./catProfile";

const todayIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function FieldError({ id, error }: { id: string; error?: string | null }) {
  return error ? <p id={id} className="field__error">{error}</p> : null;
}

/** 하나만 고르는 버튼 묶음 (다시 누르면 해제) */
function ChoiceGroup<T extends string>({ label, options, value, onChange }: { label: string; options: Option<T>; value: T | null; onChange(v: T | null): void }) {
  return (
    <fieldset className="cat-choice">
      <legend className="cat-label">{label}</legend>
      <div className="cat-seg">
        {options.map(([v, text]) => (
          <button key={v} type="button" className="cat-seg__btn" aria-pressed={value === v} onClick={() => onChange(value === v ? null : v)}>
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** 여러 개 고르는 체크 칩. '해당 없음'은 다른 항목과 함께 선택되지 않음 */
function ChipChecks<T extends string>({ legend, hint, options, values, onChange, children }: { legend: ReactNode; hint?: ReactNode; options: Option<T>; values: T[]; onChange(v: T[]): void; children?: ReactNode }) {
  return (
    <fieldset className="cat-choice cat-choice--wide">
      <legend className="cat-label">
        {legend}
        {hint}
      </legend>
      <div className="cat-chips">
        {options.map(([v, text]) => (
          <label key={v} className="cat-chip">
            <input type="checkbox" checked={values.includes(v)} onChange={() => onChange(toggleExclusive(values, v, "none" as T))} />
            <span>{text}</span>
          </label>
        ))}
      </div>
      {children}
    </fieldset>
  );
}

/** 가입 화면(이메일·소셜)의 "반려묘 정보 (선택)" 영역 */
export function CatSignupSection(props: Omit<Props, "heading">) {
  return (
    <section className="cat-section" aria-labelledby="cat-signup-title">
      <CatProfileFields
        {...props}
        heading={
          <h2 id="cat-signup-title" className="cat-section__title">
            반려묘 정보 <span className="field__opt">(선택)</span>
          </h2>
        }
      />
    </section>
  );
}

interface Props {
  value: CatForm;
  onChange(next: CatForm): void;
  errors?: CatFormErrors;
  /** 가입 화면에서는 "(선택)" 영역 제목을 보여 줌 */
  heading?: ReactNode;
}

export function CatProfileFields({ value: f, onChange, errors = {}, heading }: Props) {
  const id = useId();
  const set = <K extends keyof CatForm>(key: K, v: CatForm[K]) => onChange({ ...f, [key]: v });
  const setBirthMode = (mode: BirthMode) => {
    if (mode !== f.birthMode) onChange({ ...f, birthMode: mode, birthDate: "", age: "" });
  };
  const otherOn = f.conditions.includes("other");
  const err = (k: keyof CatFormErrors) => (errors[k] ? true : undefined);

  return (
    <div className="cat-profile">
      {heading}
      <div className="cat-grid">
        <div className="field">
          <label htmlFor={`${id}-name`}>고양이 이름</label>
          <input id={`${id}-name`} name="cat-name" autoComplete="off" maxLength={CAT_NAME_MAX} value={f.name} onChange={(e) => set("name", e.target.value)} aria-invalid={err("name")} aria-describedby={errors.name ? `${id}-name-err` : undefined} />
          <FieldError id={`${id}-name-err`} error={errors.name} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-weight`}>체중</label>
          <div className="cat-suffix">
            <input id={`${id}-weight`} name="cat-weight" inputMode="decimal" placeholder="예: 4.2" value={f.weight} onChange={(e) => set("weight", e.target.value)} aria-invalid={err("weight")} aria-describedby={errors.weight ? `${id}-weight-err` : undefined} />
            <span aria-hidden="true">kg</span>
          </div>
          <FieldError id={`${id}-weight-err`} error={errors.weight} />
        </div>
        <ChoiceGroup label="성별" options={SEX_OPTIONS} value={f.sex} onChange={(v) => set("sex", v)} />
        <ChoiceGroup label="중성화 여부" options={NEUTERED_OPTIONS} value={f.neutered} onChange={(v) => set("neutered", v)} />
        <div className="field cat-birth">
          <div className="cat-label-row">
            <label htmlFor={`${id}-birth`} className="cat-label">
              {f.birthMode === "date" ? "출생일" : "나이"}
            </label>
            <div className="cat-toggle" role="group" aria-label="출생일 또는 나이로 입력">
              <button type="button" aria-pressed={f.birthMode === "date"} onClick={() => setBirthMode("date")}>
                출생일
              </button>
              <button type="button" aria-pressed={f.birthMode === "age"} onClick={() => setBirthMode("age")}>
                나이
              </button>
            </div>
          </div>
          {f.birthMode === "date" ? (
            <input id={`${id}-birth`} name="cat-birth-date" type="date" max={todayIso()} min="1990-01-01" value={f.birthDate} onChange={(e) => set("birthDate", e.target.value)} aria-invalid={err("birth")} aria-describedby={errors.birth ? `${id}-birth-err` : undefined} />
          ) : (
            <div className="cat-suffix">
              <input id={`${id}-birth`} name="cat-age" inputMode="numeric" placeholder="예: 3" value={f.age} onChange={(e) => set("age", e.target.value)} aria-invalid={err("birth")} aria-describedby={errors.birth ? `${id}-birth-err` : undefined} />
              <span aria-hidden="true">살</span>
            </div>
          )}
          <FieldError id={`${id}-birth-err`} error={errors.birth} />
        </div>
      </div>

      <h3 className="cat-subtitle">건강 상태</h3>
      <ChipChecks
        legend={<span className="sr-only">건강 상태 (여러 개 선택)</span>}
        options={CONDITION_OPTIONS}
        values={f.conditions}
        onChange={(v) => onChange({ ...f, conditions: v, conditionOther: v.includes("other") ? f.conditionOther : "" })}
      >
        {otherOn && (
          <div className="field cat-other">
            <label htmlFor={`${id}-other`} className="sr-only">
              기타 질환명
            </label>
            <input id={`${id}-other`} name="cat-condition-other" placeholder="기타 질환명 (예: 갑상선 질환)" maxLength={CONDITION_OTHER_MAX} value={f.conditionOther} onChange={(e) => set("conditionOther", e.target.value)} aria-invalid={err("conditionOther")} aria-describedby={errors.conditionOther ? `${id}-other-err` : undefined} />
            <FieldError id={`${id}-other-err`} error={errors.conditionOther} />
          </div>
        )}
      </ChipChecks>

      <h3 className="cat-subtitle">
        건강관리 <small className="cat-subtitle__hint">진료 후 기입해 주셔도 됩니다.</small>
      </h3>
      <div className="cat-grid">
        <ChoiceGroup label="알레르기" options={ALLERGY_OPTIONS} value={f.allergy} onChange={(v) => set("allergy", v)} />
        <ChoiceGroup label="약 복용" options={MEDICATION_OPTIONS} value={f.medication} onChange={(v) => set("medication", v)} />
        <ChoiceGroup label="예방접종" options={VACCINATION_OPTIONS} value={f.vaccination} onChange={(v) => set("vaccination", v)} />
        <ChoiceGroup label="건강검진" options={CHECKUP_OPTIONS} value={f.checkup} onChange={(v) => set("checkup", v)} />
        <ChipChecks
          legend="기생충 예방"
          hint={<span className="cat-label__sub"> (심장사상충 · 내부기생충 · 외부기생충)</span>}
          options={PARASITE_OPTIONS}
          values={f.parasites}
          onChange={(v) => set("parasites", v)}
        />
      </div>
    </div>
  );
}

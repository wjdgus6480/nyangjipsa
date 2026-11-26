// 반려묘 건강 프로필: 화면 입력값 ↔ API 값, 선택 규칙, 검증 (서버 01_backend/src/cats.rs 와 같은 규칙)
// 값의 뜻: null = 미입력, "none" = 해당 없음, "unknown" = 모름. 서로 바꾸지 않는다.
import type { Cat, CatAllergy, CatCondition, CatDoneStatus, CatInput, CatMedication, CatParasite, CatSex } from "../../types/api";

export const CAT_NAME_MAX = 20;
export const CONDITION_OTHER_MAX = 30;
export const WEIGHT_MIN = 0.1;
export const WEIGHT_MAX = 30;
export const AGE_MAX = 30;

export type Option<T extends string> = readonly (readonly [T, string])[];

export const SEX_OPTIONS: Option<CatSex> = [
  ["female", "암컷"],
  ["male", "수컷"],
  ["unknown", "모름"],
];
export const NEUTERED_OPTIONS: Option<CatDoneStatus> = [
  ["done", "완료"],
  ["not_done", "미완료"],
  ["unknown", "모름"],
];
export const CONDITION_OPTIONS: Option<CatCondition> = [
  ["none", "해당 없음"],
  ["kidney", "신장 질환"],
  ["heart", "심장 질환"],
  ["diabetes", "당뇨"],
  ["urinary", "비뇨기 질환"],
  ["digestive", "소화기 질환"],
  ["skin", "피부 질환"],
  ["dental", "구강 질환"],
  ["other", "기타"],
];
export const ALLERGY_OPTIONS: Option<CatAllergy> = [
  ["none", "해당 없음"],
  ["yes", "있음"],
  ["unknown", "모름"],
];
export const MEDICATION_OPTIONS: Option<CatMedication> = [
  ["none", "해당 없음"],
  ["taking", "복용 중"],
  ["unknown", "모름"],
];
export const VACCINATION_OPTIONS: Option<CatDoneStatus> = [
  ["done", "완료"],
  ["not_done", "미완료"],
  ["unknown", "모름"],
];
export const CHECKUP_OPTIONS: Option<CatDoneStatus> = [
  ["done", "완료"],
  ["not_done", "미실시"],
  ["unknown", "모름"],
];
export const PARASITE_OPTIONS: Option<CatParasite> = [
  ["heartworm", "심장사상충"],
  ["internal", "내부기생충"],
  ["external", "외부기생충"],
  ["none", "해당 없음"],
  ["unknown", "모름"],
];

export type BirthMode = "date" | "age";

/** 화면 입력 상태 (숫자 칸은 입력 중인 글자 그대로) */
export interface CatForm {
  name: string;
  weight: string;
  sex: CatSex | null;
  neutered: CatDoneStatus | null;
  birthMode: BirthMode;
  birthDate: string;
  age: string;
  conditions: CatCondition[];
  conditionOther: string;
  allergy: CatAllergy | null;
  medication: CatMedication | null;
  vaccination: CatDoneStatus | null;
  parasites: CatParasite[];
  checkup: CatDoneStatus | null;
}

export type CatFormErrors = Partial<Record<"name" | "weight" | "birth" | "conditionOther", string | null>>;

export const emptyCatForm = (): CatForm => ({
  name: "",
  weight: "",
  sex: null,
  neutered: null,
  birthMode: "date",
  birthDate: "",
  age: "",
  conditions: [],
  conditionOther: "",
  allergy: null,
  medication: null,
  vaccination: null,
  parasites: [],
  checkup: null,
});

/**
 * 복수 선택 토글. '해당 없음'(exclusive)을 고르면 다른 항목을 해제하고,
 * 다른 항목을 고르면 '해당 없음'을 해제한다.
 */
export function toggleExclusive<T extends string>(list: readonly T[], value: T, exclusive: T): T[] {
  if (list.includes(value)) return list.filter((v) => v !== value);
  if (value === exclusive) return [value];
  return [...list.filter((v) => v !== exclusive), value];
}

/** 고양이 영역을 아무것도 입력하지 않았는지 (그러면 가입 요청에 넣지 않음) */
export function isCatFormBlank(f: CatForm): boolean {
  return (
    !f.name.trim() &&
    !f.weight.trim() &&
    !f.sex &&
    !f.neutered &&
    !f.birthDate &&
    !f.age.trim() &&
    f.conditions.length === 0 &&
    !f.conditionOther.trim() &&
    !f.allergy &&
    !f.medication &&
    !f.vaccination &&
    f.parasites.length === 0 &&
    !f.checkup
  );
}

const parseNumber = (raw: string): number | null => {
  const v = raw.trim().replace(",", ".");
  if (!v) return null;
  return /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
};

const todayIso = (now = new Date()) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
};

/** 칸별 오류. 오류가 없으면 모든 값이 null */
export function validateCatForm(f: CatForm, now = new Date()): CatFormErrors {
  const name = f.name.trim();
  const weight = parseNumber(f.weight);
  const age = parseNumber(f.age);
  let birth: string | null = null;
  if (f.birthMode === "date" && f.birthDate && f.birthDate > todayIso(now)) birth = "출생일은 오늘보다 늦을 수 없습니다";
  if (f.birthMode === "age" && age !== null && (!Number.isInteger(age) || age < 0 || age > AGE_MAX)) {
    birth = `나이는 0~${AGE_MAX}살 사이 정수로 입력해 주세요`;
  }
  return {
    name: !name ? "고양이 이름을 입력해 주세요" : [...name].length > CAT_NAME_MAX ? `이름은 ${CAT_NAME_MAX}자 이하로 입력해 주세요` : null,
    weight: weight !== null && !(weight >= WEIGHT_MIN && weight <= WEIGHT_MAX) ? `체중은 ${WEIGHT_MIN}~${WEIGHT_MAX}kg 사이로 입력해 주세요` : null,
    birth,
    conditionOther: [...f.conditionOther.trim()].length > CONDITION_OTHER_MAX ? `${CONDITION_OTHER_MAX}자 이하로 입력해 주세요` : null,
  };
}

export const hasCatErrors = (e: CatFormErrors) => Object.values(e).some(Boolean);

/**
 * 가입 화면용: 비워 두면 보내지 않음(input 없음). 하나라도 입력했으면 검증 후 보낼 값.
 * 고양이 영역은 선택이라 비어 있어도 가입할 수 있다.
 */
export function signupCat(f: CatForm): { errors: CatFormErrors; input?: CatInput } {
  if (isCatFormBlank(f)) return { errors: {} };
  const errors = validateCatForm(f);
  return hasCatErrors(errors) ? { errors } : { errors, input: catFormToInput(f) };
}

/** 서버로 보낼 값. 미입력 칸은 빼서 서버에서 NULL(미입력)로 저장 */
export function catFormToInput(f: CatForm): CatInput {
  const out: CatInput = { name: f.name.trim() };
  const weight = parseNumber(f.weight);
  if (weight !== null && !Number.isNaN(weight)) out.weight_kg = weight;
  if (f.sex) out.sex = f.sex;
  if (f.neutered) out.neutered = f.neutered;
  if (f.birthMode === "date" && f.birthDate) out.birth_date = f.birthDate;
  const age = parseNumber(f.age);
  if (f.birthMode === "age" && age !== null && !Number.isNaN(age)) out.age_years = age;
  if (f.conditions.length) out.conditions = [...f.conditions];
  const other = f.conditionOther.trim();
  if (other && f.conditions.includes("other")) out.condition_other = other;
  if (f.allergy) out.allergy = f.allergy;
  if (f.medication) out.medication = f.medication;
  if (f.vaccination) out.vaccination = f.vaccination;
  if (f.parasites.length) out.parasite_prevention = [...f.parasites];
  if (f.checkup) out.checkup = f.checkup;
  return out;
}

/** 나이(만). 출생일이 없으면 null */
export function ageYears(birthDate: string | null, now = new Date()): number | null {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.split("-").map(Number);
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
  return Math.max(0, age);
}

/** 저장된 고양이 → 수정 화면 입력값 (나이로 입력했던 고양이는 나이 칸으로) */
export function catToForm(c: Cat, now = new Date()): CatForm {
  const estimatedAge = c.birth_date_estimated ? ageYears(c.birth_date, now) : null;
  return {
    name: c.name,
    weight: c.weight_kg == null ? "" : String(c.weight_kg),
    sex: c.sex,
    neutered: c.neutered,
    birthMode: estimatedAge !== null ? "age" : "date",
    birthDate: estimatedAge !== null ? "" : (c.birth_date ?? ""),
    age: estimatedAge !== null ? String(estimatedAge) : "",
    conditions: c.conditions ?? [],
    conditionOther: c.condition_other ?? "",
    allergy: c.allergy,
    medication: c.medication,
    vaccination: c.vaccination,
    parasites: c.parasite_prevention ?? [],
    checkup: c.checkup,
  };
}

export function labelOf<T extends string>(options: Option<T>, value: T | null): string | null {
  if (value == null) return null;
  return options.find(([v]) => v === value)?.[1] ?? null;
}

export function labelsOf<T extends string>(options: Option<T>, values: readonly T[] | null): string | null {
  if (!values || values.length === 0) return null;
  return options
    .filter(([v]) => values.includes(v))
    .map(([, l]) => l)
    .join(", ");
}

/** 내 정보 화면의 나이 표시 */
export function ageText(c: Pick<Cat, "birth_date" | "birth_date_estimated">, now = new Date()): string | null {
  const age = ageYears(c.birth_date, now);
  if (age === null) return null;
  const text = age === 0 ? "1살 미만" : `${age}살`;
  return c.birth_date_estimated ? `약 ${text}` : `${text} (${c.birth_date})`;
}

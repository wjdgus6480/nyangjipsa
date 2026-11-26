// 반려묘 건강 프로필: 가입 화면 입력, '해당 없음' 규칙, 모름·미입력 구분, 기타 질환명, 내 정보 표시·추가
import { StrictMode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { App } from "../src/app/App";
import { catFormToInput, catToForm, emptyCatForm, isCatFormBlank, signupCat, toggleExclusive } from "../src/features/cats/catProfile";
import type { Cat } from "../src/types/api";
import { chatReply, mockFetch } from "./helpers/fetch";

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

const at = (path: string) =>
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <Where />
      </MemoryRouter>
    </StrictMode>,
  );

const where = () => screen.getByTestId("where").textContent;
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
// 드롭다운: 버튼 이름은 "라벨 + 현재 값", 열린 목록은 라벨 이름의 group
const trigger = (label: string, root: HTMLElement = document.body) => within(root).getByRole("button", { name: new RegExp(`^${label} `) });
const panel = (label: string, root: HTMLElement = document.body) => {
  if (!screen.queryByRole("group", { name: label })) fireEvent.click(trigger(label, root));
  return screen.getByRole("group", { name: label });
};
const pick = (label: string, option: string, root?: HTMLElement) => fireEvent.click(within(panel(label, root)).getByRole("radio", { name: option }));
const check = (label: string, option: string) => fireEvent.click(within(panel(label)).getByRole("checkbox", { name: option }));
const isChecked = (label: string, option: string) => (within(panel(label)).getByRole("checkbox", { name: option }) as HTMLInputElement).checked;
const CONDITIONS = "건강 상태";
const PARASITES = "기생충 예방";

const user = (over: Record<string, unknown> = {}) => ({
  id: "6f1c2b9e-1111-4222-8333-944455556666",
  email: "cat@nyang.com",
  nickname: "치즈",
  role: "user",
  status: "active",
  email_verified: true,
  has_password: true,
  providers: ["email"],
  pending_step: null,
  created_at: "2026-11-25T01:00:00Z",
  ...over,
});

const savedCat = (over: Partial<Cat> = {}): Cat => ({
  id: "c0ffee00-1111-4222-8333-944455556666",
  name: "나비",
  weight_kg: 4.2,
  sex: "female",
  neutered: "unknown",
  birth_date: "2023-11-26",
  birth_date_estimated: true,
  conditions: ["urinary", "other"],
  condition_other: "갑상선",
  allergy: "none",
  medication: null,
  vaccination: null,
  parasite_prevention: ["heartworm", "unknown"],
  checkup: null,
  created_at: "2026-11-26T01:00:00Z",
  updated_at: "2026-11-26T01:00:00Z",
  ...over,
});

const fillAccount = () => {
  type("이메일", "new@nyang.com");
  type("비밀번호", "nyang1234");
  type("비밀번호 확인", "nyang1234");
  fireEvent.click(screen.getByLabelText("전체 동의"));
};
const signupButton = () => screen.getByRole("button", { name: "가입하고 인증 메일 받기" });
const registered = () => ({ status: 201, json: { status: "pending_verification", email: "new@nyang.com", email_sent: true } });

afterEach(() => {
  document.cookie = "nj_auth=; Max-Age=0; Path=/";
  vi.restoreAllMocks();
});

describe("선택 규칙 (catProfile)", () => {
  test("'해당 없음'은 다른 항목과 동시에 선택되지 않음", () => {
    expect(toggleExclusive(["kidney", "skin"], "none", "none")).toEqual(["none"]);
    expect(toggleExclusive(["none"], "kidney", "none")).toEqual(["kidney"]);
    expect(toggleExclusive(["kidney"], "kidney", "none")).toEqual([]);
    // 기생충: 모름은 세부 항목과 함께 고를 수 있음
    expect(toggleExclusive(["heartworm"], "unknown", "none")).toEqual(["heartworm", "unknown"]);
  });

  test("미입력은 빼고 보내고, 모름·해당 없음은 그대로 보냄", () => {
    const f = { ...emptyCatForm(), name: " 나비 ", allergy: "unknown" as const, medication: "none" as const };
    expect(catFormToInput(f)).toEqual({ name: "나비", allergy: "unknown", medication: "none" });
    expect(isCatFormBlank(emptyCatForm())).toBe(true);
    expect(signupCat(emptyCatForm())).toEqual({ errors: {} });
  });

  test("나이로 입력한 고양이는 수정할 때 나이 칸으로", () => {
    const f = catToForm(savedCat(), new Date(2026, 10, 26));
    expect(f).toMatchObject({ birthMode: "age", age: "3", birthDate: "", conditionOther: "갑상선" });
    const exact = catToForm(savedCat({ birth_date: "2021-05-01", birth_date_estimated: false }));
    expect(exact).toMatchObject({ birthMode: "date", birthDate: "2021-05-01", age: "" });
  });
});

describe("회원가입 반려묘 정보", () => {
  test("반려묘 정보를 비워 두면 cat 없이 가입 요청", async () => {
    const { calls } = mockFetch(registered);
    at("/signup");
    expect(screen.getByRole("heading", { name: /반려묘 정보/ })).toBeInTheDocument();
    fillAccount();
    fireEvent.click(signupButton());
    await waitFor(() => expect(where()).toBe("/signup/check-email"));
    expect(calls[0].body).not.toHaveProperty("cat");
  });

  test("선택한 내용만 가입과 함께 전송 (해당 없음 규칙, 다시 누르면 미입력)", async () => {
    const { calls } = mockFetch(registered);
    at("/signup");
    fillAccount();
    type("고양이 이름", " 나비 ");
    type("체중", "4.2");
    pick("성별", "암컷");
    pick("중성화 여부", "모름");
    fireEvent.click(screen.getByRole("button", { name: "나이" }));
    type("나이", "3");

    // 건강 상태: 질환 → 해당 없음 → 다른 질환
    check(CONDITIONS, "신장 질환");
    check(CONDITIONS, "해당 없음");
    expect(isChecked(CONDITIONS, "신장 질환")).toBe(false);
    expect(isChecked(CONDITIONS, "해당 없음")).toBe(true);
    check(CONDITIONS, "비뇨기 질환");
    expect(isChecked(CONDITIONS, "해당 없음")).toBe(false);

    // 건강관리 안내 문구
    expect(screen.getByText("진료 후 기입해 주셔도 됩니다.")).toBeInTheDocument();
    pick("알레르기", "모름");
    pick("약 복용", "해당 없음");
    expect(trigger("알레르기")).toHaveAccessibleName("알레르기 모름");
    pick("예방접종", "완료");
    expect(screen.queryByRole("group", { name: "예방접종" })).toBeNull(); // 하나 고르면 목록이 닫힘
    pick("예방접종", "선택 안 함"); // 미입력으로 되돌림 ("모름"과 다름)
    expect(trigger("예방접종")).toHaveAccessibleName("예방접종 선택");

    // 건강관리 5개 항목은 한 줄 (넘치지 않으면 ‹ › 버튼 숨김)
    const row = screen.getByRole("group", { name: "건강관리 항목" });
    expect(within(row).getAllByRole("button", { name: /^(알레르기|약 복용|예방접종|기생충 예방|건강검진) / })).toHaveLength(5);
    expect(row.querySelector('[aria-label="다음 항목 보기"]')).toHaveAttribute("hidden");

    // 기생충: 세부 항목은 복수, 해당 없음은 단독
    check(PARASITES, "심장사상충");
    check(PARASITES, "외부기생충");
    check(PARASITES, "해당 없음");
    expect(isChecked(PARASITES, "심장사상충")).toBe(false);
    check(PARASITES, "심장사상충");
    check(PARASITES, "모름");
    expect(isChecked(PARASITES, "해당 없음")).toBe(false);
    expect(trigger(PARASITES)).toHaveAccessibleName("기생충 예방 2개 선택"); // 좁은 칸은 개수로

    fireEvent.click(signupButton());
    await waitFor(() => expect(where()).toBe("/signup/check-email"));
    expect(calls[0].body).toMatchObject({ email: "new@nyang.com" });
    expect((calls[0].body as { cat: unknown }).cat).toEqual({
      name: "나비",
      weight_kg: 4.2,
      sex: "female",
      neutered: "unknown",
      age_years: 3,
      conditions: ["urinary"],
      allergy: "unknown",
      medication: "none",
      parasite_prevention: ["heartworm", "unknown"],
    });
  });

  test("기타를 고를 때만 질환명 칸이 보이고, 해제하면 지워짐", async () => {
    const { calls } = mockFetch(registered);
    at("/signup");
    expect(screen.queryByLabelText("기타 질환명")).toBeNull();
    check(CONDITIONS, "기타");
    type("기타 질환명", "갑상선");
    check(CONDITIONS, "기타");
    expect(screen.queryByLabelText("기타 질환명")).toBeNull();
    check(CONDITIONS, "기타");
    expect(screen.getByLabelText("기타 질환명")).toHaveValue("");
    type("기타 질환명", " 갑상선 ");
    type("고양이 이름", "나비");
    fillAccount();
    fireEvent.click(signupButton());
    await waitFor(() => expect(calls).toHaveLength(1));
    expect((calls[0].body as { cat: unknown }).cat).toEqual({ name: "나비", conditions: ["other"], condition_other: "갑상선" });
  });

  test("하나라도 입력했으면 이름 필수 (서버에 보내지 않음)", () => {
    const { calls } = mockFetch(registered);
    at("/signup");
    fillAccount();
    pick("성별", "수컷");
    type("체중", "99");
    fireEvent.click(signupButton());
    expect(screen.getByText("고양이 이름을 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByText("체중은 0.1~30kg 사이로 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("반려묘 정보를 확인해 주세요");
    expect(calls).toHaveLength(0);
  });

  test("소셜 가입 마무리도 같은 형식으로 cat 전송", async () => {
    document.cookie = "nj_auth=1; Path=/";
    const pending = user({ status: "pending", pending_step: "profile", has_password: false, providers: ["kakao"], email: "k@kakao.com" });
    const { calls } = mockFetch((url) =>
      url.pathname === "/api/auth/me" ? { json: { user: pending } } : { json: { status: "active", user: user({ providers: ["kakao"] }) } },
    );
    at("/signup/social?provider=kakao");
    await screen.findByRole("heading", { name: "가입을 마무리해 주세요" });
    type("고양이 이름", "치즈");
    pick("건강검진", "미실시");
    fireEvent.click(screen.getByLabelText("전체 동의"));
    fireEvent.click(screen.getByRole("button", { name: "가입 완료" }));
    await waitFor(() => expect(where()).toBe("/"));
    expect(calls.find((c) => c.url === "/api/auth/social/complete")?.body).toMatchObject({
      agree_terms: true,
      cat: { name: "치즈", checkup: "not_done" },
    });
  });
});

describe("내 정보 — 우리 고양이", () => {
  test("저장된 정보 표시: 모름과 미입력을 구분", async () => {
    document.cookie = "nj_auth=1; Path=/";
    mockFetch((url) => (url.pathname === "/api/auth/me" ? { json: { user: user() } } : { json: { cats: [savedCat()] } }));
    at("/me");
    const card = await screen.findByRole("article", { name: "나비" });
    const value = (k: string) => within(card).getByText(k).nextElementSibling?.textContent;
    expect(value("체중")).toBe("4.2kg");
    expect(value("중성화")).toBe("모름");
    expect(value("알레르기")).toBe("해당 없음");
    expect(value("약 복용")).toBe("미입력");
    expect(value("건강 상태")).toBe("비뇨기 질환, 기타(갑상선)");
    expect(value("기생충 예방")).toBe("심장사상충, 모름");
    expect(value("나이")).toMatch(/^약 \d+살$/);
  });

  test("고양이가 없는 기존 회원: 등록 버튼 → 추가 저장", async () => {
    document.cookie = "nj_auth=1; Path=/";
    const { calls } = mockFetch((url, init) => {
      if (url.pathname === "/api/auth/me") return { json: { user: user() } };
      if (init?.method === "POST") return { status: 201, json: { cat: savedCat({ name: "까망", conditions: null, condition_other: null }) } };
      return { json: { cats: [] } };
    });
    at("/me");
    fireEvent.click(await screen.findByRole("button", { name: "고양이 등록" }));
    const form = screen.getByRole("form", { name: "고양이 추가" });
    fireEvent.change(within(form).getByLabelText("고양이 이름"), { target: { value: "까망" } });
    fireEvent.click(within(form).getByRole("button", { name: "저장" }));
    expect(await screen.findByRole("article", { name: "까망" })).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ url: "/api/users/me/cats", body: { name: "까망" } });
    expect(screen.getByText("까망의 정보를 저장했어요.")).toBeInTheDocument();
  });

  test("수정은 전체 교체(PUT), 삭제는 확인 후", async () => {
    document.cookie = "nj_auth=1; Path=/";
    const { calls } = mockFetch((url, init) => {
      if (url.pathname === "/api/auth/me") return { json: { user: user() } };
      if (init?.method === "PUT") return { json: { cat: savedCat({ allergy: "yes" }) } };
      if (init?.method === "DELETE") return { json: { ok: true } };
      return { json: { cats: [savedCat()] } };
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    at("/me");
    fireEvent.click(await screen.findByRole("button", { name: "수정" }));
    const form = screen.getByRole("form", { name: "나비 정보 수정" });
    expect(trigger("알레르기", form)).toHaveAccessibleName("알레르기 해당 없음"); // 저장된 값이 드롭다운에 보임
    pick("알레르기", "있음", form);
    fireEvent.click(within(form).getByRole("button", { name: "저장" }));
    await screen.findByRole("article", { name: "나비" });
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.url).toBe(`/api/users/me/cats/${savedCat().id}`);
    expect(put?.body).toMatchObject({ name: "나비", allergy: "yes", age_years: expect.any(Number), conditions: ["urinary", "other"], condition_other: "갑상선" });

    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "나비" })).toBeNull());
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    expect(screen.getByRole("button", { name: "고양이 등록" })).toBeInTheDocument();
  });
});

describe("챗봇 — 내 고양이 기준 답변", () => {
  const chatHandler = (cats: Cat[]) => (url: URL) => {
    if (url.pathname === "/api/auth/me") return { json: { user: user() } };
    if (url.pathname === "/api/users/me/cats") return { json: { cats } };
    return { json: chatReply() };
  };
  const ask = async (text: string) => {
    const box = await screen.findByPlaceholderText("고양이 병원, 궁금한 걸 물어보세요");
    fireEvent.change(box, { target: { value: text } });
    fireEvent.submit(box.closest("form")!);
  };

  test("로그인 회원은 첫 고양이가 기본 선택되어 cat_id 를 함께 보냄, '사용 안 함'이면 빼고 보냄", async () => {
    document.cookie = "nj_auth=1; Path=/";
    const { calls } = mockFetch(chatHandler([savedCat(), savedCat({ id: "c0ffee00-2222-4222-8333-944455556666", name: "치즈" })]));
    at("/chat");
    const picker = (await screen.findByRole("combobox", { name: "내 고양이 기준 답변" })) as HTMLSelectElement;
    expect(picker.value).toBe(savedCat().id);
    await ask("밥을 안 먹어요");
    await waitFor(() => expect(calls.some((c) => c.url === "/api/chat")).toBe(true));
    expect(calls.find((c) => c.url === "/api/chat")?.body).toMatchObject({ message: "밥을 안 먹어요", cat_id: savedCat().id });

    fireEvent.change(picker, { target: { value: "" } });
    await ask("털이 빠져요");
    await waitFor(() => expect(calls.filter((c) => c.url === "/api/chat")).toHaveLength(2));
    expect(calls.filter((c) => c.url === "/api/chat")[1].body).not.toHaveProperty("cat_id");
  });

  test("로그인하지 않았거나 고양이가 없으면 선택 칸이 없고 cat_id 도 없음", async () => {
    const { calls } = mockFetch(chatHandler([]));
    at("/chat");
    await ask("구토를 해요");
    await waitFor(() => expect(calls.some((c) => c.url === "/api/chat")).toBe(true));
    expect(screen.queryByRole("combobox", { name: "내 고양이 기준 답변" })).toBeNull();
    expect(calls.find((c) => c.url === "/api/chat")?.body).not.toHaveProperty("cat_id");
    expect(calls.some((c) => c.url === "/api/users/me/cats")).toBe(false);
  });
});

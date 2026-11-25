// 기존 주소 호환 리다이렉트, 키 없는 지도 안내, SDK 로더 1회 로드
import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";

// 개발자 PC 의 .env 키와 무관하게 "키 없음" 상태로 검사
vi.mock("../src/services/config/env", () => ({
  API_BASE: "",
  NAVER_MAP_CLIENT_ID: "",
  // 회원 기능(분석)이 읽는 값 — 키 없음 = 이벤트 전송 안 함
  AMPLITUDE_API_KEY: "",
  AMPLITUDE_SERVER_URL: "",
  asset: (p: string) => `/${p}`,
}));
const { App } = await import("../src/app/App");
const { __resetNaverLoader, loadNaverMaps } = await import("../src/features/map/naverLoader");

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Where />
    </MemoryRouter>,
  );

describe("기존 주소 호환", () => {
  test.each([
    ["/home/index.html", "/"],
    ["/home", "/"],
    ["/map-poc/index.html?focus=37.5,127.1&name=A", "/map?focus=37.5,127.1&name=A"],
    ["/map-poc/chat.html", "/chat"],
  ])("%s → %s", (from, to) => {
    at(from);
    expect(screen.getByTestId("where")).toHaveTextContent(to);
  });

  test("없는 주소는 안내 화면", () => {
    at("/nope");
    expect(screen.getByRole("heading", { name: "페이지를 찾을 수 없어요" })).toBeInTheDocument();
  });

  test("챗봇 단독 화면은 지도 SDK 없이 열린다", () => {
    at("/chat");
    expect(screen.getByRole("dialog", { name: "냥집사 AI 도우미" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "닫기" })).toBeNull();
    expect(document.title).toBe("냥집사 AI 도우미");
  });
});

describe("네이버 지도", () => {
  test("키가 없으면 지도 대신 안내 문구, 스크립트를 붙이지 않음", () => {
    at("/map");
    expect(document.querySelector("#map .err")).toHaveTextContent("NAVER_MAP_CLIENT_ID");
    expect(document.querySelectorAll("script[data-naver-maps]")).toHaveLength(0);
    // 챗봇은 그대로 (위치 없음 기준)
    expect(screen.getByRole("button", { name: "냥집사 AI 도우미 열기" })).toBeInTheDocument();
  });

  test("로더: 동시에 여러 번 불러도 <script> 는 하나, 실패하면 다음에 다시 시도", async () => {
    __resetNaverLoader();
    const p1 = loadNaverMaps("k");
    const p2 = loadNaverMaps("k");
    const scripts = document.querySelectorAll<HTMLScriptElement>("script[data-naver-maps]");
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe("https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=k");
    scripts[0].dispatchEvent(new Event("error"));
    await expect(p1).rejects.toThrow("네이버 지도 스크립트를 불러오지 못했습니다.");
    await expect(p2).rejects.toThrow();
    expect(document.querySelectorAll("script[data-naver-maps]")).toHaveLength(0);
    void loadNaverMaps("k").catch(() => {});
    expect(document.querySelectorAll("script[data-naver-maps]")).toHaveLength(1);
    __resetNaverLoader();
  });
});

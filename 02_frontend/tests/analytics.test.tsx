// Amplitude 분석: SDK 초기화 옵션, utm 이 모든 이벤트에 붙는지, 개인정보 제거, 퍼널 이벤트(상담·병원 버튼·공유)
import { beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { createSdkAnalytics, analytics, type AmplitudeClient } from "../src/services/analytics/analytics";
import { captureUtm, parseUtm, resetUtmForTest } from "../src/services/analytics/attribution";
import { createConsultTracker } from "../src/services/analytics/consult";
import { HospitalActions } from "../src/features/hospital/HospitalActions";
import { routeUrl } from "../src/features/hospital/hospitalLinks";
import { mockFetch } from "./helpers/fetch";

function fakeClient() {
  const calls: { type: string; props?: Record<string, unknown> }[] = [];
  const init = vi.fn<AmplitudeClient["init"]>();
  const setUserId = vi.fn<AmplitudeClient["setUserId"]>();
  const reset = vi.fn<AmplitudeClient["reset"]>();
  const client = {
    init,
    track: (type: string, props?: Record<string, unknown>) => void calls.push({ type, props }),
    setUserId,
    reset,
  } satisfies AmplitudeClient;
  return { client, calls };
}

beforeEach(() => resetUtmForTest());

describe("SDK 분석", () => {
  test("키가 없으면 SDK 를 초기화하지도 보내지도 않음", () => {
    const { client, calls } = fakeClient();
    const a = createSdkAnalytics({ apiKey: "", client });
    a.init();
    a.track("landing_viewed");
    expect(client.init).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  test("한 번만 초기화, 자동 페이지뷰·클릭·폼 수집은 끔, IP 저장 안 함", () => {
    const { client } = fakeClient();
    const a = createSdkAnalytics({ apiKey: "k", client });
    a.init();
    a.track("landing_viewed");
    expect(client.init).toHaveBeenCalledTimes(1);
    const opts = client.init.mock.calls[0][1]!;
    expect(opts.autocapture).toMatchObject({ attribution: true, pageViews: false, formInteractions: false, elementInteractions: false });
    expect(opts.trackingOptions).toEqual({ ipAddress: false });
  });

  test("주소의 utm 이 이후 모든 이벤트에 붙음 (페이지를 옮겨도 유지)", () => {
    const { client, calls } = fakeClient();
    const a = createSdkAnalytics({ apiKey: "k", client });
    captureUtm("?utm_source=share&utm_medium=referral&utm_campaign=hospital_card&focus=37.5,127.0&name=병원");
    a.track("landing_viewed");
    captureUtm("?focus=37.6,127.1"); // utm 없는 주소로 이동해도 유지
    a.track("cost_viewed", { hospital_id: 7 });
    a.track("result_shared", { hospital_id: 7, share_type: "hospital" });
    for (const c of calls) {
      expect(c.props).toMatchObject({ utm_source: "share", utm_medium: "referral", utm_campaign: "hospital_card" });
    }
    expect(calls[1].props).toEqual({ hospital_id: 7, utm_source: "share", utm_medium: "referral", utm_campaign: "hospital_card" });
  });

  test("상담 문장·이름·연락처·위치는 속성에서 빠짐", () => {
    const { client, calls } = fakeClient();
    const a = createSdkAnalytics({ apiKey: "k", client });
    a.track("consult_started", { message: "고양이가 토해요", hospital_name: "A", phone: "010", lat: 37.5, lon: 127, email: "a@b.c", surface: "home" });
    expect(calls[0].props).toEqual({ surface: "home" });
  });

  test("로그인 연결·로그아웃 시 reset(새 device_id)", () => {
    const { client } = fakeClient();
    const a = createSdkAnalytics({ apiKey: "k", client });
    a.setUserId("u-1");
    expect(client.setUserId).toHaveBeenCalledWith("u-1");
    a.setUserId(null);
    expect(client.reset).toHaveBeenCalledTimes(1);
  });

  test("parseUtm: 다른 쿼리는 무시, 너무 긴 값은 버림", () => {
    expect(parseUtm(`?utm_source=a&x=1&utm_campaign=${"c".repeat(101)}`)).toEqual({ utm_source: "a" });
  });
});

describe("상담 퍼널", () => {
  const reply = (over = {}) => ({ hospitals: 0, places: 0, comparison: false, followUp: true, fallback: false, ...over });

  test("첫 답 = consult_started, 결과가 나오면 consult_completed (각 한 번)", () => {
    const track = vi.fn();
    const t = createConsultTracker("home", { init() {}, track, setUserId() {} });
    t.onReply(reply());
    t.onReply(reply());
    t.onReply(reply({ hospitals: 3 }));
    t.onReply(reply({ comparison: true }));
    expect(track.mock.calls).toEqual([
      ["consult_started", { surface: "home", fallback: false }],
      ["consult_completed", { surface: "home", result_type: "hospitals", reply_count: 3, fallback: false }],
    ]);
    t.reset();
    t.onReply(reply({ followUp: false }));
    expect(track.mock.calls.slice(2)).toEqual([
      ["consult_started", { surface: "home", fallback: false }],
      ["consult_completed", { surface: "home", result_type: "answer", reply_count: 1, fallback: false }],
    ]);
  });
});

describe("병원 행동 버튼", () => {
  const h = { hospitalId: 7250, name: "누리봄동물병원", phone: "02-735-7530", lat: 37.575793, lon: 126.971065 };

  test("전화·길찾기 → hospital_clicked(call/route) + route_viewed, 병원 id 만", () => {
    const track = vi.spyOn(analytics, "track");
    render(<MemoryRouter><HospitalActions hospital={h} /></MemoryRouter>);
    fireEvent.click(screen.getByText("전화"));
    const route = screen.getByText("길찾기");
    expect(route).toHaveAttribute("href", routeUrl(h));
    fireEvent.click(route);
    expect(track.mock.calls).toEqual([
      ["hospital_clicked", { hospital_id: 7250, click_type: "call" }],
      ["hospital_clicked", { hospital_id: 7250, click_type: "route" }],
      ["route_viewed", { hospital_id: 7250 }],
    ]);
    expect(screen.getByText("전화")).toHaveAttribute("href", "tel:027357530");
  });

  test("카카오톡 공유 → result_shared + POST /api/share, 공유 링크(utm 포함) 복사", async () => {
    const track = vi.spyOn(analytics, "track");
    const link = "http://localhost:8080/s/abc?utm_source=share&utm_medium=referral&utm_campaign=hospital_card";
    const { calls } = mockFetch((url) =>
      url.pathname === "/api/share"
        ? { json: { code: "abc", share_url: link, map_url: "x", card: { title: "t", description: "d", image_url: "i", button_title: "b", link_url: link }, hospital: {} } }
        : { status: 404, json: {} },
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, share: undefined, clipboard: { writeText } });
    render(<MemoryRouter><HospitalActions hospital={h} /></MemoryRouter>);
    await act(async () => fireEvent.click(screen.getByText("카카오톡 공유")));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(link));
    expect(track).toHaveBeenCalledWith("result_shared", { hospital_id: 7250, share_type: "hospital" });
    const post = calls.find((c) => c.url.startsWith("/api/share"))!;
    expect(post.body).toEqual({ hospital_id: 7250, channel: "kakaotalk" });
    expect(screen.getByRole("status")).toHaveTextContent("복사");
  });
});

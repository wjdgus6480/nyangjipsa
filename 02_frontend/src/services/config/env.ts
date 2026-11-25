// 환경변수는 이 파일에서만 읽습니다.

/**
 * 백엔드 주소. 비워 두면 같은 출처(/api/…)로 호출합니다.
 * - 개발: Vite 가 /api 를 BACKEND_URL(기본 http://localhost:8080)로 프록시
 * - 배포: 리버스 프록시로 같은 출처에 두거나, VITE_API_BASE=https://api.example.com 처럼 지정
 *   (백엔드는 APP_ENV=development 일 때만 CORS 를 허용합니다)
 */
export const API_BASE: string = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

/** 네이버 지도 Client ID (vite.config.ts 가 .env 에서 주입). 없으면 지도 화면이 안내 문구를 보여 줍니다 */
export const NAVER_MAP_CLIENT_ID: string = import.meta.env.VITE_NAVER_MAP_CLIENT_ID ?? "";

/**
 * Amplitude 프로젝트 API 키 (브라우저 공개용 키). 비우면 분석 이벤트를 보내지 않습니다.
 * 02_frontend/.env.local 의 VITE_AMPLITUDE_API_KEY
 */
export const AMPLITUDE_API_KEY: string = import.meta.env.VITE_AMPLITUDE_API_KEY ?? "";

/** Amplitude HTTP API 주소. EU 데이터센터 프로젝트면 https://api.eu.amplitude.com/2/httpapi */
export const AMPLITUDE_SERVER_URL: string =
  import.meta.env.VITE_AMPLITUDE_SERVER_URL || "https://api2.amplitude.com/2/httpapi";

/** public/ 기준 정적 파일 경로 (배포 base 경로 대응) */
export const asset = (p: string): string => `${import.meta.env.BASE_URL}${p.replace(/^\/+/, "")}`;

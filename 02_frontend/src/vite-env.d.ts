/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_NAVER_MAP_CLIENT_ID?: string;
  /** Amplitude 프로젝트 API 키 (비우면 분석 이벤트 전송 안 함) */
  readonly VITE_AMPLITUDE_API_KEY?: string;
  readonly VITE_AMPLITUDE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /** 행정구역 레이어 성능 확인용 (마지막 갱신 소요 ms 등). 기존 지도 화면과 동일 */
  __regionPerf?: unknown;
}

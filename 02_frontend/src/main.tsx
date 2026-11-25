import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "./styles/tokens.css";
import "./styles/base.css";
import { App } from "./app/App";
import { startAnalytics } from "./services/analytics/analytics";

// 분석: 모든 페이지에서 한 번 초기화 + 유입 utm 기억 (키가 없으면 아무것도 안 함)
startAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

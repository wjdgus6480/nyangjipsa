import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // 기존 화면(home/, map-poc/)과 도구는 신규 화면 검증이 끝날 때까지 그대로 보존하므로 검사 대상에서 제외
  { ignores: ["dist", "node_modules", "home", "map-poc", "tools", "serve.js", "public"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, naver: "readonly" } },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Provider 와 짝이 되는 훅(useModal 등)·아이콘 묶음은 같은 파일에 둠
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true, allowExportNames: ["useModal", "useToast", "useGuideModal", "ICONS"] }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["vite.config.mts", "eslint.config.mjs"],
    languageOptions: { globals: globals.node },
  },
);

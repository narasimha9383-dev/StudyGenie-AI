const browserGlobals = {
  window: "readonly",
  document: "readonly",
  localStorage: "readonly",
  sessionStorage: "readonly",
  FormData: "readonly",
  File: "readonly",
  URLSearchParams: "readonly",
  URL: "readonly",
  Event: "readonly",
  alert: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
};

export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: browserGlobals,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // Start with actionable diagnostics while preserving the existing UI
      // implementation; warnings do not block production builds.
      "no-undef": "warn",
      // React JSX references are not understood by the core rule without a
      // React-specific plugin; keep this project-wide check non-noisy.
      "no-unused-vars": "off",
    },
  },
];

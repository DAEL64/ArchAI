import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Project rule tuning. These two fire on intentional patterns here and were
    // never enforced by `next build` (Next 16 doesn't run ESLint at build).
    // Kept as warnings so they stay visible without failing lint/CI:
    //  - react-hooks/set-state-in-effect: experimental rule; flags standard
    //    sync-from-prop / fetch-on-mount / route-driven effects that are
    //    correct in this app.
    //  - no-explicit-any: limited to boundary parsing of untrusted model output
    //    (lib/blueprint.ts) and request bodies; safe to tighten later.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
]);

export default eslintConfig;

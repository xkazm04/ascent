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
    // `.next-empty/**` is the SAME build output under a different name: next.config.ts switches
    // distDir when ASCENT_EMPTY=1, which `npm run dev:empty` and the local-mode loop e2e suite
    // (playwright.loop.config.ts) both set so their dev server never collides with `.next`. It was
    // never added here, so anyone who ran either of them and then `npm run lint` got 563 errors out
    // of generated bundles and a gate failure no file in `src` could explain — the exact failure the
    // worktree ignore below was added for.
    ".next-empty/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees are full checkouts of this repo. Linting them reports every finding once per
    // live worktree — on 2026-07-27 that turned 2 real errors into 14 and buried them under ~200
    // duplicate warnings, so the gate failed for a reason no file in `src` could explain. The code
    // in a worktree is linted on its own branch, before it merges; here it is noise.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;

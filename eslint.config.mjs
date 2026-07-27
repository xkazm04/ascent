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
    // Agent worktrees are full checkouts of this repo. Linting them reports every finding once per
    // live worktree — on 2026-07-27 that turned 2 real errors into 14 and buried them under ~200
    // duplicate warnings, so the gate failed for a reason no file in `src` could explain. The code
    // in a worktree is linted on its own branch, before it merges; here it is noise.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;

// Vitest config (plain JS so it is invisible to `tsc --noEmit` — vitest/vite are run via npx and
// not installed as deps, so a typed config would fail the type gate). Its one job is to resolve
// the project's `@/*` path alias the same way tsconfig does, so unit tests can import production
// modules that use `@/...` imports.
import { resolve } from "node:path";

export default {
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: [{ find: /^@\//, replacement: resolve(process.cwd(), "src") + "/" }],
  },
};

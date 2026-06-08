// Vitest config (plain JS so it is invisible to `tsc --noEmit`). vitest is a devDependency; run the
// suite with `npm test` (vitest run) or `npm run test:watch`. Its one job is to resolve the
// project's `@/*` path alias the same way tsconfig does, so unit tests can import production
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

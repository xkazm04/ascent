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
  // Layering gate [A4] (registry: software-engineering/data-access/layering-rules): the raw Prisma
  // client module and its query machinery stay inside the data layer (src/lib/db). Everything above
  // it imports the @/lib/db barrel and speaks repository functions — otherwise "who writes to this
  // table" stops being one directory's answer. Enforced at the import boundary because the rule
  // dies by leak, not by decree.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/db/**",
      "src/**/*.test.ts",
      // Grandfathered importers of @/lib/db/client (pre-existing; ratchet — do NOT add to this
      // list, new code goes through the @/lib/db barrel):
      "src/app/api/dev/seed-ai-usage/route.ts",
      "src/app/api/org/followups/handoff/route.ts",
      "src/lib/athena/actions-execute.ts",
      "src/lib/auth.ts",
      "src/lib/entitlement.ts",
      "src/lib/local/loop-engine.ts",
      "src/lib/memory/coverage.ts",
      "src/lib/memory/scan-feed.ts",
      "src/lib/org/getting-started.ts",
      // TODO(layering-rules): public-scan-quota also runs the ONE $transaction outside the data
      // layer (needs a data-layer home for its read-decide-write; see the file's quotaTxOptions).
      "src/lib/public-scan-quota.ts",
      "src/lib/register/data.ts",
      "src/lib/registry/api.ts",
      "src/lib/registry/capabilities.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/db/client",
              message:
                "The raw client module is data-layer internal — import what you need from the @/lib/db barrel (layering-rules).",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name=/^\\$(transaction|queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)$/]",
          message:
            "Raw Prisma query/transaction APIs belong inside src/lib/db — add or extend a repository function instead (layering-rules).",
        },
      ],
    },
  },
]);

export default eslintConfig;

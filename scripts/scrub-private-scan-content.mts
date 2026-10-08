// THE PRIVATE-SCAN BACKFILL SCRUB — a one-off, idempotent pass over rows of private repositories written
// before the store rule shipped (5aed22ae). Operator decision 2026-10-08: "Scrub all of it".
//
//   npx vite-node --config vitest.config.js scripts/scrub-private-scan-content.mts
//       DRY RUN (the default). Prints the target database host (never the credentials), then per table
//       and column the rows examined, the rows that would change and the rows unchanged, then per org
//       the mirror and repo-memory rows that would be deleted and the linked memories it only lists.
//
//   npx vite-node --config vitest.config.js scripts/scrub-private-scan-content.mts --apply [--org <slug>]
//       Writes. A second --apply changes 0 rows. Refused on a self-hosted deployment (see the module).
//
// The logic, and the reasons for each rule, live in src/lib/db/private-scan-scrub.ts; this file only
// reads the flags and prints.

import { formatScrubOutcome, scrubPrivateScanContent } from "@/lib/db/private-scan-scrub";

/** The host the run will write to, and nothing else from the connection string. */
function dbHost(): string {
  const url = process.env.DATABASE_URL;
  if (url) {
    try {
      return new URL(url).host || "(no host in DATABASE_URL)";
    } catch {
      return "(DATABASE_URL is not a URL)";
    }
  }
  return process.env.DSQL_ENDPOINT ? `${process.env.DSQL_ENDPOINT} (DSQL)` : "(none: DATABASE_URL and DSQL_ENDPOINT unset)";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const orgIdx = args.indexOf("--org");
  const orgSlug = orgIdx >= 0 ? args[orgIdx + 1] : undefined;
  if (orgIdx >= 0 && !orgSlug) {
    console.error("--org needs a slug");
    process.exit(2);
  }
  console.log(`Target database host: ${dbHost()}`);
  const out = await scrubPrivateScanContent({ apply, ...(orgSlug ? { orgSlug } : {}) });
  // formatScrubOutcome repeats the host as its first line for the test; it is printed above already,
  // before any query runs, so drop the duplicate.
  console.log(formatScrubOutcome(out, dbHost()).split("\n").slice(1).join("\n"));
  process.exit(out.ok ? 0 : 1);
}

void main();

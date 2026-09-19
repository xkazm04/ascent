// Precondition: the suite asserts business value over the SEEDED "vercel" org. Fail fast with a
// clear message if the server isn't up or the org has no data, rather than a wall of selector errors.
export default async function globalSetup() {
  const base = `http://localhost:${process.env.E2E_ORG_PORT || "3007"}`;
  const res = await fetch(`${base}/org/vercel`).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(`[org-suite] ${base} is not reachable. Start the prod server on :3007 (with DATABASE_URL).`);
  }
  const html = await res.text();
  // Assert only on what a plain fetch can actually SEE. The dashboard's panels ("Org maturity" and
  // friends) are not in this response at all — they arrive through streaming/hydration, so a browser
  // finds them and `fetch()` never does. Checking for one of them made this precondition a race on
  // render timing: it passed against a warm server and failed against a cold one, then reported the
  // seeded org as unseeded — a false alarm pointing at the wrong problem entirely.
  //
  // Both signals below come from src/app/org/[slug]/layout.tsx, which renders ABOVE the page's
  // Suspense boundaries and is therefore always in the initial shell: the "No data for <slug>"
  // empty state, and the fleet-maturity chip that only a resolved org header emits.
  if (/No data for/i.test(html) || !/Fleet maturity/i.test(html)) {
    throw new Error(
      `[org-suite] the 'vercel' org has no data. Seed it first:\n  ASCENT_BASE=${base} node scripts/seed-org.mjs vercel 20`,
    );
  }
}

// Precondition: the suite asserts business value over the SEEDED "vercel" org. Fail fast with a
// clear message if the server isn't up or the org has no data, rather than a wall of selector errors.
export default async function globalSetup() {
  const base = `http://localhost:${process.env.E2E_ORG_PORT || "3007"}`;
  const res = await fetch(`${base}/org/vercel`).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(`[org-suite] ${base} is not reachable. Start the prod server on :3007 (with DATABASE_URL).`);
  }
  const html = await res.text();
  if (/No data for/i.test(html) || !/Org maturity/i.test(html)) {
    throw new Error(
      `[org-suite] the 'vercel' org has no data. Seed it first:\n  ASCENT_BASE=${base} node scripts/seed-org.mjs vercel 20`,
    );
  }
}

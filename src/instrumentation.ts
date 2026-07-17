// Next.js startup hook. When PGLITE_DATA_DIR is set (local dev), boot an embedded in-process PGlite
// and stash a Prisma driver adapter for src/lib/db/client.ts to use — a real, persistent, offline
// Postgres with no install and no separate server.
//
// The actual boot lives in a node-only module loaded via a guarded dynamic import, so this file
// stays free of node: APIs and never triggers Edge-runtime compile warnings.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // The embedded PGlite is a LOCAL-DEV tool (pglite-boot.ts loads Postgres-in-WASM via dynamic
  // requires). Gating its dynamic import on NODE_ENV !== "production" lets the production build's
  // file tracer fold this whole branch to dead code (NODE_ENV is statically inlined) — so PGlite's
  // unresolvable WASM requires never enter the Node File Trace, which is what was over-including
  // next.config.ts ("Encountered unexpected file in NFT list"). On Vercel PGLITE_DATA_DIR is unset,
  // so no deployed behavior changes; only a local `next start` with PGLITE_DATA_DIR set stops booting
  // the embedded DB — use `npm run dev` for that (its documented entry point).
  const dataDir = process.env.PGLITE_DATA_DIR;
  if (dataDir) {
    if (process.env.NODE_ENV !== "production") {
      const { bootPglite } = await import("@/lib/db/pglite-boot");
      await bootPglite(dataDir);
    } else if (!process.env.DATABASE_URL) {
      // The losing side of the trade-off above must be OBSERVABLE (database-client-schema 07-16 #4):
      // a developer running the prod-smoke flow (`next build && next start`) against their local
      // .pglite data gets no boot and an app-wide empty keyless-MVP state — plausible enough to
      // masquerade as a data problem. One warn line; references no pglite module, so the NFT-fold
      // above is unaffected. (Quiet when DATABASE_URL is set — a real DB is configured, so the
      // leftover PGLITE_DATA_DIR is genuinely irrelevant.)
      console.warn(
        "[pglite] PGLITE_DATA_DIR is set but the embedded PGlite does NOT boot in production builds — " +
          "every DB read will be empty. Use `npm run dev` for the embedded DB, or set DATABASE_URL for `next start`.",
      );
    }
  }
}

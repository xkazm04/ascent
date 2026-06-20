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
  if (process.env.NODE_ENV !== "production" && dataDir) {
    const { bootPglite } = await import("@/lib/db/pglite-boot");
    await bootPglite(dataDir);
  }
}

// Next.js startup hook. When PGLITE_DATA_DIR is set (local dev), boot an embedded in-process PGlite
// and stash a Prisma driver adapter for src/lib/db/client.ts to use — a real, persistent, offline
// Postgres with no install and no separate server.
//
// The actual boot lives in a node-only module loaded via a guarded dynamic import, so this file
// stays free of node: APIs and never triggers Edge-runtime compile warnings.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const dataDir = process.env.PGLITE_DATA_DIR;
  if (!dataDir) return;
  const { bootPglite } = await import("@/lib/db/pglite-boot");
  await bootPglite(dataDir);
}

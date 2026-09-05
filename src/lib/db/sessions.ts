// Server-side session revocation store. Backs the `sv` (session version) embedded in the
// signed session cookie: a logout (or an access change) bumps the per-login version, and
// getSessionState rejects any cookie minted at an older version — making logout real
// instead of "delete the client cookie and hope a leaked copy isn't still valid for the
// full TTL." Persistence is OPTIONAL: with no DB configured these are no-ops / version 0,
// and auth falls back to the stateless, TTL-only behavior (revocation simply isn't
// available, exactly as before). See src/lib/auth.ts for the read/refresh side.

import { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";

/**
 * The current session version for a login (lowercased). 0 when there is no row yet (a
 * login that has never been revoked) or when the DB isn't configured. Read on every
 * session resolve, so it's a single primary-key lookup.
 */
export async function getSessionVersion(login: string): Promise<number> {
  if (!isDbConfigured()) return 0;
  const row = await getPrisma().sessionRevocation.findUnique({
    where: { login: login.toLowerCase() },
    select: { version: true },
  });
  return row?.version ?? 0;
}

/**
 * Bump (and return) a login's session version, invalidating every token minted at the
 * prior version. The first revocation for a login starts the row at 1. No-op returning 0
 * when the DB isn't configured (stateless mode has no revocation authority).
 */
export async function bumpSessionVersion(login: string): Promise<number> {
  if (!isDbConfigured()) return 0;
  const key = login.toLowerCase();
  const prisma = getPrisma();
  try {
    const row = await prisma.sessionRevocation.upsert({
      where: { login: key },
      update: { version: { increment: 1 } },
      create: { login: key, version: 1 },
      select: { version: true },
    });
    return row.version;
  } catch (err) {
    // Concurrent first-time revocations (e.g. logout racing an uninstall) can both miss
    // the row and race to INSERT; the loser throws P2002 on the unique login. The row now
    // exists, so converge by applying the increment to it instead of bubbling a spurious
    // failure (mirrors upsertInstallation's P2002 handling).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const row = await prisma.sessionRevocation.update({
        where: { login: key },
        data: { version: { increment: 1 } },
        select: { version: true },
      });
      return row.version;
    }
    throw err;
  }
}

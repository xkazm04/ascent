// Personal passports lens — each watched repo's cached App Readiness Passport from the shared PUBLIC
// corpus (the individual-tier lens; see personal.ts). Mirrors the org rollup's parsing exactly:
// passportJson is the display cache written by the latest scan, and owner-set overrides (the fields a
// scan can't observe — criticality/lifecycle/rollback) are applied as a read-time overlay, so an
// individual sees the same honest card the repo's own org would.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { PUBLIC_ORG } from "@/lib/org-constants";
import { applyPassportOverrides, parsePassportJson, parsePassportOverrides } from "@/lib/analyze/passport";
import type { AppPassport } from "@/lib/types";

export interface PersonalPassport {
  fullName: string;
  passport: AppPassport;
}

/**
 * Passports for every watched repo whose latest public scan cached one. Null when the DB is off or
 * the personal org doesn't exist; repos without a passport (never scanned / legacy scan) are skipped.
 */
export async function getPersonalPassports(personalSlug: string): Promise<PersonalPassport[] | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({
    where: { slug: personalSlug.trim().toLowerCase() },
    select: { id: true },
  });
  if (!org) return null;

  const watched = await prisma.repository.findMany({
    where: { orgId: org.id, watched: true },
    select: { fullName: true },
  });
  if (watched.length === 0) return [];

  const pub = await prisma.organization.findUnique({ where: { slug: PUBLIC_ORG }, select: { id: true } });
  if (!pub) return [];

  const repos = await prisma.repository.findMany({
    where: { orgId: pub.id, fullName: { in: watched.map((w) => w.fullName) } },
    select: { fullName: true, passportJson: true, passportOverridesJson: true },
    orderBy: { fullName: "asc" },
  });

  const out: PersonalPassport[] = [];
  for (const r of repos) {
    const pp = parsePassportJson(r.passportJson);
    if (!pp) continue;
    out.push({ fullName: r.fullName, passport: applyPassportOverrides(pp, parsePassportOverrides(r.passportOverridesJson)) });
  }
  return out;
}

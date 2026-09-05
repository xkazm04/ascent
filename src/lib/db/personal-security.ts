// Personal security lens — each watched repo's Security (D9) standing from its latest PUBLIC-corpus
// scan (the individual-tier lens; see personal.ts). Returns the RAW persisted dimension payload
// (score + evidence/gaps/summary): parsing evidence lines into the structured check battery is the
// pure `parseSecurityChecks` in @/lib/org/security, which the rendering component applies — keeping
// this module free of an import cycle back through the org-security assembly (which imports @/lib/db).

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { PUBLIC_ORG } from "@/lib/org-constants";

export interface PersonalSecurityRow {
  owner: string;
  name: string;
  fullName: string;
  /** Security (D9) score 0..100 from the latest public scan. */
  score: number;
  /** Raw D9 evidence lines (`Name [group/risk]: score/10 — detail`) for parseSecurityChecks. */
  evidence: string[];
  /** The prioritized remediation list persisted with the dimension. */
  gaps: string[];
  summary: string;
  scannedAt: string; // ISO
}

function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * D9 rows for every watched repo with a scanned public report carrying the dimension. Null when the
 * DB is off or the personal org doesn't exist; repos without a D9 row (legacy scans) are skipped.
 */
export async function getPersonalSecurityRows(personalSlug: string): Promise<PersonalSecurityRow[] | null> {
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
    select: {
      owner: true,
      name: true,
      fullName: true,
      scans: {
        orderBy: { scannedAt: "desc" },
        take: 1,
        select: {
          scannedAt: true,
          dimensions: { where: { dimId: "D9" }, select: { score: true, evidence: true, gaps: true, summary: true } },
        },
      },
    },
    orderBy: { fullName: "asc" },
  });

  const out: PersonalSecurityRow[] = [];
  for (const r of repos) {
    const scan = r.scans[0];
    const dim = scan?.dimensions[0];
    if (!scan || !dim) continue;
    out.push({
      owner: r.owner,
      name: r.name,
      fullName: r.fullName,
      score: dim.score,
      evidence: parseStringArray(dim.evidence),
      gaps: parseStringArray(dim.gaps),
      summary: dim.summary ?? "",
      scannedAt: scan.scannedAt.toISOString(),
    });
  }
  // Weakest first — the same "worst first" reading order as the org risk register.
  return out.sort((a, b) => a.score - b.score);
}

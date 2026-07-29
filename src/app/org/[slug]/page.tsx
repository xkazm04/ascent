import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OrgTabChunks } from "@/components/org/shell/OrgTabChunks";
import { getOrgHeaderSummary } from "@/lib/db";
import { canReadOrg } from "@/lib/authz";
import { levelForScore } from "@/lib/maturity/model";
import { DEFAULT_ORG_TAB, isMigratedOrgTab, isOrgTabId, legacyOrgTabPath } from "@/lib/org/orgTabs";

// Kept from the layout's contract: the tenant gate must never be cached.
export const dynamic = "force-dynamic";

// SHELL-2: shareable metadata for the fleet dashboard. Real fleet numbers are surfaced ONLY when the
// org is publicly readable (canReadOrg is true for the shared public org, and — with a session — the
// viewer's own orgs). An unfurl is fetched without cookies, so a private org always degrades to the
// neutral description here and the neutral card in the co-located opengraph-image — never leaking
// private fleet aggregates to whoever holds the link. The OG image advertises summary_large_image.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  // The description prints exactly three numbers (avgOverall, scannedCount, repoCount) — all carried
  // by the cheap, request-memoized getOrgHeaderSummary the page (and the org shell) already ran. The
  // full getOrgRollup that used to run here pulled every repo's dimension/passport/techStack/governance
  // JSON plus the trend + forecast queries to throw all of it away. Same repo set (watched OR
  // has-scans, unscoped) and the same `roundedMean` over latest overall scores, so the unfurl copy is
  // byte-identical — this is purely the second rollup the Overview stopped paying for.
  const summary = (await canReadOrg(slug)) ? await getOrgHeaderSummary(slug).catch(() => null) : null;
  const title = `${slug} — fleet maturity · Ascent`;
  const description =
    summary && summary.repoCount > 0
      ? `${slug}'s fleet averages ${summary.avgOverall}/100 (${levelForScore(summary.avgOverall).id} · ${levelForScore(summary.avgOverall).name}) across ${summary.scannedCount}/${summary.repoCount} scanned repos on Ascent.`
      : `AI-native engineering maturity across ${slug}'s fleet on Ascent — a 5-level ladder across 9 dimensions, with evidence.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

/**
 * The org dashboard shell: ONE route for every tab, selected by `?tab=` (the default tab is
 * normalized away and lives at the bare `/org/[slug]`). See docs/ORG-TABS-REFACTOR.md.
 *
 * It does no auth and no data work of its own. Every guard — DB configured, sign-in wall, the
 * canReadOrg TENANT check, the empty-org state — stays in layout.tsx, which wraps this and runs
 * before any org data is touched. Duplicating canReadOrg here would be a second tenant check that
 * can drift from the real one.
 */
export default async function OrgDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  // Resolve + validate. An unknown ?tab= falls back to the default rather than 404-ing: a stale
  // bookmark should land on the dashboard, not on an error.
  const raw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab = isOrgTabId(raw) ? raw : DEFAULT_ORG_TAB;

  // MIGRATION SEAM (delete with MIGRATED_ORG_TAB_IDS): a valid id whose panel isn't registered in
  // OrgTabChunks yet still has a working route of its own — send the deep link there rather than
  // rendering an empty shell. Once every tab is registered this branch is dead code.
  if (!isMigratedOrgTab(tab)) redirect(legacyOrgTabPath(slug, tab));

  return <OrgTabChunks slug={slug} tab={tab} sp={sp} />;
}

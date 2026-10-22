// Org dashboard "Security" tab — a security-first view of the fleet (Direction #2 phase 1): the
// Security (D9) dimension across repos plus a security "Copy for LLM" remediation brief. The whole
// tab is now ONE dense risk register (score → drill-in modal, gate verdict, branch rules, advisories,
// and the specific per-repo findings the scan flagged); the former Governance-coverage and
// Supply-chain cards were folded into the register's columns and removed.
//
// Migrated onto the org tab shell (docs/ORG-TABS-REFACTOR.md):
//   - SERVER component, filename PINNED as `SecurityTab.tsx`; takes `slug` + the resolved `sp` as
//     props since it is no longer a route.
//   - Does NO auth work: the org layout's `canReadOrg` gate already ran.
//   - Its old route (src/app/org/[slug]/security/page.tsx) is now a redirect(); links already sitting
//     in digest emails and /report/... permalinks still resolve to it.

import { buildGateSnippet, buildSecurityOverview, securityMarkdown } from "@/lib/org/security";
import { getOrgSupplyChain } from "@/lib/security/supply-chain";
import { SectionEmpty } from "@/components/org/shared/ui";
import { securityV1 } from "./SecurityTab.v1";
import { securityV2 } from "./SecurityTab.v2";
import type { SecurityTabData } from "./securityTabData";
import { PersonalSecurity } from "@/components/org/PersonalSecurity";
import { isPersonalOrg } from "@/lib/db";
import { decisionMap } from "@/lib/org/decision-map";
import { resolveStackScope } from "@/lib/org/scope";
import { orgWindowBounds, resolveOrgWindow } from "@/lib/org/period";
import { getTheme } from "@/lib/theme/server";
import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function SecurityTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  // A PERSONAL workspace gets the lens edition: watched repos' D9 from the public corpus, with the
  // same decidable-findings list writing decisions to the viewer's own org (see PersonalSecurity).
  if (await isPersonalOrg(slug)) return <PersonalSecurity slug={slug} />;

  const period = await resolveOrgWindow(sp);
  // Optional tech-stack scope (Feature 3b): "Frontend security vs Backend" — scope the whole overview.
  const { techGroups, activeStack, techGroupId } = await resolveStackScope(slug, sp);
  const [sec, supply, decisions, theme] = await Promise.all([
    buildSecurityOverview(slug, orgWindowBounds(period), period.title, techGroupId),
    getOrgSupplyChain(slug, techGroupId),
    decisionMap(slug, "security"),
    getTheme(),
  ]);

  if (!sec) {
    return (
      <div className="space-y-4">
        <SectionEmpty>No scanned repositories yet. Scan some of this org&apos;s repos to assess security.</SectionEmpty>
        <NextMoveLink href={orgTabHref(slug, "repositories")} to="repositories" />
      </div>
    );
  }

  const md = securityMarkdown(sec, supply);
  // Concrete, paste-ready CI enforcement for THIS fleet — built from the FULL register (never the
  // display-capped failingRepos, which silently dropped every failing repo past 8). See buildGateSnippet.
  const gateSnippet = buildGateSnippet(sec);
  const supplyOn = !!supply && supply.scanned > 0;
  // getOrgSupplyChain returns `degraded: true` with `scanned: 0` when the advisory fetch failed (GitHub
  // auth/token failure), precisely so the caller does not mistake it for "no advisories". Nothing read
  // that flag: `supplyOn` is false either way, `advisories` is passed as null, and the register renders
  // a clean supply chain. A security view that reports "clean" when it could not look is the most
  // dangerous false signal it can emit — surface it.
  const supplyDegraded = !!supply?.degraded;

  const pdfHref = `/api/org/security/pdf?org=${encodeURIComponent(slug)}&range=${period.key}${period.from ? `&from=${encodeURIComponent(period.from)}` : ""}${period.to ? `&to=${encodeURIComponent(period.to)}` : ""}${activeStack ? `&stack=${encodeURIComponent(activeStack.key)}` : ""}`;
  const data: SecurityTabData = {
    slug,
    sec,
    decisions,
    md,
    gateSnippet,
    advisories: supplyOn ? supply!.repos.map((r) => ({ fullName: r.fullName, critical: r.critical, high: r.high, medium: r.medium, low: r.low, total: r.total })) : null,
    // security-posture-audit-log #3: the mock provider's honesty flag must reach the on-screen register.
    advisoriesDemo: supplyOn ? supply!.demo : false,
    supplyDegraded,
    pdfHref,
    comparisonLabel: period.comparisonLabel,
    stack: { groups: techGroups, active: activeStack?.key ?? null },
  };
  // THEME DUALITY: the theme picks the composition (SecurityTab.v1.tsx Altimeter, SecurityTab.v2.tsx Prism).
  return theme === "prism" ? securityV2(data) : securityV1(data);
}

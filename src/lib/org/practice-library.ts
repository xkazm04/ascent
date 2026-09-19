// The Practice Library's HEADLINE reading — the one-paragraph answer to "what does our library
// actually say?" that Governance (governanceMarkdown) and Adoption (adoptionMarkdown) already give
// their tabs, and the library did not. Pure assembly over data the practices page ALREADY fetches
// (getOrgPractices + listPlaybooks + getPlaybookAdoption): no new query, no re-scan.
//
// Two exports, mirroring the governance/adoption shape:
//   - buildPracticeLibrarySummary : the numbers behind the tile row.
//   - practiceLibraryMarkdown     : the Copy-for-LLM brief, ending in an exploration-voice "## Ask".
//
// Everything degrades: the starter-PR rollout is OPTIONAL (getOrgPractices only attaches `prs` to a
// practice that has actually been applied in this org), so a library that has never opened a starter
// PR reports `rollout: null` and the brief simply omits the section — never a zero that reads as
// "we tried and nothing landed".

import type { OrgPractice, PlaybookRow, PlaybookAdoption } from "@/lib/db";

/** A mined practice with a proven exemplar AND repos still lacking it — the reuse opportunity. */
export interface LibraryOpportunity {
  id: string;
  label: string;
  dimId: string;
  /** The repo that already embodies it (learn-from target), or null. */
  exemplar: string | null;
  /** Repos scoring below the gap floor on this practice's dimension. */
  couldAdopt: number;
  /** Starter PRs already in flight for this practice (0 when none / no projection). */
  open: number;
}

/** An org-authored standard and how far it has actually travelled. */
export interface LibraryStandard {
  id: string;
  title: string;
  dimId: string;
  repos: number;
  lift: number | null;
}

export interface PracticeLibrarySummary {
  org: string;
  generatedOn: string;
  /** Library size: authored standards + mined practices. */
  total: number;
  authored: number;
  mined: number;
  /**
   * Fleet adoption of the MINED library, counted over repo·practice pairs: how many pairs already
   * embody the practice (score ≥ the strong floor) out of every pair that is actually scored. Null
   * when nothing is measurable yet (no scans), so the tile em-dashes instead of claiming 0%.
   */
  adoption: { strong: number; measured: number; pct: number } | null;
  /** Distinct repos that could adopt at least one practice, and how many practices carry a gap. */
  couldAdopt: { repos: number; practices: number };
  /**
   * Starter-PR rollout across the whole library. Null when NO practice carries the `prs` projection
   * (never applied in this org). `lift` is the unweighted mean of the per-practice measured lifts —
   * per-practice lift is itself an average over verified merges whose count the projection doesn't
   * expose, so weighting is not available; `liftPractices` says how many practices backed it.
   */
  rollout: { open: number; merged: number; lift: number | null; liftPractices: number } | null;
  /** Biggest reuse opportunities first (same ordering getOrgPractices already sorts by). */
  opportunities: LibraryOpportunity[];
  /** The org's own standards, most-adopted first. */
  standards: LibraryStandard[];
}

const OPPORTUNITY_LIMIT = 6;
const STANDARD_LIMIT = 8;

export function buildPracticeLibrarySummary(
  org: string,
  practices: OrgPractice[],
  playbooks: PlaybookRow[],
  adoption: Record<string, PlaybookAdoption>,
): PracticeLibrarySummary {
  let strong = 0;
  let measured = 0;
  const gapRepos = new Set<string>();
  let gapPractices = 0;

  let open = 0;
  let merged = 0;
  let liftSum = 0;
  let liftPractices = 0;
  let anyRollout = false;

  for (const p of practices) {
    strong += p.strongCount;
    measured += p.total;
    if (p.gapRepoRefs.length > 0) {
      gapPractices += 1;
      for (const r of p.gapRepoRefs) gapRepos.add(r.fullName);
    }
    if (p.prs) {
      anyRollout = true;
      open += p.prs.open;
      merged += p.prs.merged;
      if (p.prs.lift != null) {
        liftSum += p.prs.lift;
        liftPractices += 1;
      }
    }
  }

  const opportunities: LibraryOpportunity[] = practices
    .filter((p) => p.gapRepoRefs.length > 0)
    .slice(0, OPPORTUNITY_LIMIT)
    .map((p) => ({
      id: p.id,
      label: p.label,
      dimId: p.dimId,
      exemplar: p.exemplar?.fullName ?? null,
      couldAdopt: p.gapRepoRefs.length,
      open: p.prs?.open ?? 0,
    }));

  const standards: LibraryStandard[] = playbooks
    .map((pb) => ({
      id: pb.id,
      title: pb.title,
      dimId: pb.dimId,
      repos: adoption[pb.id]?.repos ?? 0,
      lift: adoption[pb.id]?.lift ?? null,
    }))
    .sort((a, b) => b.repos - a.repos || a.title.localeCompare(b.title))
    .slice(0, STANDARD_LIMIT);

  return {
    org,
    generatedOn: new Date().toISOString().slice(0, 10),
    total: practices.length + playbooks.length,
    authored: playbooks.length,
    mined: practices.length,
    adoption: measured > 0 ? { strong, measured, pct: Math.round((strong / measured) * 100) } : null,
    couldAdopt: { repos: gapRepos.size, practices: gapPractices },
    rollout: anyRollout
      ? { open, merged, lift: liftPractices > 0 ? Math.round(liftSum / liftPractices) : null, liftPractices }
      : null,
    opportunities,
    standards,
  };
}

/**
 * The library's Copy-for-LLM brief — same shape as governanceMarkdown / adoptionMarkdown (title +
 * dateline, themed `##` sections, a closing `## Ask`). The Ask is deliberately in EXPLORATION voice:
 * the library is a set of options a lead weighs with their teams, not a queue to execute, so the brief
 * hands over inputs to explore rather than orders to carry out.
 */
export function practiceLibraryMarkdown(s: PracticeLibrarySummary): string {
  const out: string[] = [];
  out.push(`# Practice library: ${s.org}`);
  out.push(`Generated ${s.generatedOn}`);
  out.push("");
  out.push("## Library");
  out.push(`- ${s.total} practices: ${s.authored} org-authored standard${s.authored === 1 ? "" : "s"} · ${s.mined} mined from scans`);
  if (s.adoption) {
    out.push(
      `- Fleet adoption: ${s.adoption.pct}% of scored repo·practice pairs already embody the practice (${s.adoption.strong}/${s.adoption.measured})`,
    );
  } else {
    out.push("- Fleet adoption: not measurable yet (no scored repositories behind the mined practices)");
  }
  out.push(
    `- ${s.couldAdopt.repos} repo${s.couldAdopt.repos === 1 ? "" : "s"} could adopt at least one practice, across ${s.couldAdopt.practices} practice${s.couldAdopt.practices === 1 ? "" : "s"}`,
  );

  // Optional by construction: absent when no practice has ever opened a starter PR. Omitted rather
  // than zeroed, so "never tried" is never reported as "tried and nothing landed".
  if (s.rollout) {
    out.push("");
    out.push("## Rollout (starter PRs)");
    out.push(
      `- ${s.rollout.open} in flight · ${s.rollout.merged} landed${
        s.rollout.lift != null
          ? ` · +${s.rollout.lift} avg measured dimension lift across ${s.rollout.liftPractices} practice${s.rollout.liftPractices === 1 ? "" : "s"}`
          : " · no post-merge lift measured yet"
      }`,
    );
  }

  if (s.opportunities.length) {
    out.push("");
    out.push("## Widest reuse gaps");
    for (const o of s.opportunities) {
      out.push(
        `- ${o.label} (${o.dimId}): ${o.couldAdopt} repo${o.couldAdopt === 1 ? "" : "s"} below the bar${
          o.exemplar ? ` · ${o.exemplar} already does it` : " · no exemplar in the fleet yet"
        }${o.open ? ` · ${o.open} starter PR${o.open === 1 ? "" : "s"} open` : ""}`,
      );
    }
  }

  if (s.standards.length) {
    out.push("");
    out.push("## Org-authored standards");
    for (const st of s.standards) {
      out.push(
        `- ${st.title} (${st.dimId}): adopted by ${st.repos} repo${st.repos === 1 ? "" : "s"}${st.lift != null ? ` · ${st.lift > 0 ? "+" : ""}${st.lift} avg ${st.dimId} since` : ""}`,
      );
    }
  }

  out.push("");
  out.push("## Ask");
  out.push(
    "These are inputs to explore, not a work queue. Reading this library: which gaps look systemic (many repos, one dimension) versus local to a repo or team; where an exemplar makes a practice cheap to copy and where there is none to copy from; whether any authored standard has stalled at low adoption and what that suggests about the standard itself; and what the measured lift so far does and does not tell us about whether the next rollout is worth the interruption. Surface the questions worth taking to the teams before proposing any change.",
  );
  return out.join("\n");
}

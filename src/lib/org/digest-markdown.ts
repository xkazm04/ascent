// Weekly digest → markdown in a leadership-update voice (the "Copy as markdown" payload).
//
// This is NOT `briefingMarkdown`. That one is a prompt: it ends with an explicit `## Ask` so a
// developer can paste it into an LLM and get actions back. This one is the finished artifact a lead
// pastes into a channel or a board update, so it ends with its own provenance instead of a request —
// there is deliberately no `## Ask` section here, and a test pins its absence.
//
// Two rules govern the shape:
//
//   1. NEVER a header with no rows under it. An empty "## Follow-ups" reads as "we checked and there
//      was nothing", which is a different claim from "we could not check". Sections whose content is
//      absent are omitted; content that is UNKNOWN says so in words (the "not measurable" line, the
//      "—" dimension cell, the footer notes) rather than rendering as a zero.
//   2. Node-safe. This file is imported by a scheduled job and by unit tests under the node
//      environment, so it imports nothing from `@/components` — the sign formatter below is local
//      rather than the UI package's, deliberately.

import type { DigestFollowups, DigestFollowupRow, DigestMover, WeeklyDigest } from "./digest-types";

/** `+4` / `-3` / `0` — never `+0`, which reads as a small gain rather than as no movement. Local on
 *  purpose: the UI formatter lives behind a client boundary this module must not cross. */
function sign(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

const repositories = (n: number): string => `${n} repositor${n === 1 ? "y" : "ies"}`;

/** The one-line form of a closed/opened follow-up: `- <title> — <repo> (<dimId>)`. */
const followupLine = (r: DigestFollowupRow): string => `  - ${r.title} — ${r.repo} (${r.dimId})`;

const moverLine = (arrow: string, m: DigestMover): string =>
  `- ${arrow} ${m.name}: ${sign(m.dOverall)}${m.levelFrom !== m.levelTo ? ` (${m.levelFrom}→${m.levelTo})` : ""}`;

/** The dimension table's "This week" cell — the band's WORD, not a bare number, so a delta inside the
 *  noise band cannot be read as a real move and an unmeasured one cannot be read as zero. */
function weekCell(delta: number | null, band: string): string {
  if (band === "unmeasured" || delta == null) return "—";
  if (band === "flat") return "flat (within noise)";
  return sign(delta);
}

/** The closed line's provenance breakdown, e.g. `(3 by rescan, 1 by hand)`.
 *
 *  Printed ONLY when the sample rows are the complete set of closures. `closedRows` is capped by the
 *  query's `limit`, so on a busy week the split would be over 5 of 30 events and "Closed this week: 30
 *  (3 by rescan, 2 by hand)" would invite the reader to do arithmetic that does not hold. A missing
 *  breakdown is a small loss; a breakdown that does not add up discredits the whole update. */
function closedBreakdown(f: DigestFollowups): string {
  if (f.closedRows.length !== f.closed || f.closed === 0) return "";
  const byScan = f.closedRows.filter((r) => r.how === "scan").length;
  const byHand = f.closedRows.filter((r) => r.how === "human").length;
  return ` (${byScan} by rescan, ${byHand} by hand)`;
}

function standingDelta(h: WeeklyDigest["headline"]): string {
  if (h.dOverall == null || h.cohortSize == null) return "";
  // The denominator travels with the delta, always: "−4 points" over 4 matched repositories out of 60
  // renders identically to "−4" over 58 unless the cohort ships beside it.
  const qualifiers = [
    `measured over ${repositories(h.cohortSize)} scanned on both sides of the week`,
    ...(h.onboarded > 0 ? [`${h.onboarded} onboarded`] : []),
    ...(h.departed > 0 ? [`${h.departed} departed`] : []),
  ].join("; ");
  return ` · ${sign(h.dOverall)} this week (${qualifiers})`;
}

/** Serialize a digest to a self-contained markdown update a lead can paste as-is. */
export function weeklyDigestMarkdown(d: WeeklyDigest): string {
  const out: string[] = [];
  const h = d.headline;

  out.push(`# Weekly digest: ${d.org} · ${d.window.from} → ${d.window.to}`);
  const coverage = [
    `Generated ${d.generatedOn}`,
    `${h.scanned}/${h.total} repositories scanned`,
    // Null means the count could not be read — omit the clause rather than print "0 scans this week",
    // which would assert a quiet week the digest has no evidence for.
    ...(d.provenance.scansInWindow != null ? [`${d.provenance.scansInWindow} scans this week`] : []),
    ...(d.provenance.engineCaveat ? [`⚠ ${d.provenance.engineCaveat}`] : []),
  ];
  out.push(coverage.join(" · "));

  out.push("");
  out.push("## Standing");
  out.push(`- Overall **${h.overall}/100** (${h.levelId} ${h.levelName})${standingDelta(h)}`);
  const axis = (label: string, value: number, delta: number | null) =>
    `${label} ${value} (${delta == null ? "—" : sign(delta)})`;
  out.push(`- ${axis("AI Adoption", h.adoption, h.dAdoption)} · ${axis("Engineering Rigor", h.rigor, h.dRigor)}`);

  if (d.dims.length) {
    out.push("");
    out.push("## Score deltas per dimension");
    out.push("| Dimension | Now | This week |");
    out.push("|---|---:|---:|");
    for (const dim of d.dims) out.push(`| ${dim.dimId} ${dim.label} | ${dim.now} | ${weekCell(dim.delta, dim.band)} |`);
  }

  const f = d.followups;
  if (f) {
    out.push("");
    out.push("## Follow-ups");
    const dismissed = f.dismissed > 0 ? ` · Dismissed: ${f.dismissed}` : "";
    out.push(`- Closed this week: ${f.closed}${closedBreakdown(f)}${dismissed}`);
    for (const r of f.closedRows) out.push(followupLine(r));
    if (!f.openedMeasurable) {
      // The whole point of the unmeasurable branch: say WHY, and name the date the comparison would
      // have needed, so the reader knows this is a history gap and not a quiet week.
      out.push(
        `- Opened this week: not measurable — no repository has a scan from before ${d.window.from} to compare against.`,
      );
    } else {
      const excluded =
        f.unmeasuredRepos > 0 ? ` (${repositories(f.unmeasuredRepos)} had no earlier scan and are not counted)` : "";
      out.push(`- Opened this week: ${f.opened}${excluded}`);
      for (const r of f.openedRows) out.push(followupLine(r));
    }
  }

  if (d.actions.length) {
    out.push("");
    out.push("## Next three actions");
    d.actions.forEach((a, i) => {
      // Rank 1 is the fleet's single ranked next move — the same sentence the executive briefing
      // prints — and is labelled as such so a skimming reader takes the right one.
      out.push(i === 0 ? `${i + 1}. **Recommended next move** — ${a.line}` : `${i + 1}. ${a.line}`);
    });
  }

  const mv = d.movement;
  if (mv && (mv.gainers.length || mv.regressers.length)) {
    out.push("");
    out.push("## Repository movement");
    for (const m of mv.gainers) out.push(moverLine("▲", m));
    for (const m of mv.regressers) out.push(moverLine("▼", m));
    if (mv.compared > 0) out.push(`- ${repositories(mv.compared)} compared`);
  }

  out.push("");
  out.push("---");
  // The footer carries the method, not a sign-off: the window's closure, what the averages are over,
  // and what the deltas actually compared — plus every degraded read, so a thin digest is legible as
  // "we could not look" rather than as "nothing happened".
  const notes = d.provenance.notes.length ? ` · ${d.provenance.notes.join(" ")}` : "";
  out.push(
    `Ascent weekly digest · window [${d.window.from}, ${d.window.to}] in the org's canonical zone · ` +
      `fleet averages over scanned repositories; deltas compare each repository's latest scan with its ` +
      `latest scan before ${d.window.from}.${notes}`,
  );

  return out.join("\n");
}

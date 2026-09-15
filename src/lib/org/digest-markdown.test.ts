// The digest's markdown serializer. It is the artifact a lead actually pastes somewhere, so the
// assertions are about what a READER would conclude: section order, the words that carry a hedge
// ("flat (within noise)", "—", "not measurable"), and the absence of the briefing's `## Ask` — this
// is a finished update, not a prompt.

import { describe, expect, it } from "vitest";
import { weeklyDigestMarkdown } from "@/lib/org/digest-markdown";
import type { WeeklyDigest } from "@/lib/org/digest-types";

const base: WeeklyDigest = {
  org: "acme",
  generatedOn: "2026-09-01",
  window: {
    from: "2026-08-26",
    to: "2026-09-01",
    start: "2026-08-26T00:00:00.000Z",
    endExclusive: "2026-09-02T00:00:00.000Z",
    title: "2026-08-26 → 2026-09-01",
  },
  headline: {
    overall: 61,
    adoption: 58,
    rigor: 64,
    levelId: "L3",
    levelName: "Systematic",
    dOverall: 4,
    dAdoption: 3,
    dRigor: 5,
    cohortSize: 8,
    onboarded: 1,
    departed: 0,
    scanned: 9,
    total: 12,
  },
  dims: [
    { dimId: "D1", label: "AI Tooling & Conventions", now: 52, delta: 6, band: "up" },
    { dimId: "D3", label: "CI/CD & Delivery", now: 44, delta: null, band: "unmeasured" },
    { dimId: "D9", label: "Supply Chain & Security", now: 70, delta: 1, band: "flat" },
  ],
  followups: {
    closed: 2,
    dismissed: 1,
    closedRows: [
      { title: "No dependency review", dimId: "D9", dimLabel: "Supply Chain & Security", repo: "acme/api", at: "2026-08-29T10:00:00.000Z", how: "human" },
      { title: "No CI on main", dimId: "D3", dimLabel: "CI/CD & Delivery", repo: "acme/web", at: "2026-08-28T10:00:00.000Z", how: "scan" },
    ],
    opened: 3,
    openedRows: [
      { title: "Missing AI manifest", dimId: "D1", dimLabel: "AI Tooling & Conventions", repo: "acme/cli", at: null, how: null },
    ],
    openedMeasurable: true,
    unmeasuredRepos: 1,
  },
  actions: [
    { rank: 1, title: "Adopt dependency review", dimId: "D9", dimLabel: "Supply Chain & Security", impact: "high", repoCount: 5, projectedPoints: 7, liftsRepos: 2, line: "Adopt dependency review: the widest shared gap across the fleet." },
    { rank: 2, title: "Write a contributing guide", dimId: "D3", dimLabel: "CI/CD & Delivery", impact: "medium", repoCount: 1, projectedPoints: 3, liftsRepos: 0, line: "Write a contributing guide (D3 CI/CD & Delivery, medium impact, 1 repository, ≈ +3 pts each)" },
    { rank: 3, title: "Pin the toolchain", dimId: "D4", dimLabel: "Agentic Workflows", impact: "low", repoCount: 4, projectedPoints: null, liftsRepos: 0, line: "Pin the toolchain (D4 Agentic Workflows, low impact, 4 repositories)" },
  ],
  movement: {
    gainers: [{ name: "api", fullName: "acme/api", dOverall: 9, levelFrom: "L2", levelTo: "L3" }],
    regressers: [{ name: "legacy", fullName: "acme/legacy", dOverall: -7, levelFrom: "L3", levelTo: "L2" }],
    compared: 8,
  },
  provenance: { scansInWindow: 14, engineCaveat: null, notes: [] },
};

const digest = (over: Partial<WeeklyDigest> = {}): WeeklyDigest => ({ ...base, ...over });
const lines = (d: WeeklyDigest) => weeklyDigestMarkdown(d).split("\n");
const headers = (d: WeeklyDigest) => lines(d).filter((l) => l.startsWith("## "));

describe("weeklyDigestMarkdown", () => {
  it("emits the sections in a fixed order", () => {
    expect(headers(digest())).toEqual([
      "## Standing",
      "## Score deltas per dimension",
      "## Follow-ups",
      "## Next three actions",
      "## Repository movement",
    ]);
  });

  it("is a finished update, not a prompt — there is no Ask", () => {
    const md = weeklyDigestMarkdown(digest());
    expect(md).not.toContain("## Ask");
    expect(md.toLowerCase()).not.toContain("paste this into");
  });

  it("titles the digest with the org and the window, and states coverage under it", () => {
    const l = lines(digest());
    expect(l[0]).toBe("# Weekly digest: acme · 2026-08-26 → 2026-09-01");
    expect(l[1]).toBe("Generated 2026-09-01 · 9/12 repositories scanned · 14 scans this week");
  });

  it("carries the cohort denominator and the excluded composition change beside the headline delta", () => {
    const l = lines(digest());
    expect(l).toContain(
      "- Overall **61/100** (L3 Systematic) · +4 this week (measured over 8 repositories scanned on both sides of the week; 1 onboarded)",
    );
    expect(l).toContain("- AI Adoption 58 (+3) · Engineering Rigor 64 (+5)");
  });

  it("prints an em dash for a missing axis delta rather than a zero", () => {
    const d = digest({ headline: { ...base.headline, dOverall: null, dAdoption: null, dRigor: null, cohortSize: null } });
    const l = lines(d);
    expect(l).toContain("- AI Adoption 58 (—) · Engineering Rigor 64 (—)");
    // No cohort clause when there is no delta to qualify.
    expect(l).toContain("- Overall **61/100** (L3 Systematic)");
  });

  it("gives the noise band and the unmeasured cell WORDS, not numbers", () => {
    const l = lines(digest());
    expect(l).toContain("| D1 AI Tooling & Conventions | 52 | +6 |");
    expect(l).toContain("| D3 CI/CD & Delivery | 44 | — |");
    // +1 is inside the band. A reader must not be able to mistake it for a real move.
    expect(l).toContain("| D9 Supply Chain & Security | 70 | flat (within noise) |");
  });

  it("never writes +0 for a zero delta", () => {
    const d = digest({ dims: [{ dimId: "D1", label: "AI Tooling & Conventions", now: 52, delta: 0, band: "up" }] });
    expect(lines(d)).toContain("| D1 AI Tooling & Conventions | 52 | 0 |");
  });

  it("reports closed and dismissed separately, and splits closures by how they happened", () => {
    const l = lines(digest());
    expect(l).toContain("- Closed this week: 2 (1 by rescan, 1 by hand) · Dismissed: 1");
    expect(l).toContain("  - No dependency review — acme/api (D9)");
  });

  it("omits the by-rescan/by-hand split when the sample rows are not the whole set", () => {
    // 30 closures with 2 sample rows: printing "(1 by rescan, 1 by hand)" would invite arithmetic
    // that does not hold, which discredits the whole update.
    const d = digest({ followups: { ...base.followups!, closed: 30 } });
    expect(lines(d)).toContain("- Closed this week: 30 · Dismissed: 1");
  });

  it("names the repositories the opened diff could not speak for", () => {
    expect(lines(digest())).toContain(
      "- Opened this week: 3 (1 repository had no earlier scan and are not counted)",
    );
  });

  it("says NOT MEASURABLE, with the reason and the date, rather than reporting zero opened", () => {
    const d = digest({ followups: { ...base.followups!, opened: 0, openedRows: [], openedMeasurable: false, unmeasuredRepos: 9 } });
    const l = lines(d);
    expect(l).toContain(
      "- Opened this week: not measurable — no repository has a scan from before 2026-08-26 to compare against.",
    );
    expect(l.some((x) => x === "- Opened this week: 0")).toBe(false);
  });

  it("omits the whole follow-up section when the read was unavailable — never an empty header", () => {
    const d = digest({ followups: null, provenance: { ...base.provenance, notes: ["Follow-up activity could not be read."] } });
    expect(headers(d)).not.toContain("## Follow-ups");
    // The absence is explained in the footer instead of being silent.
    expect(weeklyDigestMarkdown(d)).toContain("Follow-up activity could not be read.");
  });

  it("labels rank 1 as the recommended next move and leaves 2 and 3 plain", () => {
    const l = lines(digest());
    expect(l).toContain("1. **Recommended next move** — Adopt dependency review: the widest shared gap across the fleet.");
    expect(l).toContain("2. Write a contributing guide (D3 CI/CD & Delivery, medium impact, 1 repository, ≈ +3 pts each)");
    expect(l).toContain("3. Pin the toolchain (D4 Agentic Workflows, low impact, 4 repositories)");
  });

  it("renders movement with arrows, level transitions, and the compared count", () => {
    const l = lines(digest());
    expect(l).toContain("- ▲ api: +9 (L2→L3)");
    expect(l).toContain("- ▼ legacy: -7 (L3→L2)");
    expect(l).toContain("- 8 repositories compared");
  });

  it("drops the movement section entirely when nothing moved either way", () => {
    const d = digest({ movement: { gainers: [], regressers: [], compared: 8 } });
    expect(headers(d)).not.toContain("## Repository movement");
  });

  it("surfaces the engine caveat on the coverage line", () => {
    const d = digest({ provenance: { ...base.provenance, engineCaveat: "all scores this period used the deterministic mock engine, not the live model" } });
    expect(lines(d)[1]).toContain("⚠ all scores this period used the deterministic mock engine");
  });

  it("omits the scan count when it could not be read, rather than printing 0", () => {
    const d = digest({ provenance: { ...base.provenance, scansInWindow: null } });
    expect(lines(d)[1]).toBe("Generated 2026-09-01 · 9/12 repositories scanned");
  });

  it("closes with the method and every degraded read", () => {
    const d = digest({ provenance: { ...base.provenance, notes: ["Repository movement could not be read."] } });
    const l = lines(d);
    expect(l[l.length - 2]).toBe("---");
    expect(l[l.length - 1]).toBe(
      "Ascent weekly digest · window [2026-08-26, 2026-09-01] in the org's canonical zone · " +
        "fleet averages over scanned repositories; deltas compare each repository's latest scan with its " +
        "latest scan before 2026-08-26. · Repository movement could not be read.",
    );
  });
});

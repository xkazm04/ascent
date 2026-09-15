// The Conformance Pack as a filed artifact (W2).
//
// Two serializations, both from the same `ConformancePack` object so they can never disagree:
//   - `packSampleCsv` / `packFindingsCsv` — the two tables an examiner works in a spreadsheet.
//   - `packManifestMarkdown` — the cover note: what this evidences, the method, the seed, the
//     limitations, and the integrity hashes.
//
// Every table goes through the canonical `csvTable` (src/lib/export/csv.ts) so it inherits the
// formula-injection guard and RFC-4180 quoting the whole export surface shares — a pack is the LAST
// place to hand-roll a CSV writer, since a PR title is attacker-influenced text that lands straight
// in a cell an auditor opens in Excel.

import { csvTable } from "@/lib/export/csv";
import { sha256Hex } from "@/lib/db/audit-integrity";
import type { ConformancePack, SampledItem } from "@/lib/conformance/pack";

const ITEM_HEADER = [
  "repository",
  "pr_number",
  "title_omitted",
  "author",
  "author_is_bot",
  "ai_signal",
  "ai_tools",
  "state",
  "created_at",
  "merged_at",
  "control_verdict",
  "approver",
  "approved_at",
  "review_count",
  "required_approvals",
  "requires_codeowner_review",
  "requires_status_checks",
  "protected_branch",
  // MOONSHOT #1 — the as-of-merge columns. `environment_as_of_source` is the one an examiner should
  // read FIRST on any row: "ledger" means the four columns above describe the settings in force when
  // this change merged, "latest-scan" means they describe the repository as it is now and the merge
  // could have happened under different ones. Putting the label in the row is what makes the
  // distinction survive a spreadsheet sort.
  "environment_as_of_source",
  "environment_as_of_observed_at",
  "environment_as_of_branch_protection",
  "environment_as_of_required_approvals",
  "evidence_source",
  "approval_observed_at",
  "note",
] as const;

/**
 * PR TITLES ARE DELIBERATELY OMITTED from the CSV rows. They are free text from the repository and
 * routinely carry ticket ids, customer names and internal system names; a pack is filed with a third
 * party, so the row identifies the change by `repository` + `pr_number` — which is sufficient to
 * re-verify it against GitHub — and nothing more. The column is kept, named for what it is, so the
 * omission is visible rather than looking like a missing field.
 */
function itemRow(i: SampledItem): unknown[] {
  return [
    i.repoFullName,
    i.prNumber,
    "(omitted, identify via repository + pr_number)",
    i.author,
    i.authorIsBot,
    i.aiSignal,
    i.aiTools,
    i.state,
    i.createdAt,
    i.mergedAt ?? "",
    i.verdict,
    i.approver ?? "",
    i.approvedAt ?? "",
    i.reviewCount,
    i.environment?.requiredApprovals ?? "",
    i.environment?.requiresCodeOwnerReview ?? "",
    i.environment?.requiresStatusChecks ?? "",
    i.environment?.protectedBranch ?? "",
    i.environmentAsOf.source,
    i.environmentAsOf.observedAt ?? "",
    // The as-of controls come out of the ledger's own vocabulary. An empty cell is "this control was
    // not in the environment we resolved" — never a `false`, which would assert an observation.
    i.environmentAsOf.controls["branch-protection"]?.state ?? "",
    i.environmentAsOf.controls["required-approvals"]?.value ?? "",
    i.evidenceSource,
    i.approvalObservedAt ?? "",
    i.note,
  ];
}

export function packSampleCsv(pack: ConformancePack): string {
  return csvTable(ITEM_HEADER, pack.sample.items.map(itemRow));
}

export function packFindingsCsv(pack: ConformancePack): string {
  return csvTable(ITEM_HEADER, pack.findings.map(itemRow));
}

const pct = (n: number, d: number): string => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

/**
 * The cover note. Written in the auditor's own vocabulary (population / sample / per-item evidence),
 * and it states every limitation BEFORE the numbers rather than in a footnote — an examiner who
 * discovers a caveat after relying on a figure will not trust the next artifact.
 */
export function packManifestMarkdown(pack: ConformancePack, hashes: { sample: string; findings: string }): string {
  const p = pack.population;
  const lines: string[] = [];

  lines.push(`# AI change-management evidence pack: ${pack.org}`);
  lines.push("");
  lines.push(`**Period:** ${pack.period.label} (${pack.period.from} → ${pack.period.to})`);
  if (pack.observed.from && pack.observed.to) {
    lines.push(`**Rows span:** ${pack.observed.from.slice(0, 10)} → ${pack.observed.to.slice(0, 10)}`);
  }
  lines.push(`**Generated:** ${pack.provenance.generatedAt}`);
  lines.push(`**Identities:** ${pack.provenance.identityMode}`);
  lines.push("");

  lines.push("## What this is (and is not)");
  lines.push("");
  lines.push(pack.attestation.purpose);
  lines.push("");
  lines.push(pack.attestation.control);
  lines.push("");
  lines.push(pack.attestation.notAiAct);
  lines.push("");

  lines.push("## Read these limitations first");
  lines.push("");
  for (const l of pack.limitations) lines.push(`- ${l}`);
  lines.push("");

  lines.push("## Population");
  lines.push("");
  lines.push("| Measure | Value |");
  lines.push("| --- | --- |");
  lines.push(`| AI-attributed changes in period | ${p.total} |`);
  lines.push(`| Of which merged | ${p.merged} |`);
  lines.push(`| Merged WITH an approving human review | ${p.governed} (${pct(p.governed, p.merged)} of merged) |`);
  lines.push(`| Merged WITHOUT one: findings | ${p.ungoverned} (${pct(p.ungoverned, p.merged)} of merged) |`);
  lines.push(`| Of those, reviewed but not approved | ${p.reviewedNotApproved} |`);
  lines.push(`| Authored by an AI agent | ${p.agentAuthored} |`);
  lines.push(`| Marked as AI-assisted by a human author | ${p.markedByHuman} |`);
  lines.push(`| Repositories contributing rows | ${p.repos} |`);
  lines.push("");

  // MOONSHOT #1 — the coverage statement. Stated as a table with its denominator visible, because
  // "the controls operated" read off an unknown number of observations is the exact claim this whole
  // ledger exists to stop the product from making.
  const cov = pack.environmentCoverage;
  lines.push("## Control-environment coverage");
  lines.push("");
  lines.push(
    "Each merged row's control environment is either the settings OBSERVED at or before the moment it " +
      "merged (`ledger`), or the repository's most recent scanned settings (`latest-scan`). The two are " +
      "not equivalent evidence; every row in the CSVs carries its own label.",
  );
  lines.push("");
  lines.push("| Measure | Value |");
  lines.push("| --- | --- |");
  lines.push(`| Merged rows | ${cov.mergedRows} |`);
  lines.push(`| With as-of-merge evidence (\`ledger\`) | ${cov.fromLedger} (${pct(cov.fromLedger, cov.mergedRows)}) |`);
  lines.push(`| Falling back to latest scan | ${cov.fromLatestScan} (${pct(cov.fromLatestScan, cov.mergedRows)}) |`);
  lines.push(`| As-of lookups attempted (ceiling ${cov.cap}) | ${cov.attempted} |`);
  lines.push("");

  // MC-B14 — the seal root the as-of-merge evidence above rests on, quoted in the artifact that is
  // filed. The recipe is published by /api/audit/verify and the rows by
  // /api/org/controls?format=csv, so this section is what joins a filed pack to a check an examiner
  // can run without us.
  const seal = pack.ledgerSeal;
  lines.push("## Ledger integrity");
  lines.push("");
  if (!seal || !seal.root) {
    lines.push(
      "The control-observation rows behind this pack's as-of-merge evidence carry **no integrity root** for " +
        "this period. Nothing here is contradicted by that — but nothing here is independently checkable " +
        "against one either.",
    );
  } else {
    lines.push(
      "The as-of-merge control settings in this pack are read from Ascent's control-observation ledger. That " +
        "ledger is chained daily: each closed UTC day carries a sha256 root over its rows plus the previous " +
        "day's root. The root below is the newest one covering this period.",
    );
    lines.push("");
    lines.push("| Measure | Value |");
    lines.push("| --- | --- |");
    lines.push(`| Chain verified through | ${seal.throughDay} |`);
    lines.push(`| Root (sha256) | \`${seal.root}\` |`);
    lines.push(`| Days chained in period | ${seal.daysSealed} (${seal.daysVerified} recomputed cleanly) |`);
    lines.push(`| Chain intact | ${seal.chainOk ? "yes" : "**NO — see below**"} |`);
    lines.push(`| Days holding rows not yet chained | ${seal.unsealedDays} |`);
    lines.push("");
    lines.push(
      seal.chainOk
        ? "Recompute it yourself: download the rows from `/api/org/controls?org=…&format=csv` (columns are the " +
            "digest's canonical field order) and follow the recipe published at `/api/audit/verify?org=…`. No key " +
            "of ours is needed."
        : "**At least one chained day no longer recomputes to its stored root, or its link to the preceding day " +
            "does not match.** Rows in this period were altered or removed after they were chained. Treat the " +
            "as-of-merge evidence in this pack as unverified until that is explained.",
    );
    lines.push("");
    lines.push(
      "Limit, stated rather than left implied: the roots are produced by Ascent and stored alongside the rows, " +
        "so they detect alteration by anything WITHOUT database write access. They are not claimed to detect an " +
        "operator with database access re-chaining a rewritten day.",
    );
  }
  lines.push("");

  lines.push("## Sample");
  lines.push("");
  lines.push(pack.attestation.method);
  lines.push("");
  lines.push(`- **Seed:** \`${pack.sample.seed}\``);
  lines.push(`- **Algorithm:** ${pack.sample.algorithm}`);
  lines.push(`- **Requested size:** ${pack.sample.requested}`);
  lines.push(`- **Drawn:** ${pack.sample.size}${pack.sample.exhaustive ? " (population inspected in full)" : ""}`);
  lines.push("");
  lines.push("Re-running this export for the same organization and period reproduces the same sample.");
  lines.push("");

  if (pack.provenance.engines.length > 0) {
    lines.push("## Provenance of the underlying scans");
    lines.push("");
    lines.push("| Engine | Model | Repositories |");
    lines.push("| --- | --- | --- |");
    for (const e of pack.provenance.engines) lines.push(`| ${e.provider} | ${e.model || "—"} | ${e.repos} |`);
    lines.push("");
  }

  lines.push("## Integrity");
  lines.push("");
  lines.push("Recompute these over the downloaded files to confirm they were not altered after export.");
  lines.push("");
  lines.push(`- \`sample.csv\` SHA-256: \`${hashes.sample}\``);
  lines.push(`- \`findings.csv\` SHA-256: \`${hashes.findings}\``);
  lines.push("");

  return lines.join("\n");
}

/** The three files, with the manifest's hashes computed over the exact bytes the caller receives. */
export function packFiles(pack: ConformancePack): { manifest: string; sample: string; findings: string } {
  const sample = packSampleCsv(pack);
  const findings = packFindingsCsv(pack);
  const manifest = packManifestMarkdown(pack, { sample: sha256Hex(sample), findings: sha256Hex(findings) });
  return { manifest, sample, findings };
}

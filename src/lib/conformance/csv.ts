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
    "(omitted — identify via repository + pr_number)",
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

  lines.push(`# AI change-management evidence pack — ${pack.org}`);
  lines.push("");
  lines.push(`**Period:** ${pack.period.label} (${pack.period.from} → ${pack.period.to})`);
  if (pack.observed.from && pack.observed.to) {
    lines.push(`**Rows span:** ${pack.observed.from.slice(0, 10)} → ${pack.observed.to.slice(0, 10)}`);
  }
  lines.push(`**Generated:** ${pack.provenance.generatedAt}`);
  lines.push(`**Identities:** ${pack.provenance.identityMode}`);
  lines.push("");

  lines.push("## What this is — and is not");
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
  lines.push(`| — of which merged | ${p.merged} |`);
  lines.push(`| Merged WITH an approving human review | ${p.governed} (${pct(p.governed, p.merged)} of merged) |`);
  lines.push(`| Merged WITHOUT one — findings | ${p.ungoverned} (${pct(p.ungoverned, p.merged)} of merged) |`);
  lines.push(`| — of those, reviewed but not approved | ${p.reviewedNotApproved} |`);
  lines.push(`| Authored by an AI agent | ${p.agentAuthored} |`);
  lines.push(`| Marked as AI-assisted by a human author | ${p.markedByHuman} |`);
  lines.push(`| Repositories contributing rows | ${p.repos} |`);
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

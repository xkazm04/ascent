// Deterministic security check battery — the auditable core of the Security (D9) score. Modeled on
// OpenSSF Scorecard: a set of risk-weighted controls, each GRADED 0..10 by how effectively it's in
// place (not merely "a file exists"), aggregated into a posture score; a separate EXPOSURE axis folds
// current known vulnerabilities. The number is a transparent weighted mean of these checks — no LLM in
// the loop (the LLM writes narrative on top). Pure over its inputs (snapshot + governance + posture +
// exposure), so it's reproducible and unit-testable.
//
// Deliberately NOT a full Scorecard reimplementation — it covers the highest-signal checks evaluable
// from committed files + the GitHub state we already fetch. Signed-releases is a config PROXY (release-
// signing wired in CI), not Releases-API asset inspection; noted honestly in its evidence.
//
// The battery also takes an optional installed-App inventory (the Apps that posted a check suite on the
// scored commit). It closes the "security lives in Settings, not in the repo" blind spot that floored
// default-setup CodeQL repos at SAST 0 (flask, next.js — see docs/features/scanning/calibration.md, D9).
// The inventory is strictly ADDITIVE: a null inventory (anonymous scan, or the read failed) leaves every
// score byte-identical, and an observed App can only raise or fill in a check, never lower one. No new
// check was added for it — a fresh 0-default control would drag D9 for every token scan and open a
// token-vs-anonymous downward divergence, which is exactly the asymmetry this enrichment exists to avoid.

import type { Governance, RepoSnapshot, SecurityAssessment, SecurityCheck, SecurityExposure, SecurityPosture } from "@/lib/types";
import type { AppInventory } from "@/lib/github/check-suites";
import { appsOf } from "@/lib/github/check-suites";
import { hasDependencyBotCommits } from "@/lib/analyze";

const clamp10 = (n: number) => Math.max(0, Math.min(10, n));

/** All `.github/workflows/*` file contents (lower-cased), joined — the ingest now fetches them all. */
function workflowFiles(snap: RepoSnapshot): { path: string; content: string }[] {
  return snap.files
    .filter((f) => /^\.github\/workflows\/.+\.ya?ml$/i.test(f.path))
    .map((f) => ({ path: f.path, content: f.content }));
}

function hasPath(snap: RepoSnapshot, re: RegExp): boolean {
  return snap.tree.some((t) => re.test(t.path.toLowerCase()));
}

// ── Individual checks ────────────────────────────────────────────────────────
// Each returns {score: 0..10 | null, evidence, remediation?}. null = not applicable (excluded).

/** Branch protection — graded by how much is ENFORCED, not just "protected: true". */
function branchProtection(gov: Governance | null): { score: number | null; evidence: string; remediation?: string } {
  if (!gov || !gov.readable) return { score: null, evidence: "Branch protection not readable (no token/permission)." };
  if (!gov.protected) return { score: 0, evidence: `Default branch \`${gov.defaultBranch}\` is NOT protected.`, remediation: "Enable branch protection requiring PR review + status checks." };
  let s = 3; // protected at all
  const parts = ["protected"];
  if (gov.requiredApprovals >= 1) { s += 3; parts.push(`${gov.requiredApprovals} approval(s)`); }
  if (gov.requiresStatusChecks) { s += 2; parts.push("status checks"); }
  if (gov.requiresCodeOwnerReview) { s += 1; parts.push("code-owner review"); }
  if (gov.requiresSignatures) { s += 1; parts.push("signed commits"); }
  const rem = s < 8 ? "Require an approving review + passing status checks before merge." : undefined;
  return { score: clamp10(s), evidence: `Default branch: ${parts.join(", ")}.`, remediation: rem };
}

/**
 * Does any `permissions:` block in this workflow grant a broad WRITE scope on a sensitive key?
 *
 * Walks each block's indented body rather than pattern-matching one line after the header, so the key's
 * POSITION in the block is irrelevant. `contents: write` is the lever that matters (it can push to the
 * default branch); `packages`/`id-token`/`actions` write are the other commonly-abused broad grants.
 * A block ends at the first line indented at or above the `permissions:` key's own column.
 */
function hasBroadWriteGrant(content: string): boolean {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const header = /^(\s*)permissions:\s*$/.exec(lines[i] ?? "");
    if (!header) continue;
    const indent = header[1]!.length;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j] ?? "";
      if (!line.trim()) continue; // blank lines don't end a block
      const lead = /^\s*/.exec(line)![0].length;
      if (lead <= indent) break; // dedented out of the block
      if (/^\s*(contents|packages|id-token|actions)\s*:\s*write\s*$/i.test(line)) return true;
    }
  }
  return false;
}

/** Least-privilege workflow tokens — fraction of workflows that declare a top-level `permissions:`. */
function tokenPermissions(wf: { path: string; content: string }[]): { score: number | null; evidence: string; remediation?: string } {
  if (!wf.length) return { score: null, evidence: "No GitHub Actions workflows to scope." };
  let scoped = 0;
  let writeAll = 0;
  for (const w of wf) {
    // Match job-level (indented) `permissions:` blocks too, not just top-level (column 0). Job-scoped
    // least-privilege (`contents: read` on a job) is equally valid and was scored 0 by the old `^perm…`.
    if (/^\s*permissions:/m.test(w.content)) scoped += 1;
    // A broad grant counts wherever it sits in the block. The old `permissions:\s*\n\s+contents:\s*write`
    // required `contents: write` to be the FIRST key, so the extremely common
    // `permissions:\n  issues: read\n  contents: write` escaped the cap entirely and the workflow scored
    // as if it were least-privilege — the check's own headline number inverted for the case it exists to
    // catch. Scan the block's own indented body instead: from `permissions:` to the first line that
    // dedents back to the key's column or beyond.
    if (/permissions:\s*write-all/i.test(w.content) || hasBroadWriteGrant(w.content)) writeAll += 1;
  }
  let s = (scoped / wf.length) * 10;
  if (writeAll > 0) s = Math.min(s, 4); // an explicit write-all cap
  const rem = s < 8 ? "Add a least-privilege top-level `permissions:` block (default `contents: read`) to every workflow." : undefined;
  return { score: clamp10(s), evidence: `${scoped}/${wf.length} workflows set an explicit \`permissions:\` scope${writeAll ? `; ${writeAll} grant broad write` : ""}.`, remediation: rem };
}

/**
 * External base images a Dockerfile actually DEPENDS on — the only `FROM` lines that can carry a digest.
 *
 * A bare `/^from\s+\S+/` counted every FROM line, which pulled two un-pinnable shapes into the
 * denominator and scored a correctly-pinned repo down for them:
 *  • a multi-stage ALIAS reference (`FROM builder AS test`) points at a stage declared earlier in the
 *    same file — an internal reference, not a dependency, and `builder@sha256:…` is not a thing;
 *  • `FROM scratch` is the empty base image — there is nothing to pin.
 * Aliases are collected per-file from the `AS <name>` clauses, so a stage counts as internal only when
 * THIS Dockerfile declared it (a registry image that merely shares the name still counts as external).
 */
function externalBaseImages(content: string): string[] {
  const lines = [...content.matchAll(/^[ \t]*from[ \t]+(\S+)((?:[ \t]+as[ \t]+\S+)?)/gim)];
  const aliases = new Set(
    lines.map((m) => /[ \t]+as[ \t]+(\S+)/i.exec(m[2] ?? "")?.[1]?.toLowerCase()).filter((a): a is string => !!a),
  );
  return lines.map((m) => m[1]!).filter((image) => {
    const ref = image.toLowerCase();
    return ref !== "scratch" && !aliases.has(ref);
  });
}

/** Pinned dependencies — GitHub Actions pinned by full commit SHA vs a movable tag/branch. */
function pinnedDependencies(wf: { path: string; content: string }[], snap: RepoSnapshot): { score: number | null; evidence: string; remediation?: string } {
  const uses = wf.flatMap((w) => [...w.content.matchAll(/uses:\s*([\w.\-/]+)@([^\s#]+)/gi)]).filter((m) => m[1]!.includes("/"));
  const dockerfiles = snap.files.filter((f) => /(^|\/)(dockerfile|containerfile)$/i.test(f.path));
  const froms = dockerfiles.flatMap((f) => externalBaseImages(f.content));
  const total = uses.length + froms.length;
  if (total === 0) return { score: null, evidence: "No Actions/Docker dependencies to pin." };
  const shaPinned = uses.filter((m) => /^[0-9a-f]{40}$/i.test(m[2]!)).length;
  const digestPinned = froms.filter((image) => /@sha256:/i.test(image)).length;
  const pinned = shaPinned + digestPinned;
  const s = (pinned / total) * 10;
  const rem = s < 8 ? "Pin third-party Actions to a full commit SHA (and container images to a digest)." : undefined;
  return { score: clamp10(s), evidence: `${pinned}/${total} Actions/images pinned by SHA/digest (${uses.length} action refs).`, remediation: rem };
}

/** Dangerous workflow patterns — script injection + untrusted checkout on pull_request_target. */
function dangerousWorkflow(wf: { path: string; content: string }[]): { score: number | null; evidence: string; remediation?: string } {
  if (!wf.length) return { score: null, evidence: "No workflows to inspect." };
  const injection = /\$\{\{\s*github\.event\.(issue|pull_request|comment|review)[^}]*\.(body|title|head_ref|head\.ref)/i;
  const prTarget = /pull_request_target/i;
  const checkout = /uses:\s*actions\/checkout/i;
  const flagged: string[] = [];
  for (const w of wf) {
    if (injection.test(w.content)) flagged.push(`${w.path.split("/").pop()}: untrusted input in a run step`);
    else if (prTarget.test(w.content) && checkout.test(w.content)) flagged.push(`${w.path.split("/").pop()}: checks out code on pull_request_target`);
  }
  if (flagged.length) return { score: 0, evidence: `Dangerous pattern(s): ${flagged.join("; ")}.`, remediation: "Never interpolate untrusted event text into `run:`; don't checkout PR head on pull_request_target." };
  return { score: 10, evidence: "No script-injection or untrusted-checkout patterns detected." };
}

/** Comma-joined App slugs, for evidence text. */
const slugsOf = (apps: { slug: string }[]) => apps.map((a) => a.slug).join(", ");

/**
 * SAST — static analysis wired into CI, graded by whether it runs on PR/push vs manual-only.
 *
 * Committed workflows are only one of the two ways SAST is actually turned on. GitHub's *default setup*
 * CodeQL commits nothing at all — it is a Settings toggle that posts a `github-code-scanning` check
 * suite — and third-party scanners (Semgrep App, SonarCloud) are installed org-wide the same way. A
 * file-only detector therefore scored flask and next.js a hard 0 on a control they demonstrably run.
 * An observed sast-category App is direct evidence the control fires on the scored commit, so it earns
 * a 10 both where the committed evidence was absent (n/a) and where it was searched-for and missing (0).
 */
function sast(
  wf: { path: string; content: string }[],
  snap: RepoSnapshot,
  apps: AppInventory | null = null,
): { score: number | null; evidence: string; remediation?: string } {
  const sastApps = appsOf(apps, "sast");
  const appEvidence = `Code scanning App active on the scored commit (${slugsOf(sastApps)}).`;
  // No GitHub Actions workflows to inspect → n/a (excluded), not a 0. A hard 0 here conflated "no SAST"
  // with "no GitHub-native CI to look in", flooring elite off-GitHub repos (govulncheck/CodeQL may run
  // on Gerrit/LUCI). Mirrors dangerous-workflow / token-permissions, which already go n/a without workflows.
  if (!wf.length) {
    if (sastApps.length) return { score: 10, evidence: appEvidence };
    return { score: null, evidence: "No GitHub Actions workflows to inspect for SAST (may run off-GitHub)." };
  }
  const sastRe = /codeql|github\/codeql-action|semgrep|sonarcloud|sonarqube|sonarsource|snyk code/i;
  const hit = wf.find((w) => sastRe.test(w.content)) || (hasPath(snap, /^\.github\/workflows\/.*codeql/i) ? { content: "on: [pull_request]" } : null);
  if (!hit) {
    if (sastApps.length) return { score: 10, evidence: appEvidence };
    return { score: 0, evidence: "No SAST (CodeQL/Semgrep/Sonar) wired into CI.", remediation: "Add CodeQL (or Semgrep) scanning that runs on pull_request." };
  }
  const onPr = /on:[\s\S]{0,200}(pull_request|push)/i.test(hit.content);
  const also = sastApps.length ? `; also ${slugsOf(sastApps)} App` : "";
  // Committed SAST that doesn't clearly gate PRs (6) plus an App that fires on the commit anyway is a
  // gating control by observation — take the 10 and drop the remediation with it.
  if (!onPr && sastApps.length) return { score: 10, evidence: `SAST present but not clearly gating PRs${also} active on the scored commit.` };
  return { score: onPr ? 10 : 6, evidence: onPr ? `SAST runs on PR/push${also}.` : "SAST present but not clearly gating PRs.", remediation: onPr ? undefined : "Run SAST on pull_request so it gates merges." };
}

/** Dependency-update tool — Dependabot/Renovate configured. */
function dependencyUpdateTool(snap: RepoSnapshot, apps: AppInventory | null = null): { score: number | null; evidence: string; remediation?: string } {
  const has = hasPath(snap, /(^|\/)\.github\/dependabot\.ya?ml$/) || hasPath(snap, /(^|\/)(\.?renovaterc(\.json)?|renovate\.json5?)$/);
  if (has) return { score: 10, evidence: "Automated dependency updates configured (Dependabot/Renovate)." };
  // Behavioral fallback: Renovate/Dependabot is frequently enabled at the org/App level with no committed
  // file, yet its commits are all over the history — credit it (slightly below a committed config) so an
  // active bot isn't scored 0 just because its config lives off-repo (reference-scan P1-2).
  if (hasDependencyBotCommits(snap))
    return { score: 8, evidence: "Dependency-update bot active via org/App config (bot commits present; no committed file)." };
  // A supply-chain scanner App (Socket/Snyk/Wiz/GitGuardian) watches dependencies on every push but does
  // not OPEN update PRs, so it lands below a committed config or an observed bot — partial credit, and
  // the remediation stands: the repo still has nothing that proposes the upgrade.
  const chainApps = appsOf(apps, "supply-chain");
  if (chainApps.length)
    return {
      score: 6,
      evidence: `Supply-chain scanner App active on the scored commit (${slugsOf(chainApps)}); no dependency-update config committed.`,
      remediation: "Add a `.github/dependabot.yml` (or Renovate) config.",
    };
  return { score: 0, evidence: "No dependency-update tool committed.", remediation: "Add a `.github/dependabot.yml` (or Renovate) config." };
}

/** Security policy — SECURITY.md in the repo or inherited from the org's .github. */
function securityPolicy(snap: RepoSnapshot, posture: SecurityPosture | null): { score: number | null; evidence: string; remediation?: string } {
  const repoLocal = hasPath(snap, /(^|\/)security\.md$/);
  if (repoLocal) return { score: 10, evidence: "SECURITY.md documents a vulnerability-reporting path." };
  if (posture?.orgSecurityPolicy) return { score: 8, evidence: "Inherits an org-level SECURITY.md (no repo-local policy)." };
  // A disclosure PROGRAM (published advisories) is weak evidence of a process when no policy is committed.
  if (posture && posture.advisoryCount > 0) return { score: 6, evidence: `No committed SECURITY.md, but an active advisory program (${posture.advisoryCount} published).`, remediation: "Add a SECURITY.md with the disclosure process." };
  return { score: 0, evidence: "No security policy (SECURITY.md) found.", remediation: "Add a SECURITY.md describing how to report vulnerabilities." };
}

/** SBOM generation wired into CI. */
function sbom(wf: { path: string; content: string }[]): { score: number | null; evidence: string; remediation?: string } {
  if (!wf.length) return { score: null, evidence: "No GitHub Actions workflows to inspect for SBOM (may run off-GitHub)." };
  const has = wf.some((w) => /syft|cyclonedx|spdx|anchore\/sbom-action|\bsbom\b/i.test(w.content));
  return has ? { score: 10, evidence: "SBOM generation wired into CI." } : { score: 0, evidence: "No SBOM generation.", remediation: "Generate an SBOM (Syft/CycloneDX) on release." };
}

/** Signed releases — a CONFIG proxy (cosign/SLSA/attest in CI), not Releases-API asset inspection. */
function signedReleases(wf: { path: string; content: string }[]): { score: number | null; evidence: string; remediation?: string } {
  if (!wf.length) return { score: null, evidence: "No GitHub Actions workflows to inspect for release signing (may run off-GitHub)." };
  const has = wf.some((w) => /cosign|sigstore|slsa-framework|slsa-github-generator|actions\/attest|in-toto|provenance/i.test(w.content));
  return has
    ? { score: 10, evidence: "Artifact signing / provenance configured in CI (config proxy)." }
    : { score: 0, evidence: "No artifact signing / provenance in CI.", remediation: "Sign releases with cosign and emit SLSA provenance (actions/attest)." };
}

/** Exposure — current known open vulnerabilities. Null score when we couldn't inspect dependencies. */
function vulnerabilities(exp: SecurityExposure | null): { score: number | null; evidence: string; remediation?: string } {
  if (!exp || !exp.known) return { score: null, evidence: "Dependency vulnerabilities not inspected (no lockfile / no alert access)." };
  const open = exp.critical + exp.high + exp.medium + exp.low;
  if (open === 0) return { score: 10, evidence: `No known open vulnerabilities across ${exp.scanned} dependencies (${exp.source}).` };
  const s = 10 - (exp.critical * 4 + exp.high * 2 + exp.medium * 0.5 + exp.low * 0.2);
  return {
    score: clamp10(s),
    evidence: `${open} open advisories: ${exp.critical} critical · ${exp.high} high · ${exp.medium} medium (${exp.source}).`,
    remediation: "Upgrade the flagged dependencies to patched versions.",
  };
}

// ── Battery + aggregation ──────────────────────────────────────────────────────

/** Result shape every check returns. */
type CheckResult = { score: number | null; evidence: string; remediation?: string };

/** One battery entry. Every `run` takes the full input set (snapshot, governance, posture, App
 *  inventory) and ignores what it doesn't need — a uniform signature so `computeSecurityChecks` can
 *  hand each check the same four arguments. */
interface PostureSpec {
  id: string;
  name: string;
  risk: SecurityCheck["risk"];
  weight: number;
  run: (s: RepoSnapshot, g: Governance | null, p: SecurityPosture | null, apps: AppInventory | null) => CheckResult;
}

const POSTURE_SPEC: PostureSpec[] = [
  { id: "branch-protection", name: "Branch protection", risk: "high", weight: 3, run: (s, g) => branchProtection(g) },
  { id: "dangerous-workflow", name: "Dangerous workflow", risk: "critical", weight: 3, run: (s) => dangerousWorkflow(workflowFiles(s)) },
  { id: "token-permissions", name: "Token permissions", risk: "high", weight: 2, run: (s) => tokenPermissions(workflowFiles(s)) },
  { id: "sast", name: "SAST", risk: "medium", weight: 2, run: (s, g, p, apps) => sast(workflowFiles(s), s, apps) },
  { id: "dependency-updates", name: "Dependency updates", risk: "high", weight: 2, run: (s, g, p, apps) => dependencyUpdateTool(s, apps) },
  { id: "pinned-dependencies", name: "Pinned dependencies", risk: "medium", weight: 2, run: (s) => pinnedDependencies(workflowFiles(s), s) },
  { id: "security-policy", name: "Security policy", risk: "medium", weight: 1, run: (s, g, p) => securityPolicy(s, p) },
  { id: "signed-releases", name: "Signed releases", risk: "high", weight: 1, run: (s) => signedReleases(workflowFiles(s)) },
  { id: "sbom", name: "SBOM", risk: "low", weight: 1, run: (s) => sbom(workflowFiles(s)) },
];

/**
 * Run the deterministic battery and aggregate to a D9 score. Posture = risk-weighted mean of the
 * applicable posture checks (×10 → 0..100). Exposure (open vulns) folds in at 20% weight when known —
 * so a fresh CVE dents the score without letting current exposure dominate the maturity signal.
 */
export function computeSecurityChecks(
  snap: RepoSnapshot,
  gov: Governance | null,
  posture: SecurityPosture | null,
  exposure: SecurityExposure | null,
  /** Deepening pass: installed-App inventory on the scored commit (github-code-scanning, Socket, Snyk,
   *  Wiz, …). Null = not observable (anonymous scan or a failed read) and NEVER "no Apps installed" —
   *  which is why it is only ever additive: SAST fills in / rises, dependency-updates gains partial
   *  credit, and nothing else moves. Passing null reproduces the pre-inventory scores exactly. */
  apps: AppInventory | null = null,
): SecurityAssessment {
  const checks: SecurityCheck[] = POSTURE_SPEC.map((spec) => {
    const r = spec.run(snap, gov, posture, apps);
    return { id: spec.id, name: spec.name, group: "posture" as const, score: r.score, weight: spec.weight, risk: spec.risk, evidence: r.evidence, remediation: r.remediation };
  });
  const vuln = vulnerabilities(exposure);
  checks.push({ id: "known-vulnerabilities", name: "Known vulnerabilities", group: "exposure", score: vuln.score, weight: 3, risk: "high", evidence: vuln.evidence, remediation: vuln.remediation });

  const applicablePosture = checks.filter((c) => c.group === "posture" && c.score !== null);
  const wsum = applicablePosture.reduce((a, c) => a + c.weight, 0);
  const posturePct = wsum > 0 ? Math.round((applicablePosture.reduce((a, c) => a + c.score! * c.weight, 0) / wsum) * 10) : 0;

  const exposurePct = vuln.score === null ? null : Math.round(vuln.score * 10);
  const d9 = exposurePct === null ? posturePct : Math.round(0.8 * posturePct + 0.2 * exposurePct);

  // Evidence = every check's finding, in a machine-parseable-yet-readable form (the fleet register
  // parses `Name [group/risk]: score/10 — detail` back into the control grid). Gaps = the failing/
  // partial checks' remediation, worst-first — the human "what to fix" list.
  const evidence = checks.map((c) => `${c.name} [${c.group}/${c.risk}]: ${c.score === null ? "n/a" : c.score}/10 — ${c.evidence}`);
  const gaps = checks
    .filter((c) => c.score !== null && c.score < 7 && c.remediation)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .map((c) => c.remediation!);

  return { d9, posture: posturePct, exposure: exposurePct, checks, evidence, gaps };
}

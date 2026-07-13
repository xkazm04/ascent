// The personal workspace's Security view — each watched repo's Security (D9) standing from its
// latest public scan, with the same decidable findings list the org register uses. Decisions write
// to the VIEWER's personal org (via the shared DecisionControl → /api/org/decision), and the scan
// pipeline reads them back into the viewer's own rescans (ScanOptions.decisionOrgSlug) — the
// individual edition of the finding → decision → prompt loop.

import Link from "next/link";
import { Card, SectionEmpty, SectionHeader, MeterRow } from "@/components/org/shared/ui";
import { SecurityFindings } from "@/components/org/SecurityFindings";
import { CopyForLlm } from "@/components/CopyForLlm";
import { getPersonalSecurityRows } from "@/lib/db";
import { decisionMap } from "@/lib/org/decision-map";
import { parseSecurityChecks } from "@/lib/org/security";
import { DEFAULT_SECURITY_MIN } from "@/lib/scoring/gate";
import { scoreHex } from "@/lib/ui";

export async function PersonalSecurity({ slug }: { slug: string }) {
  const [rows, decisions] = await Promise.all([getPersonalSecurityRows(slug), decisionMap(slug, "security")]);
  if (!rows || rows.length === 0) {
    return (
      <SectionEmpty>
        No security data yet — track a public repository on your overview and scan it, then its
        Security (D9) posture appears here.
      </SectionEmpty>
    );
  }

  const withChecks = rows.map((r) => ({ ...r, checks: parseSecurityChecks(r.evidence) }));

  // The same paste-ready CI enforcement the org security tab offers — arguably MORE useful solo: a
  // maintainer wires their own pipeline directly, no fleet policy needed. One line per tracked repo.
  const gateSnippet = [
    `# Ascent security gate — non-zero exit when Security (D9) < ${DEFAULT_SECURITY_MIN} or the posture is "ungoverned".`,
    `# Add the line for your repo to CI; set ASCENT_URL to this Ascent instance.`,
    ...rows.map((r) => `curl -sf "$ASCENT_URL/api/gate/${r.fullName}?security=1"`),
  ].join("\n");

  return (
    <div className="space-y-6">
      <SectionHeader
        descriptionClassName="max-w-3xl"
        title="Security"
        description="Security (D9) across your tracked repos, weakest first — from each repo's latest public scan. Decide each failing control below: accept the work, or dismiss with a reason. Your reasons calibrate your own rescans; they never change what other watchers see."
        right={<CopyForLlm text={gateSnippet} label="Copy CI gate snippet" />}
      />

      <Card>
        <ul>
          {withChecks.map((r) => (
            <li key={r.fullName} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-800 py-3 last:border-b-0">
              <div className="min-w-48 flex-1">
                <Link href={`/report/${r.owner}/${r.name}?tab=dimensions`} className="focus-ring rounded font-medium text-slate-200 hover:text-white">
                  {r.fullName}
                </Link>
                {r.summary && <p className="mt-0.5 max-w-2xl text-sm text-slate-400">{r.summary}</p>}
              </div>
              <MeterRow value={r.score} display={`${r.score}`} label="Security (D9)" color={scoreHex(r.score)} />
            </li>
          ))}
        </ul>
      </Card>

      <SecurityFindings
        org={slug}
        rows={withChecks.map((r) => ({ fullName: r.fullName, checks: r.checks }))}
        decisions={decisions}
      />
    </div>
  );
}

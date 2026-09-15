// The personal workspace's Security view — each watched repo's Security (D9) standing from its
// latest public scan, with the same decidable findings list the org register uses. Decisions write
// to the VIEWER's personal org (via the shared DecisionControl → /api/org/decision), and the scan
// pipeline reads them back into the viewer's own rescans (ScanOptions.decisionOrgSlug) — the
// individual edition of the finding → decision → prompt loop.

import Link from "next/link";
import { Card, SectionEmpty, SectionHeader, MeterRow } from "@/components/org/shared/ui";
import { SecurityCheckMatrix } from "@/features/standing/security/SecurityCheckMatrix";
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
        No security data yet. Track a public repository on your overview and scan it, then its
        Security (D9) posture appears here.
      </SectionEmpty>
    );
  }

  const withChecks = rows.map((r) => ({ ...r, checks: parseSecurityChecks(r.evidence) }));

  // The same paste-ready CI enforcement the org security tab offers — arguably MORE useful solo: a
  // maintainer wires their own pipeline directly, no fleet policy needed. One line per tracked repo.
  const gateSnippet = [
    `# Ascent security gate: non-zero exit when Security (D9) < ${DEFAULT_SECURITY_MIN} or the posture is "ungoverned".`,
    `# Add the line for your repo to CI; set ASCENT_URL to this Ascent instance.`,
    ...rows.map((r) => `curl -sf "$ASCENT_URL/api/gate/${r.fullName}?security=1"`),
  ].join("\n");

  return (
    <div className="space-y-6">
      {/* §3: a noun phrase plus the unit line. "Decide each failing control below…" duplicated the
          findings section's own header one screen down; the scope/ordering facts are now drawn. */}
      <SectionHeader
        title="Security"
        description={`${rows.length} tracked repo${rows.length === 1 ? "" : "s"} · latest public scan · weakest first`}
        right={<CopyForLlm text={gateSnippet} label="Copy CI gate snippet" />}
      />

      <Card>
        {/* The SAME battery grid the org register opens on — one vocabulary across both editions, and
            it is the graphic that degrades honestly at personal scale. A quartile Distribution over
            three watched repos would plot a shape that isn't there; a one-row matrix is simply one
            row, and MatrixGrid falls back to a labelled role="img" placeholder when there are none. */}
        <SecurityCheckMatrix
          className="mb-4"
          // Every row here came from a scan that CARRIED a D9 dimension — getPersonalSecurityRows
          // skips repos without one — so `measured` is true by construction, not by default.
          rows={withChecks.map((r) => ({ fullName: r.fullName, name: r.name, checks: r.checks, measured: true }))}
        />
        <ul>
          {withChecks.map((r) => (
            <li key={r.fullName} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-800 py-3 last:border-b-0">
              <div className="min-w-48 flex-1">
                <Link href={`/report/${r.owner}/${r.name}?tab=dimensions`} className="focus-ring rounded font-medium text-slate-200 hover:text-white">
                  {r.fullName}
                </Link>
                {r.summary && <p className="mt-0.5 max-w-2xl type-body-sm text-slate-400">{r.summary}</p>}
              </div>
              <MeterRow value={r.score} display={`${r.score}`} label="Security (D9)" color={scoreHex(r.score)} />
            </li>
          ))}
        </ul>
      </Card>

      {/* `scopeNote` is KEPT VISIBLE, not demoted to a hover. The org edition has no equivalent: here
          a dismissal is written to YOUR personal org, and someone deciding on a public repo's finding
          needs to know — before they write it — that it calibrates their own rescans and reaches
          nobody else's view. A scope boundary a person is about to act on is not a tooltip. */}
      <SecurityFindings
        org={slug}
        rows={withChecks.map((r) => ({ fullName: r.fullName, checks: r.checks }))}
        decisions={decisions}
        scopeNote="Your reasons calibrate your own rescans. They never change what other watchers of these repos see."
      />
    </div>
  );
}

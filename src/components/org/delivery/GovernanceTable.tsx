// Branch-governance drill-down for the delivery tab. The old render tabled EVERY repo — on a healthy
// fleet that's a page of identical ✓ rows burying the two that matter. Now repos WITH a guardrail gap
// (unprotected, zero required approvals, or no required checks) stay on screen with a direct
// "Fix on GitHub" link to that repo's branch-protection settings, and the fully-governed tail folds
// into a native <details> summary line. Repo names link into their full reports. Server-safe, no JS.

import Link from "next/link";
import { OrgTable } from "@/components/org/ui";
import type { OrgGovernance, RepoGovernance } from "@/lib/db";

/** A repo counts as governed when merging is actually gated: protection on, ≥1 approving review,
 *  and required status checks. Signatures stay visible but optional — most fleets don't sign. */
export function isGoverned(r: RepoGovernance): boolean {
  return r.protected && r.requiredApprovals >= 1 && r.requiresStatusChecks;
}

function yes(b: boolean) {
  return b ? <span className="text-lime-400">✓</span> : <span className="text-slate-600">—</span>;
}

function Row({ r, fix }: { r: RepoGovernance; fix: boolean }) {
  return (
    <tr className="text-slate-300">
      <td className="px-4 py-1.5">
        <Link href={`/report/${r.fullName}`} className="focus-ring font-mono text-sm text-white transition hover:text-accent">
          {r.name}
        </Link>
        {!r.protected && (
          <span className="ml-2 rounded border border-orange-500/40 bg-orange-500/10 px-1.5 py-0.5 font-mono text-xs uppercase tracking-widest text-orange-300">
            unprotected
          </span>
        )}
      </td>
      <td className="px-3 py-1.5 text-center">{yes(r.protected)}</td>
      <td className="px-3 py-1.5 text-center font-mono text-sm">
        {r.requiresPullRequest ? (
          <span className={r.requiredApprovals > 0 ? "text-lime-400" : "text-orange-300"} title={r.requiredApprovals > 0 ? undefined : "PR required, but 0 approvals — authors can self-merge"}>
            {r.requiredApprovals > 0 ? `✓ ${r.requiredApprovals}` : "0"}
          </span>
        ) : (
          yes(false)
        )}
      </td>
      <td className="px-3 py-1.5 text-center">{yes(r.requiresStatusChecks)}</td>
      <td className="px-3 py-1.5 text-center">{yes(r.requiresSignatures)}</td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-400">{r.ruleCount}</td>
      {fix && (
        <td className="px-3 py-1.5 text-right">
          <a
            href={`https://github.com/${r.fullName}/settings/branches`}
            target="_blank"
            rel="noreferrer"
            className="focus-ring whitespace-nowrap font-mono text-sm text-accent transition hover:text-white"
            title="Opens this repo's branch-protection settings (needs admin access)"
          >
            Fix on GitHub ↗
          </a>
        </td>
      )}
    </tr>
  );
}

function Head({ fix }: { fix: boolean }) {
  return (
    <tr>
      <th className="px-4 py-2 text-left">Repo</th>
      <th className="px-3 py-2 text-center">Protected</th>
      <th className="px-3 py-2 text-center" title="required approving reviews">Reviews</th>
      <th className="px-3 py-2 text-center">Checks</th>
      <th className="px-3 py-2 text-center">Signed</th>
      <th className="px-3 py-2 text-right">Rules</th>
      {fix && <th className="px-3 py-2 text-right">Action</th>}
    </tr>
  );
}

export function GovernanceTable({ gov }: { gov: OrgGovernance }) {
  // perRepo already arrives risk-first from the db layer; partition preserves that order.
  const gaps = gov.perRepo.filter((r) => !isGoverned(r));
  const governed = gov.perRepo.filter(isGoverned);

  return (
    <div className="space-y-2">
      {gaps.length > 0 ? (
        <OrgTable minWidth={720} caption="Repositories with branch-governance gaps, riskiest first" head={<Head fix />}>
          {gaps.map((r) => (
            <Row key={r.fullName} r={r} fix />
          ))}
        </OrgTable>
      ) : (
        <p className="text-sm text-slate-400">
          <span aria-hidden className="mr-2 text-lime-400">✓</span>
          Every scanned repo gates merges with protection, a required approval, and status checks.
        </p>
      )}
      {governed.length > 0 && (
        <details className="group">
          <summary className="focus-ring inline-flex cursor-pointer list-none items-center gap-2 rounded font-mono text-sm text-slate-500 transition hover:text-slate-300 [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="inline-block text-slate-600 transition-transform group-open:rotate-90">›</span>
            {governed.length} repo{governed.length > 1 ? "s" : ""} fully governed <span aria-hidden className="text-lime-400">✓</span>
          </summary>
          <OrgTable className="mt-2" minWidth={640} caption="Fully governed repositories" head={<Head fix={false} />}>
            {governed.map((r) => (
              <Row key={r.fullName} r={r} fix={false} />
            ))}
          </OrgTable>
        </details>
      )}
    </div>
  );
}

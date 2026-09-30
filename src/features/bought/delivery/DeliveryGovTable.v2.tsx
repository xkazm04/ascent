// Gaps stay on screen. A governed control is Yes. A measured miss is the word No.
// Zero required approvals stays the number 0: protection that does not gate a merge.
import Link from "next/link";
import { CELL, CELL_NUM, DataTable, HEAD_CELL } from "@/components/kit";
import type { OrgGovernance, RepoGovernance } from "@/lib/db";
import { isGoverned } from "./GovernanceTable";

function YesNo({ on }: { on: boolean }) {
  if (on) {
    return (
      <>
        <span className="sr-only">Yes</span>
        <span aria-hidden>✓</span>
      </>
    );
  }
  return <span className="text-slate-400">No</span>;
}

function Reviews({ r }: { r: RepoGovernance }) {
  if (!r.requiresPullRequest) return <YesNo on={false} />;
  if (r.requiredApprovals > 0) {
    return (
      <>
        <span className="sr-only">Yes, {r.requiredApprovals}</span>
        <span aria-hidden>✓ {r.requiredApprovals}</span>
      </>
    );
  }
  return <span title="PR required, but 0 approvals, so authors can self-merge">0</span>;
}

function Head({ fix }: { fix: boolean }) {
  return (
    <tr>
      <th className={HEAD_CELL}>Repo</th>
      <th className={`${HEAD_CELL} text-right`}>Protected</th>
      <th className={`${HEAD_CELL} text-right`} title="required approving reviews">Reviews</th>
      <th className={`${HEAD_CELL} text-right`}>Checks</th>
      <th className={`${HEAD_CELL} text-right`}>Signed</th>
      <th className={`${HEAD_CELL} text-right`}>Rules</th>
      {fix && <th className={`${HEAD_CELL} text-right`}>Action</th>}
    </tr>
  );
}

function Row({ r, fix }: { r: RepoGovernance; fix: boolean }) {
  return (
    <tr>
      <td className={CELL}>
        <Link href={`/report/${r.fullName}`} className="focus-ring text-white hover:underline">{r.name}</Link>
        {!r.protected && <span className="ml-2 text-slate-400">Unprotected</span>}
      </td>
      <td className={CELL_NUM}><YesNo on={r.protected} /></td>
      <td className={CELL_NUM}><Reviews r={r} /></td>
      <td className={CELL_NUM}><YesNo on={r.requiresStatusChecks} /></td>
      <td className={CELL_NUM}><YesNo on={r.requiresSignatures} /></td>
      <td className={`${CELL_NUM} text-slate-400`}>{r.ruleCount}</td>
      {fix && (
        <td className={CELL_NUM}>
          <a
            href={`https://github.com/${r.fullName}/settings/branches`}
            target="_blank"
            rel="noreferrer"
            className="focus-ring whitespace-nowrap text-slate-300 hover:text-white"
            title="Opens this repo's branch-protection settings (needs admin access)"
          >
            Fix on GitHub
          </a>
        </td>
      )}
    </tr>
  );
}

export function DeliveryGovTableV2({ gov }: { gov: OrgGovernance }) {
  const gaps = gov.perRepo.filter((r) => !isGoverned(r));
  const governed = gov.perRepo.filter(isGoverned);
  return (
    <div className="space-y-3">
      {gaps.length > 0 ? (
        <DataTable density="compact" stickyFirstCol minWidth={720} size="sm" caption="Repositories with branch-governance gaps, riskiest first" head={<Head fix />}>
          {gaps.map((r) => <Row key={r.fullName} r={r} fix />)}
        </DataTable>
      ) : (
        <p className="text-slate-400">
          <span className="sr-only">Healthy: </span>
          <span aria-hidden className="mr-2">✓</span>
          Every scanned repo gates merges with protection, a required approval, and status checks.
        </p>
      )}
      {governed.length > 0 && (
        <details className="group">
          <summary className="focus-ring cursor-pointer text-slate-400">
            {governed.length} repo{governed.length > 1 ? "s" : ""} fully governed
          </summary>
          <div className="mt-3">
            <DataTable density="compact" stickyFirstCol minWidth={640} size="sm" caption="Fully governed repositories" head={<Head fix={false} />}>
              {governed.map((r) => <Row key={r.fullName} r={r} fix={false} />)}
            </DataTable>
          </div>
        </details>
      )}
    </div>
  );
}

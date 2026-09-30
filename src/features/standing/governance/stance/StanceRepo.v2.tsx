// One repo inside a stance band. Score and level stay paper and words. Acknowledgement is the
// sentence from ackLabel, not a status-colored dot.
import { RepoRow, VoidMark } from "@/components/kit";
import { reportPermalink } from "@/lib/ui";
import type { RepoStanceCompliance } from "@/lib/org/stance";
import { ackLabel } from "./stanceShared";
import { AckButton } from "./AckButton";

export function StanceRepoV2({
  repo,
  org,
  version,
  canAck,
}: {
  repo: RepoStanceCompliance;
  org: string;
  version: number;
  canAck: boolean;
}) {
  const blocking = repo.findings.filter((f) => !f.advisory);
  const advisory = repo.findings.filter((f) => f.advisory);
  return (
    <RepoRow
      name={repo.name}
      href={reportPermalink(repo.fullName, null, org)}
      title={repo.findings.map((f) => f.message).join("\n") || repo.fullName}
      level={repo.level}
      score={repo.overall}
      scoreLabel="Overall score"
      stack={
        <>
          <span>{ackLabel(repo.ack, repo.ackedVersion)}</span>
          {repo.provenancePct != null ? (
            <span>provenance {repo.provenancePct}%</span>
          ) : (
            <VoidMark subject="Provenance" label="Provenance not measured" />
          )}
          {blocking.length > 0 && (
            <span>
              <span aria-hidden>▲ </span>
              {blocking.length} finding{blocking.length === 1 ? "" : "s"}
            </span>
          )}
          {advisory.length > 0 && (
            <span>
              {advisory.length} advisory
            </span>
          )}
        </>
      }
      actions={canAck && repo.ack !== "current" ? <AckButton org={org} repo={repo.fullName} version={version} /> : undefined}
    />
  );
}

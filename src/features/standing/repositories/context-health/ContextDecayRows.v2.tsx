// Urgent context rows for the Prism half-life frame. Paper figures; unknown stays a void.
import type { ReactNode } from "react";
import { Caption, HairlineList, ListRow, VoidMark } from "@/components/kit";
import { fmtCompact } from "@/lib/ui";
import { days } from "./contextDecayViz";
import type { RepoContextRow } from "./contextHealthModel";

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-16 text-right">
      <div className="text-[1.25rem] font-light leading-none tabular-nums text-white">{children}</div>
      <Caption>{label}</Caption>
    </div>
  );
}

export function ContextDecayRowsV2({ rows }: { rows: RepoContextRow[] }) {
  return (
    <HairlineList className="mt-4" aria-label="Context half-life by repository">
      {rows.map((r) => {
        const potency = r.assessed && r.present && r.potency != null ? `${r.potency}%` : <VoidMark subject="Potency" />;
        const half = r.assessed && r.present && r.halfLifeDays != null ? days(r.halfLifeDays) : <VoidMark subject="Half-life" />;
        const commits =
          r.commitsSinceEdit != null ? (
            `≈${fmtCompact(r.commitsSinceEdit)}${r.windowCapped ? "+" : ""}`
          ) : (
            <VoidMark subject="Commits since edit" />
          );
        const detail = r.primaryPath ? `${r.primaryPath}: ${r.verdict}` : r.verdict;
        return (
          <ListRow
            key={r.fullName}
            href={r.scanned ? `/report/${r.fullName}` : undefined}
            title={r.fullName}
            detail={detail}
            trailing={
              <div className="flex flex-wrap justify-end gap-5">
                <Figure label="Potency">{potency}</Figure>
                <Figure label="Half-life">{half}</Figure>
                <Figure label="Commits since">{commits}</Figure>
              </div>
            }
          />
        );
      })}
    </HairlineList>
  );
}

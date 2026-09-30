"use client";

// Mined practice, inside the Prism level. Adoption is a dimension line. The exemplar score stays
// paper. Apply uses the kit field.
import { Caption, Chip, ChipRow, DimensionLine, Frame, GhostAction, KeyValue, MonoPath, VoidMark, parseDimension } from "@/components/kit";
import { PracticeApplyV2 } from "./PracticeApply.v2";
import type { OrgPractice } from "@/lib/db";

export function MinedPracticeDetailV2({ p, onPromote }: { p: OrgPractice; onPromote?: () => void }) {
  const measured = p.total > 0;
  const pct = measured ? Math.round((p.strongCount / p.total) * 100) : null;
  const dim = parseDimension(p.dimId);
  return (
    <div className="space-y-6">
      {dim ? (
        <DimensionLine
          wide
          dimension={dim}
          label="Repos strong"
          value={pct == null ? null : pct / 100}
          display={measured ? `${p.strongCount}/${p.total}` : "not measured"}
        />
      ) : measured ? (
        <p className="tabular-nums text-slate-100">{p.strongCount}/{p.total}</p>
      ) : (
        <span className="inline-flex items-center gap-2 text-slate-400">
          <VoidMark label="Repos strong: not measured" />
          not measured
        </span>
      )}
      <KeyValue
        items={[
          {
            key: "Learn from",
            value: p.exemplar ? <MonoPath>{p.exemplar.fullName}</MonoPath> : "No strong exemplar yet",
            hint: p.exemplar ? `${p.exemplar.score}/100` : "Greenfield for the org.",
          },
          {
            key: "Could adopt next",
            value: p.gapRepos.length === 0 ? "No clear gaps: well adopted across the fleet." : `${p.gapRepos.length} repositories`,
          },
        ]}
      />
      {p.gapRepos.length > 0 && (
        <ChipRow>
          {p.gapRepos.slice(0, 12).map((r) => (
            <Chip key={r}>{r}</Chip>
          ))}
          {p.gapRepos.length > 12 && <Caption>{`+${p.gapRepos.length - 12}`}</Caption>}
        </ChipRow>
      )}
      <Frame edge="both" pad="sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Caption>Reusable shape</Caption>
          {onPromote && <GhostAction onClick={onPromote}>Save as playbook</GhostAction>}
        </div>
        <ul className="mt-2 space-y-1 text-slate-200">
          {p.starter.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </Frame>
      <PracticeApplyV2 practiceId={p.id} gapRepos={p.gapRepoRefs} openPrs={p.openPrs} />
    </div>
  );
}

// What the app reaches that the machine-local mentor structurally cannot — drawn first, counted
// second (REGISTRY-AND-CARE-IMPL.md §5's table, made visible).
//
// This panel used to be six product arguments printed under six counts: "a machine-local skill sees
// one working copy", "profile and journal survive a reinstall", "comparison is anonymous and opt-in".
// Every one of them is a claim about REACH, and reach is a matrix: two columns, one void wherever a
// side cannot hold the thing at all. The mentor column is void for five rows — and the sixth row,
// Boundary, is the mirror: your transcripts live on the machine and are void HERE.
//
// The counts stay, because the argument has to be falsifiable off the view model rather than
// asserted: an empty workspace shows honest zeros. Each sentence now rides in that count's WhyChip.

import { HairlineGrid, Kicker } from "@/components/ui";
import { Legend, MatrixGrid, StateSwatch, WhyChip, type MatrixRow } from "@/components/org/viz";
import { careNeverSentCount } from "./careLedgerRows";
import type { DeveloperView } from "@/lib/org/developer-view";

const VOID = { state: "missing" } as const;
const HAS = { state: "measured" } as const;

/** Structural, not data-driven: what each side CAN hold. The counts below say what it holds today. */
const REACH: MatrixRow[] = [
  { id: "map", label: "Map", cells: [VOID, HAS] },
  { id: "evidence", label: "Evidence", cells: [VOID, HAS] },
  { id: "bridge", label: "Bridge", cells: [VOID, HAS] },
  { id: "memory", label: "Memory", cells: [VOID, HAS] },
  { id: "baseline", label: "Baseline", cells: [VOID, HAS] },
  { id: "boundary", label: "Boundary", cells: [HAS, VOID] },
];

function Line({ label, value, hint, mark }: { label: string; value: string; hint: string; mark?: "not-judged" | "decided" }) {
  return (
    <div className="bg-ink px-4 py-3.5">
      <div className="flex items-center gap-1.5">
        <span className="type-label tracking-[0.18em] text-accent">{label}</span>
        <WhyChip hint={hint} label={label} />
      </div>
      {mark ? (
        <div className="mt-1.5 flex items-center gap-2">
          <StateSwatch state={mark} />
          <span className="type-body-sm text-slate-500">{value}</span>
        </div>
      ) : (
        <div className="mt-1 font-mono type-title font-bold tabular-nums text-white">{value}</div>
      )}
    </div>
  );
}

export function CareWhyStrip({ personal }: { personal: DeveloperView }) {
  const gaps = personal.myRepos.reduce((a, r) => a + r.openRecommendations.length, 0);
  const grounded = personal.moves.filter((m) => m.evidence).length;
  const promotable = personal.moves.filter((m) => m.state === "kept" && m.registryPromotable).length;
  const bandFields = personal.orgBands ? Object.keys(personal.orgBands).length : 0;
  const never = careNeverSentCount(personal.setup.sharing);
  // "0 repos" is a measurement only when the snapshot was actually readable and unsuppressed.
  const mapped = personal.activityState === "measured";

  return (
    <div className="mt-3">
      <MatrixGrid
        className="max-w-xs"
        title="What each side can hold"
        axes={["Mentor", "Here"]}
        rows={REACH}
      />
      <Legend
        className="mt-3"
        extra={[
          { id: "holds", label: "Can hold this", swatch: <StateSwatch state="measured" />, hint: "This side can hold the thing at all — the counts below say how much of it exists today." },
          { id: "cannot", label: "Cannot, by construction", swatch: <StateSwatch state="missing" />, hint: "Not a missing feature: the mentor reads one working copy on one machine, and your transcripts never leave it." },
        ]}
      />

      <Kicker tone="muted" className="mt-5">
        Counted off your own view — not a claim
      </Kicker>
      <HairlineGrid className="mt-2 sm:grid-cols-2 xl:grid-cols-3">
        <Line
          label="Map"
          value={mapped ? `${personal.myRepos.length} repos · ${gaps} gaps` : "not readable here"}
          mark={mapped ? undefined : "not-judged"}
          hint="Your moves are read against the standing of every repo you commit to. A machine-local skill sees one working copy."
        />
        <Line
          label="Evidence"
          value={`${grounded} of ${personal.moves.length} moves`}
          hint="Moves that carry fleet proof: what the same move did for other repos, from the registry catalog."
        />
        <Line
          label="Bridge"
          value={`${promotable} promotable`}
          hint="A move you kept can become a registry skill with you as its author — champions from evidence, not nomination."
        />
        <Line
          label="Memory"
          value={`${personal.journal.length} entries`}
          hint="Profile and journal survive a reinstall, a new laptop and a month away. A local journal.jsonl dies with the machine."
        />
        <Line
          label="Baseline"
          value={personal.orgBands ? `${bandFields} anonymous bands` : "comparison off"}
          mark={personal.orgBands ? undefined : "decided"}
          hint="Where your shape sits against the org, in quartiles, without anyone seeing you. Opt-in — and off is a decision, not a gap."
        />
        <Line
          label="Boundary"
          value={`${never} never collected`}
          hint="Rows with no switch at all: transcripts, prompts, diffs and any per-person row. The ledger below draws them as voids in both columns."
        />
      </HairlineGrid>
    </div>
  );
}

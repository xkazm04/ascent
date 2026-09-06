"use client";

// pair-and-baseline-selection: the pair is a statement. The species names the question, the question
// names the baseline, the sides carry roles (baseline / candidate), the default is displayed even when
// defaulted, and the two degenerate pairs — self-comparison and a pruned remembered baseline — are
// guarded and labelled rather than rendered as findings.

import { SCANS, SPECIES, type BaselineSpecies, type ScanId } from "./fixtures";
import { BTN, Chip, NOTICE, Readout, Region } from "./parts";

export type PairState = {
  species: BaselineSpecies;
  candidate: ScanId;
  /** The reader picked the same scan for both sides (a defaulting bug's residue, reproduced on purpose). */
  self: boolean;
  /** The remembered baseline was retired; the surface fell back to the default LOUDLY. */
  pruned: boolean;
};

export const DEFAULT_SPECIES: BaselineSpecies = "temporal";

/** Resolve the pair from the state. Chosen by the question — never by which diff came out longer. */
export function resolvePair(p: PairState): { baseline: ScanId | null; candidate: ScanId; label: string; notice: string | null } {
  const species = p.pruned ? DEFAULT_SPECIES : p.species;
  const entry = SPECIES.find((s) => s.id === species)!;
  if (p.self) return { baseline: p.candidate, candidate: p.candidate, label: `${p.candidate} → ${p.candidate}`, notice: `Comparing ${p.candidate} with itself — an empty result here is not "no changes"; it is the pair (X, X).` };
  if (entry.baseline === null) return { baseline: null, candidate: p.candidate, label: `passport v3 (declared) → ${p.candidate}`, notice: "Declared baseline: the left side is a promise, not a past state. The drift region below renders this species with its own vocabulary." };
  const notice = p.pruned ? `Remembered baseline (${SPECIES.find((s) => s.id === p.species)?.baseline}) was retired — fell back to the default "${DEFAULT_SPECIES}" baseline ${entry.baseline}. Pick again if that is not your question.` : null;
  return { baseline: entry.baseline, candidate: p.candidate, label: `${entry.baseline} → ${p.candidate}`, notice };
}

export function PairRegion({ pair, onChange }: { pair: PairState; onChange: (p: PairState) => void }) {
  const resolved = resolvePair(pair);
  const scan = (id: ScanId | null) => SCANS.find((s) => s.id === id);
  const b = scan(resolved.baseline);
  const c = scan(resolved.candidate);
  const species = SPECIES.find((s) => s.id === (pair.pruned ? DEFAULT_SPECIES : pair.species))!;

  return (
    <Region technique="pair-and-baseline-selection" title="Pair & baseline" note="X relative to Y — and Y is the question. The species is chosen by what the reader is asking, displayed even when defaulted.">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Baseline species">
          {SPECIES.map((s) => (
            <Chip key={s.id} on={species.id === s.id} onClick={() => onChange({ ...pair, species: s.id, pruned: false, self: false })} label={`Baseline species ${s.id}`}>
              {s.id}
            </Chip>
          ))}
        </div>
        <p className="type-caption text-slate-500">question: <span className="text-slate-300">{species.question}</span></p>
        <div className="grid gap-2 sm:grid-cols-2" data-pair={resolved.label}>
          <div className="rounded-lg border border-divider p-2" data-role="baseline">
            <Readout label="baseline" value={b ? b.id : "passport v3"} />
            <p className="type-caption text-slate-500">{b ? `${b.sha} · ${b.at} · ${b.caption}` : "declared by platform team"}</p>
          </div>
          <div className="rounded-lg border border-divider p-2" data-role="candidate">
            <Readout label="candidate" value={c?.id ?? ""} />
            <p className="type-caption text-slate-500">{c ? `${c.sha} · ${c.at} · ${c.caption}` : ""}</p>
          </div>
        </div>
        <p className="type-caption text-slate-500" data-default-shown="true">
          compared with <span className="text-slate-300">{species.id === "declared" ? "the declared passport" : `the ${species.id} baseline`}</span> — additions are candidate-side surplus, on every surface of this desk.
        </p>
        {resolved.notice ? <p className={NOTICE.info} role="status" data-pair-notice={pair.self ? "self" : pair.pruned ? "pruned" : "declared"}>{resolved.notice}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN} aria-pressed={pair.self} onClick={() => onChange({ ...pair, self: !pair.self })}>
            {pair.self ? "pick two different scans" : "select the same scan on both sides"}
          </button>
          <button type="button" className={BTN} aria-pressed={pair.pruned} disabled={species.id === "declared" && !pair.pruned} onClick={() => onChange({ ...pair, pruned: !pair.pruned })}>
            {pair.pruned ? "restore the remembered baseline" : "retire the remembered baseline"}
          </button>
          <button type="button" className={BTN} onClick={() => onChange({ ...pair, candidate: pair.candidate === "scan-1204" ? "scan-1204-alt" : "scan-1204" })}>
            candidate: {pair.candidate === "scan-1204" ? "use sibling branch" : "use latest scan"}
          </button>
        </div>
        <Readout label="selection rule" value="by question (species) — never by the longer output" />
      </div>
    </Region>
  );
}

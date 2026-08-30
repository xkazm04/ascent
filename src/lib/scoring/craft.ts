// THE CRAFT LADDER — the axis taxonomy craft roadmap entries are filed under, and the one place the
// vocabulary is written down.
//
// WHY AN AXIS AT ALL. A craft entry ("what would make this already-green dimension exemplary") is
// unbounded work by design: there is no floor it is measured against and no point at which it is
// finished. Left as a flat list, a model asked the same question every scan answers it the same way,
// and the loop proposes "add a smoke test" forever. The axis is what makes the list a LADDER instead
// of a repetition: the ledger counts what has been BUILT per axis, the prompt is told what is
// already built and asked for the next rung, and `openBatch`'s craft fallback prefers the axis with
// the fewest built items — so the work spreads across the whole surface of the craft rather than
// deepening one corner.
//
// THE SIX. Chosen to be (a) mutually exclusive enough that a model can pick one without agonising,
// (b) collectively exhaustive over the kinds of "raise the ceiling" work a strong repository has
// left, and (c) NOT a second rubric: an axis prices nothing, unlocks nothing, and is never summed.
// `security-depth` is deliberately distinct from the D9 dimension — D9 asks "are the controls
// present"; the axis asks "how deep does the practice go once they are".
//
// NOTHING HERE FEEDS A SCORE. There is no weight, no band and no ordering value in this file that
// any scoring path may read. See `src/lib/maturity/model.ts` r12.

/** The craft axes, in the order they are rendered and iterated. Stable — the ledger keys on them. */
export type CraftAxis =
  | "architecture"
  | "performance"
  | "robustness"
  | "design"
  | "security-depth"
  | "dx";

export const CRAFT_AXES: readonly CraftAxis[] = [
  "architecture",
  "performance",
  "robustness",
  "design",
  "security-depth",
  "dx",
] as const;

/** What each axis means, in the words the prompt hands the model. One line each, on purpose. */
export const CRAFT_AXIS_BRIEF: Record<CraftAxis, string> = {
  architecture:
    "boundaries, coupling, decay checks — the shape of the system as more of it is written by agents",
  performance:
    "measured budgets, regression gates, the cost of a request or a build — numbers that fail loudly",
  robustness:
    "failure drills, degradation paths, recovery — what the system does when a dependency lies to it",
  design:
    "API and interface ergonomics — how obvious the right call is to the next reader, human or agent",
  "security-depth":
    "depth beyond the present controls — threat modelling, secret hygiene, supply-chain provenance",
  dx: "the loop a contributor lives in — setup time, feedback latency, how fast a wrong change is caught",
};

/** Human label for a surface that renders an axis. */
export const CRAFT_AXIS_LABEL: Record<CraftAxis, string> = {
  architecture: "Architecture",
  performance: "Performance",
  robustness: "Robustness",
  design: "Design",
  "security-depth": "Security depth",
  dx: "Developer experience",
};

const AXIS_SET: ReadonlySet<string> = new Set<string>(CRAFT_AXES);

/**
 * Narrow an untrusted value (an LLM field, a legacy DB column, a query param) to a CraftAxis.
 *
 * Returns null rather than a default: an unrecognised axis is UNKNOWN, and filing it under
 * "architecture" would make the ledger's coverage read assert something the model never said. Every
 * consumer here treats null as "no axis", which is a legal state — pre-r12 craft rows have none.
 */
export function asCraftAxis(v: unknown): CraftAxis | null {
  return typeof v === "string" && AXIS_SET.has(v) ? (v as CraftAxis) : null;
}

/** An empty per-axis tally. Every axis is present at zero, so a caller never has to hole-fill. */
export function emptyAxisTally(): Record<CraftAxis, number> {
  return { architecture: 0, performance: 0, robustness: 0, design: 0, "security-depth": 0, dx: 0 };
}

/**
 * Rank axes by how little has been built on them — fewest first, then the declared order.
 *
 * This is the craft fallback's ordering key. "Fewest built" is the whole policy: a repository that
 * has shipped four performance rungs and nothing on robustness is told about robustness next. Ties
 * break on CRAFT_AXES order so the answer is deterministic, which matters because the loop's
 * proposal screen and the engine both compute it.
 */
export function axesByCoverage(built: Readonly<Record<CraftAxis, number>>): CraftAxis[] {
  return [...CRAFT_AXES].sort(
    (a, b) => (built[a] ?? 0) - (built[b] ?? 0) || CRAFT_AXES.indexOf(a) - CRAFT_AXES.indexOf(b),
  );
}

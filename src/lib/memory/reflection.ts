// The `reflect` verb for Shared Org Memory (design doc §8: "a consolidation job groups on kind … and
// prunes redundant ones"). This is what finally GENERATES the `summary` kind — until now the taxonomy
// had a fourth kind with nothing on the planet able to produce one.
//
// THE PROBLEM IT SOLVES: memory grows by accretion. Six episodic notes about the same incident are six
// recall-budget entries that together say one thing. Reflection finds those families and proposes a
// single rollup that supersedes them — the members stay in the table (auditable, still linked) but leave
// default reads, so the store gets SMALLER without anything being destroyed.
//
// SAME TWO-LAYER ARCHITECTURE AS consolidation.ts, on purpose:
//   1. A deterministic clustering prefilter (pure, instant, always runs). Word-set Jaccard + union-find.
//      Jaccard here, NOT the overlap coefficient consolidation.ts uses: that one deliberately rewards a
//      short text overlapping a long one (a correction). Clustering wants the opposite — two memories
//      belong together only if they are similar in BOTH directions, and Jaccard's length symmetry is
//      exactly that guard. It also bounds the prompt: only clusters reach the model, never the store.
//   2. One LLM pass that writes the rollup prose. There is no heuristic that can summarize honestly, so
//      when no model is reachable this returns NO PROPOSALS — mirroring consolidation.ts's
//      `llmUnavailable` degradation, but choosing silence over auto-generated garbage. A memory store
//      that invents its own summaries is a memory store that poisons itself.
//
// NOTHING HERE WRITES. `proposeReflections` returns proposals; applying one is a separate, explicit act
// by the caller (the route's `apply` action). Pure, framework-agnostic, provider-free — the adapter
// injects `RunPrompt` from consolidation-engine.ts.

import { parseJsonLoose } from "@/lib/llm/json";
import { MEMORY_UNTRUSTED_BOUNDARY, neutralize, wrapUntrusted } from "@/lib/llm/untrusted";
import type { RunPrompt } from "@/lib/memory/consolidation";
import { tokenize } from "@/lib/memory/consolidation";

/** The subset of a stored memory reflection reasons over (structurally satisfied by db MemoryRow). */
export interface ReflectionCandidate {
  id: string;
  content: string;
  kind: string;
  confidence: number;
  namespace?: string;
}

export interface MemoryCluster {
  /** Member ids, in input order. Always ≥ MIN_CLUSTER_SIZE by the time it leaves `clusterMemories`. */
  memberIds: string[];
  /** Mean pairwise Jaccard within the cluster, 0..1 — how tight the family is. */
  cohesion: number;
}

export interface SummaryProposal {
  summaryContent: string;
  /** Always a verified SUBSET of the cluster we asked about — never an id the model invented. */
  memberIds: string[];
  /** 0..1. The model's, clamped; capped at the members' own max so a rollup can't out-trust its sources. */
  confidence: number;
  /** Mean pairwise similarity of the cluster this came from — shown beside the proposal. */
  cohesion: number;
}

export interface ReflectionResult {
  proposals: SummaryProposal[];
  /** How many candidate clusters the deterministic pass found (≥ proposals.length). */
  clusterCount: number;
  /** True when no model was reachable — in which case `proposals` is deliberately empty. */
  llmUnavailable: boolean;
  engine: "claude-cli" | "none";
}

// ── Tunables ─────────────────────────────────────────────────────────────────────────────────

/** Two memories join the same family at or above this word-set Jaccard. 0.30 is empirically the knee:
 *  below it unrelated notes that share a stack name start merging; above it, genuine restatements split. */
export const CLUSTER_THRESHOLD = 0.3;
/** A "family" needs three. Two similar memories are the CONSOLIDATION path (supersede one with the
 *  other); a rollup that replaces a pair usually loses more nuance than it saves budget. */
export const MIN_CLUSTER_SIZE = 3;
/** Hard cap on clusters sent to the model — bounds cost + latency regardless of store size. */
export const MAX_CLUSTERS = 4;
/** Per-member excerpt in the prompt, so one huge memory can't crowd out its own cluster. */
const MEMBER_EXCERPT = 800;
/** Summary bodies the model returns are capped well under the 20KB column: a rollup that long isn't one. */
const MAX_SUMMARY_CHARS = 2000;

// ── Layer 1: deterministic clustering ────────────────────────────────────────────────────────

/**
 * Jaccard similarity |A∩B| / |A∪B| over the shared tokenizer (stopword-stripped word sets). Symmetric
 * and length-sensitive by design — see the header note on why this is NOT the overlap coefficient.
 * Returns 0 when either side has no meaningful tokens.
 */
export function jaccard(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Classic union-find with path compression. Exported for the clustering tests. */
export class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]!]!; // path halving
      x = this.parent[x]!;
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/** Memories eligible to be rolled up: a `summary` may not be a member of another summary (that's how a
 *  store loses its origins to a game of telephone). Everything else in the caller's active set qualifies. */
export function reflectionEligible(items: ReflectionCandidate[]): ReflectionCandidate[] {
  return items.filter((m) => m.kind !== "summary");
}

/**
 * Group memories into families by transitive similarity: every pair at or above `threshold` is unioned,
 * so A~B and B~C put all three together even when A and C alone fall short. That transitivity is what
 * catches a thread of notes that drifted topic-wise across a week.
 *
 * O(n²) pairwise — fine at the store sizes this runs on (the caller caps its fetch), and honest: an
 * approximate index would trade determinism, which the tests and the audit trail both depend on.
 * Returns only clusters of ≥ MIN_CLUSTER_SIZE, largest+tightest first, capped at MAX_CLUSTERS.
 */
export function clusterMemories(
  items: ReflectionCandidate[],
  threshold: number = CLUSTER_THRESHOLD,
  minSize: number = MIN_CLUSTER_SIZE,
): MemoryCluster[] {
  const n = items.length;
  if (n < minSize) return [];

  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const uf = new UnionFind(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = jaccard(items[i]!.content, items[j]!.content);
      sim[i]![j] = s;
      sim[j]![i] = s;
      if (s >= threshold) uf.union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }

  return [...groups.values()]
    .filter((idx) => idx.length >= minSize)
    .map((idx) => {
      let sum = 0;
      let pairs = 0;
      for (let a = 0; a < idx.length; a++) {
        for (let b = a + 1; b < idx.length; b++) {
          sum += sim[idx[a]!]![idx[b]!]!;
          pairs++;
        }
      }
      return {
        memberIds: idx.map((i) => items[i]!.id),
        cohesion: Number((pairs ? sum / pairs : 0).toFixed(3)),
      };
    })
    .sort((a, b) => b.memberIds.length - a.memberIds.length || b.cohesion - a.cohesion)
    .slice(0, MAX_CLUSTERS);
}

// ── Layer 2: the model writes the rollup ─────────────────────────────────────────────────────

/**
 * One prompt for ALL candidate clusters (there are at most MAX_CLUSTERS of them, each excerpt-capped) —
 * a single spawn instead of four, which matters when the engine is a local CLI costing ~seconds each.
 * Asks for strict JSON; parseReflectionProposals re-validates every field regardless.
 *
 * The member excerpts are memory content — member-, agent- and repo-authored — so the whole cluster
 * listing is quoted inside the shared untrusted-content boundary (@/lib/llm/untrusted, the same
 * implementation the scoring prompt uses) and each excerpt is neutralized. The stakes are concrete: a
 * proposal's memberIds become `supersededBy` writes, so text that could talk this pass into naming ids
 * would retire memories a human wrote. The task statement and the output contract stay OUTSIDE the block.
 */
export function buildReflectionPrompt(
  clusters: MemoryCluster[],
  items: ReflectionCandidate[],
): string {
  const byId = new Map(items.map((m) => [m.id, m]));
  const blocks = clusters
    .map((c, ci) => {
      const members = c.memberIds
        .map((id) => {
          const m = byId.get(id)!;
          const excerpt = neutralize(m.content.slice(0, MEMBER_EXCERPT));
          const clipped = m.content.length > MEMBER_EXCERPT ? " …[truncated]" : "";
          return `  - id=${id} kind=${neutralize(m.kind)} confidence=${m.confidence}\n    ${excerpt}${clipped}`;
        })
        .join("\n");
      return `CLUSTER ${ci + 1} (id="${c.memberIds[0]}")\n${members}`;
    })
    .join("\n\n");

  return `You are the consolidation pass for an engineering organization's shared memory store. Below are clusters of memories that a similarity pass judged to be about the same thing. For each cluster, decide whether the members genuinely restate ONE subject and, if so, write a single rollup memory that preserves every distinct fact.

${MEMORY_UNTRUSTED_BOUNDARY}

${wrapUntrusted(blocks)}

Respond with ONLY a JSON object, no prose, no markdown fence:
{
  "proposals": [
    {
      "clusterId": "<the id= shown in the CLUSTER header, verbatim>",
      "summaryContent": "<the rollup memory, 1-5 sentences, self-contained>",
      "memberIds": ["<ids from THAT cluster that the rollup actually covers>"],
      "confidence": 0.0-1.0
    }
  ]
}

Rules:
- Only use ids that appear in the cluster you are answering for. Never invent an id.
- Include a proposal ONLY when the members really are one subject. Omit the cluster otherwise — an unnecessary rollup destroys detail.
- A member whose content the rollup does not cover must be LEFT OUT of "memberIds".
- "confidence" is how much you trust the merged claim; never higher than the members' own confidence.
- The rollup must stand alone: it replaces its members in every future read.`;
}

interface RawProposal {
  clusterId?: unknown;
  summaryContent?: unknown;
  memberIds?: unknown;
  confidence?: unknown;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Parse + HARDEN the model's proposals. This is the load-bearing guard of the whole verb: a proposal's
 * `memberIds` become `supersededBy` writes, so an unvalidated id would retire an arbitrary memory —
 * silently, and with no user in the loop to notice. Rules, all strict-REJECT rather than repair:
 *
 *  - the proposal must name a cluster we actually asked about;
 *  - every memberId must belong to THAT cluster (subset, deduped) — one foreign id rejects the WHOLE
 *    proposal rather than being quietly dropped, because a model mixing clusters has misread the task
 *    and its prose is suspect too;
 *  - fewer than 2 surviving members → rejected (a "rollup" of one is just a rewrite);
 *  - blank/absent summaryContent → rejected;
 *  - confidence is clamped to 0..1 AND to the members' own maximum: a rollup may never be more certain
 *    than the most certain thing it consolidates;
 *  - one cluster yields at most one proposal (first wins).
 *
 * Throws only if the text isn't JSON at all; the caller degrades to "no proposals".
 */
export function parseReflectionProposals(
  raw: string,
  clusters: MemoryCluster[],
  items: ReflectionCandidate[],
): SummaryProposal[] {
  const parsed = parseJsonLoose<{ proposals?: unknown }>(raw);
  if (!Array.isArray(parsed.proposals)) return [];

  const byClusterId = new Map(clusters.map((c) => [c.memberIds[0]!, c]));
  const confidenceById = new Map(items.map((m) => [m.id, m.confidence]));
  const seen = new Set<string>();
  const out: SummaryProposal[] = [];

  for (const p of parsed.proposals as RawProposal[]) {
    if (!p || typeof p !== "object") continue;
    const clusterId = typeof p.clusterId === "string" ? p.clusterId : "";
    const cluster = byClusterId.get(clusterId);
    if (!cluster || seen.has(clusterId)) continue; // invented / duplicated cluster
    if (!Array.isArray(p.memberIds) || p.memberIds.length === 0) continue;

    const allowed = new Set(cluster.memberIds);
    const memberIds: string[] = [];
    let foreign = false;
    for (const id of p.memberIds) {
      if (typeof id !== "string" || !allowed.has(id)) {
        foreign = true;
        break;
      }
      if (!memberIds.includes(id)) memberIds.push(id);
    }
    if (foreign || memberIds.length < 2) continue;

    const summaryContent =
      typeof p.summaryContent === "string" ? p.summaryContent.trim().slice(0, MAX_SUMMARY_CHARS) : "";
    if (!summaryContent) continue;

    const ceiling = Math.max(...memberIds.map((id) => confidenceById.get(id) ?? 0));
    const stated =
      typeof p.confidence === "number" && Number.isFinite(p.confidence) ? clamp01(p.confidence) : ceiling;

    seen.add(clusterId);
    out.push({
      summaryContent,
      memberIds,
      confidence: Number(Math.min(stated, ceiling).toFixed(3)),
      cohesion: cluster.cohesion,
    });
  }
  return out;
}

// ── The entry point both adapters (route today, MCP tomorrow) call ───────────────────────────

/**
 * Run the reflection pass. Always returns a usable result, never throws:
 *  - no cluster of ≥3               → no proposals, instantly, without touching the model;
 *  - no `runPrompt` (LLM offline)   → no proposals, flagged llmUnavailable. DELIBERATE: unlike the write
 *    gate, there is no honest heuristic here. A rollup is prose; a deterministic one would be a
 *    concatenation masquerading as a synthesis, and it would then SUPERSEDE its sources.
 *  - model throws / answers prose   → the same empty, honest result.
 */
export async function proposeReflections(
  items: ReflectionCandidate[],
  runPrompt: RunPrompt | null,
  signal?: AbortSignal,
): Promise<ReflectionResult> {
  const eligible = reflectionEligible(items);
  const clusters = clusterMemories(eligible);
  if (clusters.length === 0 || !runPrompt) {
    return {
      proposals: [],
      clusterCount: clusters.length,
      llmUnavailable: !runPrompt,
      engine: runPrompt ? "claude-cli" : "none",
    };
  }

  try {
    const raw = await runPrompt(buildReflectionPrompt(clusters, eligible), signal);
    return {
      proposals: parseReflectionProposals(raw, clusters, eligible),
      clusterCount: clusters.length,
      llmUnavailable: false,
      engine: "claude-cli",
    };
  } catch {
    // Timeout, missing binary, prose instead of JSON: reflection is a background nicety, never an error
    // the caller has to handle. Silence beats a fabricated rollup.
    return { proposals: [], clusterCount: clusters.length, llmUnavailable: true, engine: "none" };
  }
}

// THE METER — one ledger for every model call this deployment serves.
//
// WHY IT EXISTS. Until now exactly one inference lane was accounted: the scan pipeline, whose `Scan`
// row IS its own ledger. Everything else — Athena's turns and background cycles, Shared Org Memory's
// write-gate and reflection passes, the executive briefing's narrative, the local remediation agent —
// spent real tokens that reached no meter at all. `/usage` could not answer "what does the companion
// cost this org", and no packaging decision can be made on a number nobody has.
//
// WHERE IT RIDES. Beside `trackLlmCall`, at the two metering seams that already exist and NOWHERE
// else: `withTimeout()` in text-meter.ts (single-shot) and `runToolLoop()` in tool-loop.ts (one event
// per LOOP, not per leg — the loop sums its own usage and a per-leg event would double count). Two
// lanes are off the seam by construction and call `meter()` directly: the briefing narrative (its own
// fetch against the Anthropic Messages API) and the local agent lane (W2-G).
//
// THREE PROPERTIES THIS MODULE GUARANTEES, in the order they matter:
//
//   1. IT CANNOT BREAK A RUNNER. `meter()` returns `void`, never a promise, and swallows everything —
//      the same posture `recordQuotaEvent`/`bumpCounter` take. A mis-wired meter throwing inside a
//      runner would take down the surface it was only supposed to observe, and the only defence that
//      survives refactoring is that it is structurally unable to.
//   2. HONEST NULLS, NEVER ZERO. A token count or a cost is `null` when the provider reported nothing,
//      when the org runs BYOM (Ascent is not billed at all), or when the model cannot be priced. `0`
//      would be summed and averaged downstream as a measurement; `null` says "unknown" and the read
//      side reports it as `unpricedCalls` beside the total.
//   3. NO PRISMA ACROSS A CLIENT BOUNDARY. The DB post is a LAZY `await import()` inside the default
//      sink, so importing this module from a runner never statically pulls the db layer into a bundle
//      (`build-not-in-gate`: tsc + unit tests pass while `next build` fails on such an edge).

import type { LlmLegKind } from "@/lib/llm/leg";
import type { TokenUsage } from "@/lib/types";
import { billableInputTokens, isZeroCostProvider, priceForModel } from "@/lib/llm/config";

/**
 * Which SURFACE spent the tokens — the vocabulary `/usage`, the showback CSV and the KPI fold group by.
 *
 *   - `scan`     — the scoring pipeline. Derived from `Scan` rows, NOT from `UsageEvent`: that lane
 *                  already has an authoritative ledger and a mirror would be a second, drift-prone one.
 *   - `athena`   — the resident companion, both its interactive turns and its unattended cycles.
 *   - `memory`   — Shared Org Memory's write-gate and reflection passes.
 *   - `briefing` — the executive briefing's one LLM-written paragraph.
 *   - `local`    — the local remediation agent's calls (W2-G supplies the events).
 */
export type UsageLane = "scan" | "athena" | "memory" | "briefing" | "local";

/** Every lane, in the order surfaces render them. A full array (not a Set built at a call site) so a
 *  new lane fails the compile here rather than silently missing from a panel. */
export const USAGE_LANES: readonly UsageLane[] = ["scan", "athena", "memory", "briefing", "local"];

/** Human label per lane — the one place a lane is named for a reader. */
export const LANE_LABEL: Record<UsageLane, string> = {
  scan: "Scan",
  athena: "Athena",
  memory: "Org memory",
  briefing: "Briefing",
  local: "Local agent",
};

/** Whether an arbitrary string is a lane id (persisted rows are TEXT, so reads must check). */
export function isUsageLane(v: string | null | undefined): v is UsageLane {
  return v != null && (USAGE_LANES as readonly string[]).includes(v);
}

/**
 * The lane a leg kind belongs to. Athena's two kinds FOLD to one lane: `athena_turn` and
 * `athena_cycle` differ in whether a human is waiting (which is why they are separate leg kinds and
 * separate temperature rows), not in whose budget they spend.
 */
export function laneForLegKind(kind: LlmLegKind): UsageLane {
  switch (kind) {
    case "scan":
      return "scan";
    case "memory":
      return "memory";
    case "briefing":
      return "briefing";
    case "athena_turn":
    case "athena_cycle":
      return "athena";
    case "lane_summary":
      // The loop's own spend: the headline polish belongs to the lane it summarises.
      return "local";
  }
}

/**
 * What a CALLER knows about a call that the seam cannot work out for itself: whose org it is, which
 * lane (when no leg kind names it), and the row it belongs to. Threaded through `TextRunnerOptions` /
 * `ToolLoopOptions` so a caller declares it once instead of the seam guessing.
 */
export interface MeterContext {
  /** The org whose ledger this belongs to. `null` writes NOTHING — an unattributable event is not
   *  worth a row, and inventing an owner for one is worse than losing it. A real slug is always
   *  written: no slug VALUE is treated as a sentinel here (MC-B20). */
  orgSlug: string | null;
  /** Overrides the lane derived from `legKind`. Required for the lanes that are off the seam. */
  lane?: UsageLane;
  /** `Scan.id` / `LoopRunLane.id` when the caller owns a stable id for the work; null is honest. */
  refId?: string | null;
  repoId?: string | null;
  repoFullName?: string | null;
  /** Normalized "@org/team" CODEOWNERS slug. A TEAM, never a person — see the privacy note in
   *  docs/features/billing/usage.md. `null` = org-wide work, which is a bucket, not a gap. */
  teamKey?: string | null;
  /** `true` when the org's own BYOM credentials served the call — Ascent is not billed, so the cost
   *  is `null` rather than a figure the operator would be wrong to reconcile against an invoice. */
  byom?: boolean;
  /** Overrides the derived `"<lane>:<refId>"` idempotency key. W2-G's loop lane owns
   *  `loop-lane:<laneId>`, which is its own id space rather than this lane's derivation. */
  idemKey?: string | null;
}

/** One metered call. `costMicros` may be supplied by a caller that owns an authoritative cost
 *  envelope (W2-G's loop lane); when the key is absent the meter prices it from the token counts. */
export interface MeterInput extends MeterContext {
  legKind?: LlmLegKind;
  /** A `ProviderName` at the seam. Typed as `string` because one lane is legitimately off the union:
   *  the briefing narrative calls the first-party Anthropic Messages API directly, which is the legacy
   *  `claude` id `PROVIDER_LABEL` already knows and `ProviderName` deliberately does not carry. */
  provider: string;
  model: string;
  usage?: TokenUsage;
  status: "success" | "error" | "timeout";
  latencyMs?: number;
  /** Explicit cost override in USD micros. `null` means "the caller knows it is unknowable" and is
   *  honored as such; ABSENT means "price it from the tokens". The two are deliberately different. */
  costMicros?: number | null;
}

/** The row the writer persists. Resolved by `meter()` so the sink stays a dumb, testable posting hole. */
export interface UsageEventInput {
  orgSlug: string;
  lane: UsageLane;
  legKind?: string | null;
  refId?: string | null;
  repoId?: string | null;
  repoFullName?: string | null;
  teamKey?: string | null;
  provider: string;
  model: string;
  byom?: boolean | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costMicros: number | null;
  status: string;
  latencyMs?: number | null;
  idemKey?: string | null;
}

/** Where a resolved event goes. Injectable so the pure half is testable without a database. */
export type MeterSink = (event: UsageEventInput) => Promise<unknown>;

/**
 * The default sink: a LAZY import of the writer. Lazy for the reason stated in the header — a static
 * import would drag Prisma into every bundle that merely resolves a text runner.
 */
const dbSink: MeterSink = async (event) => {
  const { recordUsageEvent } = await import("@/lib/db/usage-events");
  return recordUsageEvent(event);
};

let sink: MeterSink = dbSink;

/** Swap the sink (tests). Passing `null` restores the database writer. */
export function setMeterSink(next: MeterSink | null): void {
  sink = next ?? dbSink;
}

/** A token field as the ledger stores it: the number the provider reported, or `null` for "not
 *  reported". Never 0 — see property 2 in the header. */
function tokenOrNull(v: number | null | undefined): number | null {
  return v == null ? null : v;
}

/**
 * The price of one call in USD micros, or `null` when it cannot be known. PURE.
 *
 * Null — never 0 — in four cases, each a different kind of "we don't know":
 *   - BYOM: the org paid its own vendor; Ascent has no figure and must not imply one.
 *   - a zero-cost provider (local inference on the operator's own GPU): no per-token bill exists to
 *     record. The read side counts it under `unpricedCalls`, so a $0 lane reads as "nothing to price"
 *     rather than as "free", which is the distinction a buyer actually asks about.
 *   - no usage reported (claude-cli's `ownsTimeout` path, mock): there is nothing to price.
 *   - an unpriced model id: `priceForModel` refuses to guess a rate, and so does this.
 *
 * Cache classes are folded through `billableInputTokens`, so a cached call prices at what it really
 * cost rather than at its fresh-input count.
 */
export function costMicrosFor(
  provider: string,
  model: string,
  usage: TokenUsage | undefined,
  byom: boolean | undefined,
): number | null {
  if (byom === true) return null;
  if (isZeroCostProvider(provider)) return null;
  if (!usage) return null;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  if (input + output + cacheRead + cacheWrite === 0) return null;
  const price = priceForModel(model);
  if (!price) return null;
  const usd =
    (billableInputTokens(usage) / 1_000_000) * price.inPerMTok + (output / 1_000_000) * price.outPerMTok;
  return Math.round(usd * 1_000_000);
}

/**
 * Record one metered call. FIRE AND FORGET: returns `void`, is never awaited, and cannot throw or
 * reject — see property 1 in the header. A `null` org writes nothing.
 */
export function meter(input: MeterInput): void {
  try {
    const orgSlug = (input.orgSlug ?? "").trim().toLowerCase();
    // An unattributable event has no ledger to land in. That is the ONLY drop this seam makes.
    //
    // UAT MC-B20 (VICTOR-L2-01, found by driving): this line used to read
    // `if (!orgSlug || orgSlug === "public") return;` — the anonymous funnel's sentinel, applied as a
    // STRING to every call. Any tenant whose slug is that string burned real inference and showed $0
    // for it forever, and the drop was silent: a genuine 12.1 s claude-cli turn recorded nothing and
    // invalidated a live test arm before the cause was found.
    //
    // The funnel's own spend does not depend on this check. Public SCANS never reach the meter at all
    // (the scan pipeline runs on `getProviderForOrg`, and its `Scan` row is its own ledger — see the
    // module header), and every other lane is a tenant surface. Where a deployment does want an org
    // excluded from the ledger, that decision is made from the ORG ROW's `kind`, in
    // `recordUsageEvent` — where the row is actually known — never from the shape of its slug.
    if (!orgSlug) return;
    const lane = input.lane ?? (input.legKind ? laneForLegKind(input.legKind) : undefined);
    if (!lane) {
      // Neither a lane nor a leg kind: there is no honest bucket for this call. Say so loudly in dev
      // rather than inventing one — a mis-tagged event is worse than a missing one.
      if (process.env.NODE_ENV !== "production") {
        console.warn("[llm/meter] dropped an event with neither `lane` nor `legKind`", input.model);
      }
      return;
    }
    const costMicros =
      "costMicros" in input ? (input.costMicros ?? null) : costMicrosFor(input.provider, input.model, input.usage, input.byom);
    const idemKey =
      input.idemKey !== undefined ? input.idemKey : input.refId ? `${lane}:${input.refId}` : null;
    const event: UsageEventInput = {
      orgSlug,
      lane,
      legKind: input.legKind ?? null,
      refId: input.refId ?? null,
      repoId: input.repoId ?? null,
      repoFullName: input.repoFullName ?? null,
      teamKey: input.teamKey ?? null,
      provider: input.provider,
      model: input.model,
      byom: input.byom ?? null,
      inputTokens: tokenOrNull(input.usage?.inputTokens),
      outputTokens: tokenOrNull(input.usage?.outputTokens),
      cacheReadTokens: tokenOrNull(input.usage?.cacheReadTokens),
      cacheWriteTokens: tokenOrNull(input.usage?.cacheWriteTokens),
      costMicros,
      status: input.status,
      latencyMs: input.latencyMs ?? null,
      idemKey,
    };
    // `void` + `.catch` rather than `await`: a rejected sink must not become an unhandled rejection,
    // and the caller must not wait on observability.
    void Promise.resolve(sink(event)).catch(() => {
      /* best-effort ledger — never surface to the runner this rides on */
    });
  } catch {
    /* a meter that throws is a bug that takes a real surface down with it — swallow it here */
  }
}

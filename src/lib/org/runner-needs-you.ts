// NEEDS YOU — the shape `GET /api/org/loop/needs-you` answers and what the notifier does with it
// (spark theater-upgrade, 2026-09-18).
//
// DEPENDENCY-FREE (types from runner-types only): `RunnerNotifier` imports this in the BROWSER, so the
// server-side assembly — which shares the pulse's `needsOperator` rule from the db layer — lives beside
// the route (`src/app/api/org/loop/needs-you/buildNeedsYou.ts`), and only the pure halves live here:
// the response type, the defensive parse, the item identities, the summary and the batching decision.

import {
  NOTIFY_BATCH_MS,
  type LoopPlanRecord,
  type NeedsYou,
  type RepoPauseReason,
  type RunnerPauseReason,
} from "@/lib/local/runner-types";

/** `NeedsYou` plus one flag: does the org have a live continuous drive at all. The notifier stays
 *  silent (and stops asking) for an org that has neither a runner nor anything waiting. */
export interface NeedsYouResponse extends NeedsYou {
  runner: boolean;
}

/** The Ledger — where every needs-you surface sends the operator. */
export const ledgerHref = (slug: string): string => `/org/${encodeURIComponent(slug)}?tab=live&view=ledger`;

const TITLE_MAX = 120;

/** A plan's one-line title: its intent, else its first item's title (as it read when the plan was
 *  written), else that item's approach, else the plan text's first line, else plain words. Bounded. */
export function planTitle(p: Pick<LoopPlanRecord, "plan" | "planText"> & { itemTitles?: readonly string[] }): string {
  const raw =
    p.plan?.intent?.trim() ||
    p.itemTitles?.[0]?.trim() ||
    p.plan?.items?.[0]?.approach?.trim() ||
    p.planText?.trim().split("\n")[0]?.trim() ||
    "A plan waits for review";
  return raw.length > TITLE_MAX ? `${raw.slice(0, TITLE_MAX - 1)}…` : raw;
}

/** A route body → the response, defensively (a release-behind server, an error page); null = unreadable. */
export function parseNeedsYou(body: unknown): NeedsYouResponse | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  if (!Array.isArray(o.plans) && !Array.isArray(o.pausedRepos) && !("runner" in o)) return null;
  const objs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  const rp = o.runnerPaused && typeof o.runnerPaused === "object" ? (o.runnerPaused as Record<string, unknown>) : null;
  return {
    runner: o.runner === true,
    plans: objs(o.plans)
      .filter((p) => s(p.id))
      .map((p) => ({ id: s(p.id)!, repo: s(p.repo) ?? "", title: s(p.title) ?? "", createdAt: s(p.createdAt) ?? "" })),
    pausedRepos: objs(o.pausedRepos)
      .filter((r) => s(r.repo) && s(r.reason))
      .map((r) => ({ repo: s(r.repo)!, reason: s(r.reason) as RepoPauseReason, note: s(r.note) })),
    runnerPaused: rp && s(rp.reason) ? { reason: s(rp.reason) as RunnerPauseReason, until: s(rp.until) } : null,
  };
}

// ── the notifier's items, summary and batching ───────────────────────────────────────────────────

export interface NeedsYouItem {
  /** Stable per waiting thing — the dedup key the notifier persists. */
  id: string;
  kind: "plan" | "repo" | "runner";
  repo: string | null;
  reason: string | null;
}

const REASON_WORDS: Record<RepoPauseReason | RunnerPauseReason, string> = {
  "repo-failures": "repeated failures",
  "branch-conflict": "branch conflict",
  "dependency-install": "dependency install failed",
  "dry-backoff": "resting after dry runs",
  "spend-ceiling": "spend ceiling",
  "session-limit": "session limit",
};

export function needsYouItems(n: NeedsYou): NeedsYouItem[] {
  return [
    ...n.plans.map((p) => ({ id: `plan:${p.id}`, kind: "plan" as const, repo: p.repo, reason: null })),
    ...(n.runnerPaused ? [{ id: `runner:${n.runnerPaused.reason}:${n.runnerPaused.until ?? ""}`, kind: "runner" as const, repo: null, reason: n.runnerPaused.reason }] : []),
    ...n.pausedRepos.map((r) => ({ id: `repo:${r.repo}:${r.reason}`, kind: "repo" as const, repo: r.repo, reason: r.reason })),
  ];
}

const short = (repo: string | null) => (repo ? repo.slice(repo.lastIndexOf("/") + 1) : "");

/** "2 directions wait for your approval · kp paused: branch conflict". */
export function summarizeNeedsYou(items: readonly NeedsYouItem[]): string {
  const plans = items.filter((i) => i.kind === "plan").length;
  const parts: string[] = [];
  if (plans) parts.push(plans === 1 ? "1 direction waits for your approval" : `${plans} directions wait for your approval`);
  for (const i of items) {
    const why = REASON_WORDS[i.reason as keyof typeof REASON_WORDS] ?? i.reason ?? "paused";
    if (i.kind === "runner") parts.push(`Runner paused: ${why}`);
    if (i.kind === "repo") parts.push(`${short(i.repo)} paused: ${why}`);
  }
  return parts.join(" · ");
}

export interface NotifyState {
  /** Item ids already announced and still present. */
  seen: string[];
  /** When the last OS notification went out (epoch ms). */
  lastAt: number | null;
}

/**
 * One read's decision. Ids that CLEARED are forgotten (so the same pause recurring later is news
 * again); what is new is announced in ONE notification, at most once per `batchMs`. Inside the window
 * new items stay unseen and ride the next notification — unless they clear first, in which case nobody
 * was bothered about them at all.
 */
export function decideNotify(
  state: NotifyState,
  items: readonly NeedsYouItem[],
  now: number,
  batchMs: number = NOTIFY_BATCH_MS,
): { notify: NeedsYouItem[] | null; state: NotifyState } {
  const present = new Set(items.map((i) => i.id));
  const seen = state.seen.filter((id) => present.has(id));
  const fresh = items.filter((i) => !seen.includes(i.id));
  if (fresh.length === 0 || (state.lastAt != null && now - state.lastAt < batchMs)) {
    return { notify: null, state: { seen, lastAt: state.lastAt } };
  }
  return { notify: fresh, state: { seen: [...seen, ...fresh.map((i) => i.id)], lastAt: now } };
}

// The fleet's cadence backlog, as ONE number (UAT `VICTOR-L1-07`).
//
// `queueDepth()` reached only the two cron routes' JSON, so a director budgeting a weekly paid cadence
// could learn how deep his backlog was only by counting per-row "queued" tags — *"I'd see 400 per-row
// 'queued' tags before I saw the number 400."* One line, above the table those tags live in.
//
// SERVER component. It is a read, not a control: nothing here is clickable, so the queue can never be
// mistaken for a thing the reader is expected to drain by hand.
//
// AGGREGATE HONESTY. `orgQueueDepth` returns null wherever the number would be a fiction (no database,
// unknown org, a failed read) and this renders the reason instead — a "0 queued" printed off a queue
// nobody could read is the exact failure the fleet's meters are built to avoid. An empty queue that WAS
// read says so in words, because "nothing waiting" is a measurement worth stating on a page whose whole
// subject is cadence.

import { orgQueueDepth } from "@/lib/db/scan-jobs";

/** "3h" / "2d" / "45m" / "20s" — the age of the oldest waiting job, at the coarsest honest unit. */
export function queueAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/**
 * The sentence itself, pure so it can be pinned without a database.
 *
 * `null` depth is UNREADABLE, not empty. `oldestAgeMs` is null on an empty lane by the same rule the
 * db module holds — never 0, which would read as "waiting no time at all".
 */
export function queueDepthSentence(depth: { rescore: { queued: number; oldestAgeMs: number | null }; probe: { queued: number; oldestAgeMs: number | null } } | null): string {
  if (!depth) return "Scan queue depth is unavailable — this deployment's job queue could not be read.";
  const total = depth.rescore.queued + depth.probe.queued;
  if (total === 0) return "Scan queue: nothing waiting — every scheduled rescan and probe has been picked up.";
  const ages = [depth.rescore.oldestAgeMs, depth.probe.oldestAgeMs].filter((a): a is number => a != null);
  const oldest = ages.length ? Math.max(...ages) : null;
  const parts: string[] = [];
  if (depth.rescore.queued) parts.push(`${depth.rescore.queued} rescan${depth.rescore.queued === 1 ? "" : "s"}`);
  if (depth.probe.queued) parts.push(`${depth.probe.queued} probe${depth.probe.queued === 1 ? "" : "s"}`);
  return (
    `Scan queue: ${parts.join(" · ")} waiting` +
    // A depth with no age is a queue we counted but could not date — say so rather than omit it.
    (oldest == null ? " (age unavailable)." : `, oldest queued ${queueAge(oldest)} ago.`)
  );
}

export async function QueueDepthLine({ slug }: { slug: string }) {
  const depth = await orgQueueDepth(slug);
  return (
    <p className="type-body-sm text-slate-500">
      {queueDepthSentence(depth)}
    </p>
  );
}

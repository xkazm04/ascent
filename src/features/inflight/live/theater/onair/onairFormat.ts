// The On Air wall's small words: the station clock, the wire's kind words and tones, the pause words
// and the links. Pure, so the wall's components and tests read one spelling. Durations, money and
// "HH:MM" come from ../theaterFormat — the classic theater's spelling — never a second copy.

import type { PulseEvent } from "@/lib/local/runner-types";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The viewer's local wall-clock time of an instant, to the second ("14:08:46"); null when unknown. */
export function fmtHms(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** The wire's pill word for each event kind. */
export const KIND_WORD: Record<PulseEvent["kind"], string> = {
  landed: "LANDED",
  "verified-close": "VERIFIED",
  "plan-pending": "PLAN WAITS",
  paused: "PAUSED",
  "direction-done": "DIRECTION DONE",
  rejected: "REJECTED",
  failed: "FAILED",
};

export type EventTone = "good" | "attention" | "bad" | "info";

export function eventTone(kind: PulseEvent["kind"]): EventTone {
  if (kind === "landed" || kind === "verified-close") return "good";
  if (kind === "plan-pending" || kind === "paused") return "attention";
  if (kind === "failed" || kind === "rejected") return "bad";
  return "info";
}

/** Why the runner is paused, in the classic header's words. */
export const PAUSE_WORDS: Record<string, string> = { "spend-ceiling": "spend ceiling", "session-limit": "session limit" };

/** Why one repo is paused. */
export const REPO_PAUSE_WORDS: Record<string, string> = {
  "repo-failures": "failure streak",
  "branch-conflict": "branch conflict",
  "dry-backoff": "dry backoff",
  "dependency-install": "dependency install",
};

export const plural = (n: number, one: string, many: string = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The desk — the Live tab's desk view, where every action on what the wall shows lives. */
export const deskHref = (slug: string): string => `/org/${encodeURIComponent(slug)}?tab=live&view=desk`;

/** Join class names, dropping the falsy ones. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

// The theater's words for time and money — pure, so the header model and the hero read ONE spelling.
//
// Read from three metres: short units, no seconds past the first minute, no decimals a glance cannot
// use. Every money figure is MICRO-CENTS on the wire (`agent-envelope.ts`: `round(usd * 100 * 1e6)`);
// the divisor is the runner's own (`runner-breakers.ts`, dependency-free), never a second copy.

import { MICROS_PER_USD } from "@/lib/local/runner-breakers";

export { MICROS_PER_USD };

/** When the last good pulse is older than this, every liveness claim on the page switches to the truth. */
export const THEATER_STALE_MS = 10_000;

/** "42 s", "7 m", "3 h 12 m", "2 d 4 h". Negative or non-finite input reads as "0 s". */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0 s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} m` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

/** The viewer's local wall-clock time of an ISO instant, 24-hour ("00:00", "14:20"); null when unparseable. */
export function fmtClock(iso: string | null | undefined): string | null {
  const t = toMs(iso);
  if (t == null) return null;
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "$0.42", "$12.40", "$1,240". Micro-cents in, dollars out. */
export function fmtUsd(micros: number | null | undefined): string {
  const usd = (Number.isFinite(micros) ? (micros as number) : 0) / MICROS_PER_USD;
  if (usd >= 1000) return `$${Math.round(usd).toLocaleString("en-US")}`;
  return `$${usd.toFixed(2)}`;
}

/** ISO → epoch ms, or null for anything that does not parse. */
export function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** `owner/name` → `name`: the theater names repos the way a person across the room says them. */
export function repoShort(full: string): string {
  const i = full.lastIndexOf("/");
  return i >= 0 ? full.slice(i + 1) : full;
}

/** Elapsed ms from an ISO instant to `now`, or null when the instant is unknown. Never negative. */
export function since(iso: string | null | undefined, now: number): number | null {
  const t = toMs(iso);
  return t == null ? null : Math.max(0, now - t);
}

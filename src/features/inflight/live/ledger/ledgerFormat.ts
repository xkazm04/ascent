// The ledger's words for time and money — pure, and measured against the LOAD's own clock (`data.now`),
// never `Date.now()`: the server render and the hydrated render must print the same sentence, and a
// page that does not poll has exactly one "now" anyway.
//
// Money is MICRO-CENTS on the wire (`round(usd * 100 * 1e6)`, agent-envelope.ts): 1e8 per dollar.

const MICROS_PER_USD = 100_000_000;

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** "42 s", "7 m", "3 h 12 m", "2 d 4 h". Negative or non-finite reads as "0 s". */
export function fmtSpan(span: number): string {
  if (!Number.isFinite(span) || span < 0) return "0 s";
  const s = Math.floor(span / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} m` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

/** "3 h ago" / "just now"; an unparseable instant reads "at an unknown time". */
export function fmtAgo(iso: string | null | undefined, now: string): string {
  const t = ms(iso);
  const n = ms(now);
  if (t == null || n == null) return "at an unknown time";
  return n - t < 60_000 ? "just now" : `${fmtSpan(n - t)} ago`;
}

/** "in 40 m" / "now" — for a pause that lifts, a repo that wakes. */
export function fmtIn(iso: string | null | undefined, now: string): string | null {
  const t = ms(iso);
  const n = ms(now);
  if (t == null || n == null) return null;
  return t - n <= 0 ? "now" : `in ${fmtSpan(t - n)}`;
}

/** A run's duration; null while it is still running (the caller says "running"). */
export function fmtDuration(startedAt: string, endedAt: string | null): string | null {
  const a = ms(startedAt);
  const b = ms(endedAt);
  return a == null || b == null ? null : fmtSpan(b - a);
}

/** "2026-09-18" — the date a run without a stable number is labelled by. */
export const fmtDay = (iso: string | null | undefined): string => (iso && iso.length >= 10 ? iso.slice(0, 10) : "—");

/** "$0.42" / "$12.40"; null is "—" — not measured, never "$0.00". */
export function fmtUsd(micros: number | null | undefined): string {
  if (micros == null || !Number.isFinite(micros)) return "—";
  return `$${(micros / MICROS_PER_USD).toFixed(2)}`;
}

/** "kp" from "acme/kp". */
export const shortRepo = (repo: string): string => repo.slice(repo.lastIndexOf("/") + 1);

/** "a1b2c3d4" — the first eight of a sha, or "—". */
export const shortSha = (sha: string | null | undefined): string => (sha ? sha.slice(0, 8) : "—");

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

// The desk's words for time, money and verdicts — pure, one spelling for every section and layer.
//
// Money is MICRO-CENTS on the wire (1e8 per USD, ledgerFormat.ts). A null cost is NOT REPORTED, which is
// a different fact from $0: every formatter here that takes a cost returns null for it, so the caller
// has to say "not reported" out loud instead of printing a zero. Instants print in UTC so the server
// render and the hydrated one agree, and two screens read the same numbers.

import type { VerifyVerdict } from "@/lib/local/verify-options";

export const MICROS_PER_USD = 100_000_000;

export const toMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** "$0.62" / "$54.19"; null = not reported. */
export function usd(micros: number | null | undefined): string | null {
  if (micros == null || !Number.isFinite(micros)) return null;
  return `$${(micros / MICROS_PER_USD).toFixed(2)}`;
}

/** "$543" — whole dollars for a total figure. */
export const usd0 = (micros: number): string => `$${Math.round(micros / MICROS_PER_USD).toLocaleString("en-US")}`;

/** "42 s", "7 m", "3 h 12 m", "2 d 4 h". */
export function dur(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "0 s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} m` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

/** "2:14" — a lane clock, minutes and seconds. */
export function mmss(ms: number): string {
  const s = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const asMs = (v: number | string | null | undefined): number | null => (typeof v === "number" ? v : toMs(v));

/** "Sep 21" (UTC). */
export function date(v: number | string | null | undefined): string {
  const t = asMs(v);
  if (t == null) return "—";
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "15:46" (UTC). */
export function hm(v: number | string | null | undefined): string {
  const t = asMs(v);
  if (t == null) return "—";
  const d = new Date(t);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** "15:46:02" (UTC). */
export function hms(v: number | string | null | undefined): string {
  const t = asMs(v);
  if (t == null) return "—";
  const d = new Date(t);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

/** "kp" from "xkazm04/kp". */
export const repoShort = (full: string | null | undefined): string => (full ? full.slice(full.lastIndexOf("/") + 1) : "");

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The five verdict keys a mark is coloured by. A null verdict is a lane from before the guard. */
export type VerdictKey = "verified" | "rejected" | "baseline" | "skipped" | "unknown";
export const VERDICT_KEYS: readonly VerdictKey[] = ["verified", "rejected", "baseline", "skipped", "unknown"];

export function verdictKey(v: VerifyVerdict | string | null | undefined): VerdictKey {
  if (v == null) return "unknown";
  if (v === "baseline-unavailable" || v === "baseline-red") return "baseline";
  if (v === "verified" || v === "rejected" || v === "skipped") return v;
  return "unknown";
}

const VERDICT_WORD: Record<VerdictKey, string> = {
  verified: "verified",
  rejected: "rejected",
  baseline: "baseline unavailable",
  skipped: "skipped",
  unknown: "unknown (pre-guard)",
};
export const verdictWord = (v: VerifyVerdict | string | null | undefined): string => VERDICT_WORD[verdictKey(v)];

/** "+3" / "-1" / "0". */
export const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

export const DIM_NAMES: Record<string, string> = {
  D1: "AI Tooling & Conventions",
  D2: "Automated Testing",
  D3: "CI/CD & Delivery",
  D4: "Agentic Workflows",
  D5: "Documentation & Knowledge",
  D6: "Code Quality & Guardrails",
  D7: "Commit & Velocity Signals",
  D8: "AI Process & Harness",
  D9: "Supply Chain & Security",
};

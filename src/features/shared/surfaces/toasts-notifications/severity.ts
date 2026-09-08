// The ONE severity vocabulary of the fleet desk (severity-taxonomy). The level set is closed and
// defined here once; every consumer — the toast's tone, its dwell, whether it earns a ledger row,
// whether it may leave for the OS, how loudly it is announced — derives from this table by level.
// No call site picks a colour or a duration: a message that wants different presentation has one
// lever, a different level, and the consequence column is the test that decides it. Visual encoding
// is a semantic TONE, resolved to brand tokens by a second table (`TONE_SLOTS`), never a hex here.
// No React.

export const SEVERITIES = ["info", "success", "warning", "error", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];
export type Politeness = "polite" | "assertive";
export type Tone = "neutral" | "positive" | "cautionary" | "negative" | "maximum";

export interface SeverityRow {
  tone: Tone;
  /** The defining question — what happens if the user never sees this? */
  consequence: string;
  examples: string;
  /** Base dwell for an AWARENESS-class message (scaled by reading length). 0 = never auto-dismissed. */
  dwellMs: number;
  dismiss: "auto" | "explicit" | "acted";
  ledger: "no" | "if-awaited" | "yes" | "pinned";
  osEligible: "no" | "if-actionable" | "if-awaited" | "yes";
  politeness: Politeness | "assertive-if-blocking";
  /** After a dismissal, how long a repeat of the same semantic key only bumps the record. */
  cooldownMs: number;
}

export const SEVERITY_TABLE: Record<Severity, SeverityRow> = {
  info: {
    tone: "neutral",
    consequence: "nothing — pure awareness",
    examples: "background sync finished, a peer joined",
    dwellMs: 3_000,
    dismiss: "auto",
    ledger: "if-awaited",
    osEligible: "no",
    politeness: "polite",
    cooldownMs: 6_000,
  },
  success: {
    tone: "positive",
    consequence: "they miss confirmation of their own action",
    examples: "saved, sent, rescan queued",
    dwellMs: 3_000,
    dismiss: "auto",
    ledger: "if-awaited",
    osEligible: "if-awaited",
    politeness: "polite",
    cooldownMs: 6_000,
  },
  warning: {
    tone: "cautionary",
    consequence: "something will degrade if unaddressed",
    examples: "credential expiring, credits near the floor",
    dwellMs: 6_000,
    dismiss: "auto",
    ledger: "yes",
    osEligible: "if-actionable",
    politeness: "polite",
    cooldownMs: 10_000,
  },
  error: {
    tone: "negative",
    consequence: "something already failed",
    examples: "rescan failed, regression detected",
    dwellMs: 6_000,
    dismiss: "explicit",
    ledger: "yes",
    osEligible: "if-awaited",
    politeness: "assertive-if-blocking",
    cooldownMs: 12_000,
  },
  critical: {
    tone: "maximum",
    consequence: "the product cannot do its job until a human acts",
    examples: "scan engine unreachable, integrity risk",
    dwellMs: 0,
    dismiss: "acted",
    ledger: "pinned",
    osEligible: "yes",
    politeness: "assertive",
    cooldownMs: 0,
  },
};

/** Semantic tone → brand slot set. The severity table never names a colour; this is the second link. */
export const TONE_SLOTS: Record<Tone, { border: string; bg: string; text: string; dot: string }> = {
  neutral: { border: "border-divider", bg: "bg-surface/60", text: "text-slate-300", dot: "bg-slate-500" },
  positive: { border: "border-success/40", bg: "bg-success/10", text: "text-success-soft", dot: "bg-success" },
  cautionary: { border: "border-warn/40", bg: "bg-warn/10", text: "text-warn", dot: "bg-warn" },
  negative: { border: "border-danger/40", bg: "bg-danger/10", text: "text-danger-soft", dot: "bg-danger" },
  maximum: { border: "border-danger", bg: "bg-danger/25", text: "text-white", dot: "bg-danger" },
};

export const slotsFor = (severity: Severity) => TONE_SLOTS[SEVERITY_TABLE[severity].tone];

/** Worst-first rank for preemption and shedding; a decision, not `indexOf`. */
export const SEVERITY_RANK: Record<Severity, number> = { critical: 4, error: 3, warning: 2, success: 1, info: 0 };

/** Awareness-class messages carry the level's dwell scaled by reading length; obligations carry none. */
export function dwellFor(severity: Severity, actionRequired: boolean, title: string): number | null {
  const base = SEVERITY_TABLE[severity].dwellMs;
  if (actionRequired || base === 0) return null;
  const extra = Math.max(0, title.length - 40) * 40; // ~40ms per character past one short line
  return base + extra;
}

/** Announcement grade from the level — the per-call-site choice does not exist. */
export function politenessFor(severity: Severity, blocking: boolean): Politeness {
  const p = SEVERITY_TABLE[severity].politeness;
  if (p === "assertive-if-blocking") return blocking ? "assertive" : "polite";
  return p;
}

/** The recovery of a live problem is at most info — announcing it at the problem's level doubles the alarm. */
export function demoteForRecovery(_original: Severity): Severity {
  return "info";
}

// The scene's closed vocabularies — ONE authority each, and everything else derived from it. This
// file is the four-layer chain of vocabulary-chain-integrity made concrete: the union is the
// authority; the storage constraint, the catalog and the presentation table are derivations gated
// against it (a `Record<Union, …>` annotation fails `tsc` by member name the keystroke a member is
// added). No React. Fixture vocabularies: a scan status (a STATE set) and a finding severity (a
// SEVERITY set) — two sets because their unknown-token directions differ and the scene shows both.

// ── Layer 2: the wire token (the chain's real contract — the one artifact both sides typecheck) ──
export type ScanStatus = "queued" | "running" | "passed" | "warned" | "failed" | "cancelled";
export type Severity = "critical" | "high" | "medium" | "low" | "none";

// ── The semantic color roles (design-tokens' side of the coupling) → themed slot sets ───────────
// vocabulary → role → themed value. The call site never sees the third link; a role is a small SLOT
// SET (text / border / bg / dot), widened here when a consumer needs a slot, never forked.
export type Role = "success" | "warning" | "danger" | "info" | "neutral";
export const ROLE_SLOTS: Record<Role, { text: string; border: string; bg: string; dot: string }> = {
  success: { text: "text-success-soft", border: "border-success/40", bg: "bg-success/10", dot: "bg-success" },
  warning: { text: "text-warn", border: "border-warn/40", bg: "bg-warn/10", dot: "bg-warn" },
  danger: { text: "text-danger-soft", border: "border-danger/40", bg: "bg-danger/10", dot: "bg-danger" },
  info: { text: "text-accent", border: "border-accent/40", bg: "bg-accent/10", dot: "bg-accent" },
  neutral: { text: "text-slate-400", border: "border-slate-600", bg: "bg-slate-500/10", dot: "bg-slate-500" },
};

// ── Layer 4: ONE presentation table per vocabulary, keyed by the union, color role + label key +
// glyph together in one entry (two parallel tables drift the day a member is added to one of them;
// an icon-only map would be the same drift wearing a different hat). ──────────────────────────
export type Presentation = { role: Role; glyph: string; labelKey: LabelKey };

export const SCAN_STATUS_PRESENTATION: Record<ScanStatus, Presentation> = {
  queued: { role: "neutral", glyph: "○", labelKey: "status.queued" },
  running: { role: "info", glyph: "◔", labelKey: "status.running" },
  passed: { role: "success", glyph: "●", labelKey: "status.passed" },
  warned: { role: "warning", glyph: "◑", labelKey: "status.warned" },
  failed: { role: "danger", glyph: "✕", labelKey: "status.failed" },
  cancelled: { role: "neutral", glyph: "◌", labelKey: "status.cancelled" },
};

export const SEVERITY_PRESENTATION: Record<Severity, Presentation> = {
  critical: { role: "danger", glyph: "▲", labelKey: "severity.critical" },
  high: { role: "warning", glyph: "◆", labelKey: "severity.high" },
  medium: { role: "info", glyph: "■", labelKey: "severity.medium" },
  low: { role: "neutral", glyph: "▪", labelKey: "severity.low" },
  none: { role: "success", glyph: "—", labelKey: "severity.none" },
};

// The unknown direction — decided once, out loud, per vocabulary.
// A STATE set degrades to neutral: calm is honest, the system merely has not learned the word.
export const SCAN_STATUS_UNKNOWN: Presentation = { role: "neutral", glyph: "?", labelKey: "status.unknown" };
// A SEVERITY set degrades to the MOST SEVERE member: a future member must never make the interface
// claim that nothing needs attention while a human is still owed a decision.
export const SEVERITY_UNKNOWN: Presentation = { role: "danger", glyph: "▲", labelKey: "severity.unknown" };

// ── Layer 3: the label catalog, keyed by label key, per locale — with a compile-time coverage gate
// that NAMES the missing keys. `Covers` fires at the keystroke, not in CI. ─────────────────────
export type Locale = "en-US" | "de-DE" | "hi-IN";
export const LOCALES: readonly Locale[] = ["en-US", "de-DE", "hi-IN"];
export type LabelKey = `status.${ScanStatus | "unknown"}` | `severity.${Severity | "unknown"}`;

type Covers<Labels, Union extends string> = [Exclude<Union, keyof Labels>] extends [never]
  ? true
  : { MISSING_LABELS_FOR: Exclude<Union, keyof Labels> };

const EN = {
  "status.queued": "Queued", "status.running": "Scanning", "status.passed": "Passed", "status.warned": "Passed with warnings",
  "status.failed": "Failed", "status.cancelled": "Cancelled", "status.unknown": "Unknown status",
  "severity.critical": "Critical", "severity.high": "High", "severity.medium": "Medium", "severity.low": "Low",
  "severity.none": "No findings", "severity.unknown": "Unknown severity",
} as const;
const DE = {
  "status.queued": "Wartend", "status.running": "Läuft", "status.passed": "Bestanden", "status.warned": "Mit Warnungen",
  "status.failed": "Fehlgeschlagen", "status.cancelled": "Abgebrochen", "status.unknown": "Unbekannter Status",
  "severity.critical": "Kritisch", "severity.high": "Hoch", "severity.medium": "Mittel", "severity.low": "Niedrig",
  "severity.none": "Keine Befunde", "severity.unknown": "Unbekannte Schwere",
} as const;
const HI = {
  "status.queued": "कतार में", "status.running": "चल रहा है", "status.passed": "उत्तीर्ण", "status.warned": "चेतावनी सहित",
  "status.failed": "विफल", "status.cancelled": "रद्द", "status.unknown": "अज्ञात स्थिति",
  "severity.critical": "गंभीर", "severity.high": "उच्च", "severity.medium": "मध्यम", "severity.low": "निम्न",
  "severity.none": "कोई निष्कर्ष नहीं", "severity.unknown": "अज्ञात गंभीरता",
} as const;

// The gate, one line per locale: drop a key above and the build error names it.
const _coversEn: Covers<typeof EN, LabelKey> = true;
const _coversDe: Covers<typeof DE, LabelKey> = true;
const _coversHi: Covers<typeof HI, LabelKey> = true;
void _coversEn; void _coversDe; void _coversHi;

export const CATALOG: Record<Locale, Record<LabelKey, string>> = { "en-US": EN, "de-DE": DE, "hi-IN": HI };

// ── Derivations AFTER the gate: the member list comes from the gated map's keys (the cast is a
// derivation, never a gate), and layer 1 — the storage constraint — is mirrored from it. ────────
export const SCAN_STATUS_MEMBERS = Object.keys(SCAN_STATUS_PRESENTATION) as ScanStatus[];
export const SEVERITY_MEMBERS = Object.keys(SEVERITY_PRESENTATION) as Severity[];
export const STORAGE_CHECK = `CHECK (status IN (${SCAN_STATUS_MEMBERS.map((m) => `'${m}'`).join(", ")}))`;

export const isScanStatus = (t: string): t is ScanStatus => (SCAN_STATUS_MEMBERS as string[]).includes(t);
export const isSeverity = (t: string): t is Severity => (SEVERITY_MEMBERS as string[]).includes(t);

// Ordering as a TOTAL MAP, never an array: an array typed as members checks each entry and never
// the count; a total map makes an omitted member a compile error and a rank of 0 distinguishable
// from a lookup miss. Worst-first.
export const SCAN_STATUS_RANK: Record<ScanStatus, number> = { failed: 0, warned: 1, running: 2, queued: 3, cancelled: 4, passed: 5 };
/** An unknown token is placed at the attention end ON PURPOSE — a decision, not `indexOf`'s -1. */
export const UNKNOWN_RANK = -1;
export const rankOf = (token: string): number => (isScanStatus(token) ? SCAN_STATUS_RANK[token] : UNKNOWN_RANK);

// ── The total resolvers: honest degradation, never a crash, never an empty string; `known` lets the
// primitive report the miss (in production, not only in dev — skew is a production phenomenon). ──
export type Resolved = Presentation & { label: string; known: boolean; token: string };

export function resolveStatus(token: string, locale: Locale): Resolved {
  const p = isScanStatus(token) ? SCAN_STATUS_PRESENTATION[token] : SCAN_STATUS_UNKNOWN;
  return { ...p, label: CATALOG[locale][p.labelKey], known: isScanStatus(token), token };
}

export function resolveSeverity(token: string, locale: Locale): Resolved {
  const p = isSeverity(token) ? SEVERITY_PRESENTATION[token] : SEVERITY_UNKNOWN;
  return { ...p, label: CATALOG[locale][p.labelKey], known: isSeverity(token), token };
}

// The production miss ledger: one entry per (category, token), timestamped, readable by the scene.
export type Miss = { category: "scan-status" | "severity"; token: string; at: number };
const misses: Miss[] = [];
const missListeners = new Set<() => void>();
export function reportMiss(category: Miss["category"], token: string, at: number): void {
  if (misses.some((m) => m.category === category && m.token === token)) return;
  misses.push({ category, token, at });
  missListeners.forEach((l) => l());
}
export const listMisses = (): readonly Miss[] => misses;
export function onMiss(l: () => void): () => void {
  missListeners.add(l);
  return () => void missListeners.delete(l);
}

// The gate-policy preview's client state, pure. The editor debounces each draft to
// POST /api/org/gate-policy/preview; every edit bumps a sequence number, and only the answer for the
// LATEST draft is ever shown (an older response landing late would describe a bar the owner already
// changed). No hooks here: usePolicyPreview owns the timer and the fetch, this owns the meaning.

import type { GatePolicy, GateSkip } from "@/lib/scoring/gate";
import type { GatePolicyImpact } from "@/lib/org/gate-policy-impact";

/** The preview route's body (the client never imports the route module itself). */
export interface PolicyPreviewData {
  effective: GatePolicy | null;
  impact: GatePolicyImpact;
  admissionUnread: boolean;
}

export type PreviewStatus = "idle" | "stale" | "loading" | "ready" | "error";

export interface PreviewState {
  status: PreviewStatus;
  /** The draft sequence this state describes. */
  seq: number;
  data: PolicyPreviewData | null;
  error: string | null;
}

export type PreviewAction =
  | { type: "edit"; seq: number }
  | { type: "idle"; seq: number }
  | { type: "request"; seq: number }
  | { type: "response"; seq: number; data: PolicyPreviewData }
  | { type: "error"; seq: number; message: string };

export const INITIAL_PREVIEW: PreviewState = { status: "idle", seq: 0, data: null, error: null };

export function previewReducer(s: PreviewState, a: PreviewAction): PreviewState {
  switch (a.type) {
    case "edit":
      // Keep the last answer on screen (dimmed by the strip) rather than flashing empty per keystroke.
      return { ...s, status: "stale", seq: a.seq, error: null };
    case "idle":
      // Back on the saved bar: there is nothing to preview, and an old answer would describe a draft.
      return { status: "idle", seq: a.seq, data: null, error: null };
    case "request":
      return a.seq === s.seq ? { ...s, status: "loading" } : s;
    case "response":
      return a.seq === s.seq ? { status: "ready", seq: a.seq, data: a.data, error: null } : s;
    case "error":
      return a.seq === s.seq ? { ...s, status: "error", data: null, error: a.message } : s;
  }
}

/** The bar each skippable criterion names, in the strip's sentence. */
const BAR_NAME: Record<GateSkip["code"], string> = {
  governance: "protection",
  provenance: "AI-review",
  admission: "AI-authorship",
  control: "required-controls",
};

const repos = (n: number) => `${n} repo${n === 1 ? "" : "s"}`;

/** "Saving turns 1 repo red, 0 green; 1 cannot be judged on the new protection bar". */
export function previewSummary(d: PolicyPreviewData): string {
  const i = d.impact;
  const parts = [`Saving turns ${repos(i.newlyFailing.length)} red, ${i.newlyPassing.length} green`];
  for (const code of Object.keys(BAR_NAME) as GateSkip["code"][]) {
    const n = i.untested[code] ?? 0;
    if (n > 0) parts.push(`${n} cannot be judged on the new ${BAR_NAME[code]} bar`);
  }
  if (i.unjudged.incomplete > 0) parts.push(`${i.unjudged.incomplete} scored nothing and are not judged`);
  let out = parts.join("; ");
  if (d.effective === null) {
    out += ". The draft sets no valid bar, so saving clears it: this previews the archetype default";
  }
  if (d.admissionUnread) {
    // Never clean: the counts above judged admitted repos on the org bar alone.
    out += ". Admission layers could not be read, so this uses the org bar alone and CI may be stricter";
  }
  return out;
}

function confirmCopy(removed: GatePolicyImpact["removed"]): string {
  const bars = removed.map((r) => `${r.label}${r.was ? ` (${r.was})` : ""}`).join("; ");
  const it = removed.length > 1 ? "those bars" : "that bar";
  return `This save removes ${bars}. The gate will stop enforcing ${it} on every repo. Save anyway?`;
}

export interface PreviewView {
  status: PreviewStatus;
  /** Null while idle or before a first answer. */
  summary: string | null;
  /** "warn" when the answer is partial (admission unread) or turns a repo red. */
  tone: "neutral" | "warn";
  /** The answer on screen describes an older draft (a newer one is in flight). */
  dimmed: boolean;
  error: string | null;
  data: PolicyPreviewData | null;
  saveNeedsConfirm: boolean;
  confirmText: string | null;
  saveLabel: string;
}

export function derivePreview(s: PreviewState): PreviewView {
  const d = s.data;
  const removed = s.status === "ready" && d ? d.impact.removed : [];
  const n = removed.length;
  return {
    status: s.status,
    summary: d ? previewSummary(d) : null,
    tone: d && (d.admissionUnread || d.impact.newlyFailing.length > 0) ? "warn" : "neutral",
    dimmed: s.status === "stale" || s.status === "loading",
    error: s.error,
    data: d,
    saveNeedsConfirm: n > 0,
    confirmText: n > 0 ? confirmCopy(removed) : null,
    saveLabel: n > 0 ? `Save and remove ${n} bar${n === 1 ? "" : "s"}` : "Save policy",
  };
}

/** Save, but ask first when the draft removes a bar (`confirm` is injected: window.confirm in the UI). */
export function guardSave(v: PreviewView, save: () => unknown, confirm: (message: string) => boolean): void {
  if (v.saveNeedsConfirm && !confirm(v.confirmText ?? "")) return;
  void save();
}

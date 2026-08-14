"use client";

// Owner-only editor for the org's AI stance (W3) — the structured-form sibling of GatePolicyEditor:
// JSX only, state/handlers in useStanceEditor.ts. "Save draft" upserts the org's single draft row;
// "Publish" bumps the version and supersedes the prior published stance. The server sanitizes
// (sanitizeStance) and the form re-seeds from its echo, so what's shown is what's stored.

import type { AiStance } from "@/lib/types";
import { TIER_META } from "./stanceShared";
import { TIER_ORDER, useStanceEditor } from "./useStanceEditor";

const FIELD =
  "w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm text-slate-200 outline-none focus:border-accent";

export function StanceEditor({
  org,
  initial,
  nextVersion,
}: {
  org: string;
  /** Seed: the current draft when one exists, else the active published stance, else null. */
  initial: AiStance | null;
  /** The version a publish from here would create (display only — the server recomputes). */
  nextVersion: number;
}) {
  const f = useStanceEditor(org, initial, nextVersion);

  return (
    <div className="mt-4 border-t border-slate-800 pt-4">
      <div className="font-mono text-sm uppercase tracking-widest text-accent">Edit stance</div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-slate-400">
          Permitted tools <span className="text-slate-600">(one per line or comma-separated)</span>
          <textarea value={f.tools} onChange={(e) => f.setTools(e.target.value)} rows={3} className={`${FIELD} mt-1`} placeholder={"Claude Code\nCopilot"} />
        </label>
        <label className="block text-sm text-slate-400">
          Permitted models
          <textarea value={f.models} onChange={(e) => f.setModels(e.target.value)} rows={3} className={`${FIELD} mt-1`} placeholder={"claude-opus\nclaude-sonnet"} />
        </label>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">No-AI zones</span>
          <button
            onClick={f.addZone}
            className="focus-ring rounded-md border border-slate-700 px-2 py-1 font-mono text-xs uppercase tracking-[0.14em] text-slate-400 transition hover:border-accent hover:text-white"
          >
            + zone
          </button>
        </div>
        {f.zones.length === 0 && <p className="mt-1 text-sm text-slate-600">No zones declared.</p>}
        <div className="mt-2 space-y-2">
          {f.zones.map((z, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-divider bg-ink/60 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <label className="block text-xs text-slate-500">
                Repo globs
                <input value={z.repoGlobs} onChange={(e) => f.setZone(i, { repoGlobs: e.target.value })} className={`${FIELD} mt-1`} placeholder="acme/billing-*" />
              </label>
              <label className="block text-xs text-slate-500">
                Path globs <span className="text-slate-600">(advisory, not checked yet)</span>
                <input value={z.pathGlobs} onChange={(e) => f.setZone(i, { pathGlobs: e.target.value })} className={`${FIELD} mt-1`} placeholder="prisma/migrations/**" />
              </label>
              <label className="block text-xs text-slate-500">
                Why
                <input value={z.reason} onChange={(e) => f.setZone(i, { reason: e.target.value })} className={`${FIELD} mt-1`} placeholder="PCI scope" />
              </label>
              <button
                onClick={() => f.removeZone(i)}
                aria-label={`Remove zone ${i + 1}`}
                className="focus-ring self-end rounded-md border border-slate-700 px-2 py-1 font-mono text-xs text-slate-500 transition hover:border-orange-400 hover:text-orange-300"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <span className="text-sm text-slate-400">Review requirements by autonomy tier</span>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {TIER_ORDER.map((tier) => (
            <label key={tier} className="block text-xs text-slate-500">
              {tier} · {TIER_META[tier].name}
              <input
                value={f.reviews[tier] ?? ""}
                onChange={(e) => f.setReview(tier, e.target.value)}
                className={`${FIELD} mt-1`}
                placeholder={tier === "T0" ? "Normal review." : tier === "T3" ? "Human authorship only." : "One human approval + green CI."}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input type="checkbox" checked={f.requireTrailer} onChange={(e) => f.setRequireTrailer(e.target.checked)} className="accent-accent" />
          Require attribution trailers on AI-assisted commits
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input type="checkbox" checked={f.requireHumanApproval} onChange={(e) => f.setRequireHumanApproval(e.target.checked)} className="accent-accent" />
          Require a human approval on AI-attributed PRs
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2" aria-busy={f.busy !== null}>
        <button
          onClick={f.saveDraft}
          disabled={f.busy !== null}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
        >
          {f.busy === "draft" ? "Saving…" : "Save draft"}
        </button>
        <button
          onClick={f.publish}
          disabled={f.busy !== null}
          className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
        >
          {f.busy === "publish" ? "Publishing…" : `Publish v${nextVersion}`}
        </button>
      </div>
      {/* One persistent polite live region (the GatePolicyEditor pattern): outcomes are announced,
          and errors carry a textual prefix so the kind isn't conveyed by color alone. */}
      <div role="status" aria-live="polite" className="mt-2">
        <span className={`font-mono text-sm ${f.msg?.kind === "error" ? "text-orange-300" : "text-emerald-300"}`}>
          {f.msg ? (f.msg.kind === "error" ? `Error: ${f.msg.text}` : f.msg.text) : ""}
        </span>
      </div>
    </div>
  );
}

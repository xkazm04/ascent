"use client";

// THE ADMISSION COLUMN (moonshot #8) — the fleet question "which repositories may an agent work in,
// and who decided?" answered in one place, beside the perimeter that declares the policy.
//
// It fetches its own rows rather than being threaded through the server overview: the rows change
// when an owner records a decision HERE, and a client that owns the read can refresh after its own
// write without a full page round-trip. The stance version comes back with them so staleness is
// computed against one number, not against whatever the page last happened to render.

import { useCallback, useEffect, useState } from "react";
import { Kicker } from "@/components/ui";
import type { RepoAdmissionRow } from "@/lib/org/admission";
import { MODE_HEX, MODE_META, admissionSummary, toAdmissionViews, type AdmissionView } from "./admissionRows";
import { AdmissionOverrideControl } from "./AdmissionOverrideControl";

interface Payload {
  rows: RepoAdmissionRow[];
  stanceVersion: number | null;
}

export function AdmissionColumn({ org, canEdit }: { org: string; canEdit: boolean }) {
  const [views, setViews] = useState<AdmissionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (isStale: () => boolean = () => false) =>
      fetch(`/api/org/admission?org=${encodeURIComponent(org)}`)
        .then((r) => (r.ok ? (r.json() as Promise<Payload>) : Promise.reject(new Error("Admission decisions could not be read."))))
        .then((d) => {
          if (isStale()) return;
          setViews(toAdmissionViews(d.rows ?? [], d.stanceVersion));
          setError(null);
        })
        .catch((e: unknown) => {
          // An unreadable list SAYS SO. Rendering an empty column would read as "no repository is
          // restricted", which is the most dangerous possible misreading of a governance surface.
          if (!isStale()) setError(e instanceof Error ? e.message : "Admission decisions could not be read.");
        }),
    [org],
  );

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <section>
      <Kicker>Admission · who may work here</Kicker>
      <p className="mb-3 mt-2 max-w-3xl type-body text-slate-300">
        The tier a scan DERIVES is a measurement. Admission is the decision: a recorded, overridable
        statement of whether an agent may work in a repository at all — and it is the only half a gate can
        enforce.
      </p>
      {/* UAT `NADIA-L1-09`. The column claimed a decision is "recorded and enforceable" and said
          nothing about WHICH of the compiler's four artifacts a decision actually writes. Three of
          the four are proposals with no UI yet; the fourth lands automatically. An AppSec lead
          reading only the claim left believing all of it had shipped. */}
      <p className="mb-3 max-w-3xl type-body-sm text-slate-500">
        What a decision writes: the <strong className="text-slate-400">gate-policy overlay</strong> only. It applies
        automatically on every gate call, tighten-only, and fails closed if this table cannot be read. The compiler&apos;s
        other three artifacts — the CODEOWNERS managed block, the{" "}
        <code className="font-mono">.ai/manifest.yaml controls.oversight</code> block and the branch-ruleset — are
        proposals a person opens deliberately, and nothing here changes a repository on its own.
      </p>
      {error && (
        <p role="alert" className="type-body-sm text-orange-300">
          {error}
        </p>
      )}
      {!error && views === null && <p className="type-body-sm text-slate-500">Reading admission decisions…</p>}
      {!error && views !== null && (
        <>
          <p className="mb-3 type-body-sm text-slate-400">{admissionSummary(views)}</p>
          <div className="space-y-2">
            {views.map((v) => (
              <AdmissionRow key={v.fullName} org={org} view={v} canEdit={canEdit} onSaved={() => void load()} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function AdmissionRow({ org, view, canEdit, onSaved }: { org: string; view: AdmissionView; canEdit: boolean; onSaved: () => void }) {
  const hex = MODE_HEX[view.mode];
  return (
    <div className="relative overflow-hidden rounded-xl border border-divider bg-surface/40 px-4 py-3">
      <div aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: hex }} />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pl-2">
        <span className="type-mono-sm text-slate-100">{view.name}</span>
        <span className="font-mono type-micro uppercase tracking-[0.18em]" style={{ color: hex }}>
          {MODE_META[view.mode].label}
        </span>
        <span className="font-mono type-micro tabular-nums text-slate-400">{view.tier ?? "tier not assessed"}</span>
        {/* A seed is not a decision, and the surface must never let the two look alike. */}
        <span className="type-body-sm text-slate-500">
          {view.decided ? `decided by @${view.decidedBy}` : "seeded from the derived tier — nobody has decided"}
        </span>
        {view.overridesDerived && (
          <span className="font-mono type-micro text-orange-300">overrides derived {view.overridesDerived}</span>
        )}
        {view.stale && (
          <span className="font-mono type-micro text-orange-300" title="Recorded against an older stance version and recompiled against the current one — not re-affirmed.">
            stale decision
          </span>
        )}
        {view.rulesetId && <span className="font-mono type-micro text-emerald-300">ruleset applied</span>}
        <span className="ml-auto type-body-sm text-slate-500">{MODE_META[view.mode].blurb}</span>
      </div>
      {canEdit && <AdmissionOverrideControl org={org} view={view} onSaved={onSaved} />}
    </div>
  );
}

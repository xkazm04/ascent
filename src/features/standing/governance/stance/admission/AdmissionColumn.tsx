"use client";

// THE ADMISSION COLUMN (moonshot #8) — the fleet question "which repositories may an agent work in,
// and who decided?" answered in one place, beside the perimeter that declares the policy.
//
// It fetches its own rows rather than being threaded through the server overview: the rows change
// when an owner records a decision HERE, and a client that owns the read can refresh after its own
// write without a full page round-trip. The stance version comes back with them so staleness is
// computed against one number, not against whatever the page last happened to render.
//
// Org UX redesign §2: the column opens on a `BandLadder` of the three admission rungs, and the
// sentence that used to open it — "the tier a scan DERIVES is a measurement, admission is the
// decision" — is the `decided` accent ring plus the legend hint the kit generates for it.

import { useCallback, useEffect, useState } from "react";
import { Kicker } from "@/components/ui";
import { BandLadder, Legend, WhyChip } from "@/components/org/viz";
import type { RepoAdmissionRow } from "@/lib/org/admission";
import { admissionSummary, toAdmissionViews, type AdmissionView } from "./admissionRows";
import { admissionBands, admissionEdge, admissionStates } from "./admissionLadder";
import { AdmissionRow } from "./AdmissionRow";

interface Payload {
  rows: RepoAdmissionRow[];
  stanceVersion: number | null;
}

/**
 * UAT `NADIA-L1-09`, demoted rather than deleted. The column claimed a decision is "recorded and
 * enforceable" and said nothing about WHICH of the compiler's four artifacts one actually writes.
 * The one-line claim stays in first sight — that is the half the finding was about — and the
 * enumeration moves behind the chip.
 */
const WRITES_HINT =
  "The gate-policy overlay applies automatically on every gate call, tighten-only, and fails closed if " +
  "the table cannot be read. The compiler's other three artifacts — the CODEOWNERS managed block, the " +
  ".ai/manifest.yaml controls.oversight block and the branch-ruleset — are proposals a person opens " +
  "deliberately. Nothing here changes a repository on its own.";

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
      <div className="flex items-center gap-1.5">
        <Kicker>Admission · who may work here</Kicker>
        <WhyChip label="what a decision writes" hint={WRITES_HINT} />
      </div>
      <p className="mb-3 mt-2 max-w-3xl type-body-sm text-slate-400">
        A decision writes the <strong className="text-slate-300">gate-policy overlay</strong> — and only that.
      </p>
      {error && (
        <p role="alert" className="type-body-sm text-orange-300">
          {error}
        </p>
      )}
      {!error && views === null && <p className="type-body-sm text-slate-500">Reading admission decisions…</p>}
      {/* Every TRACKED repository is listed, decided or not, because the first decision has to be
          makeable from here: this list read the decision table until 2026-09, and nothing in the
          product seeds it, so an org that had never called a gate saw an empty column and no repo to
          click. Reading this list writes nothing — the derived state is computed in memory. */}
      {!error && views !== null && (
        <>
          {views.length > 0 && (
            // §2.2 — first sight is the rung ladder, not the sentence that used to name it.
            <div className="mb-4 max-w-md">
              <BandLadder bands={admissionBands(views)} edge={admissionEdge(views)} title="Admission rungs" />
              <Legend className="mt-3" states={admissionStates(views)} />
            </div>
          )}
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

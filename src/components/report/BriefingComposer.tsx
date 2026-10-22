"use client";

// The report header's LLM briefing control (export-1). The chip keeps its one-click copy; the
// adjacent "Scope" pill opens a composer that narrows the briefing to chosen dimensions, shows its
// size, and copies either the text or the equivalent `GET /api/report/llm?dims=` URL.
//
// One composition: every copy here is `composeBriefing(report, selection, lifts)`, the exact call the
// endpoint makes, so the copied text equals the body the copied URL serves. `lifts` is the page's own
// server-read map (`serverLifts`), so the briefing carries the measured clause the roadmap on screen
// shows, never more. No selection and no lifts copies today's `reportLlmMarkdown(report)` bytes.

import { useMemo, useState } from "react";
import type { DimensionId, ScanReport } from "@/lib/types";
import type { LiftDistribution } from "@/lib/outcomes/aggregate";
import { scoreHex } from "@/lib/ui";
import { Kicker, Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui";
import { HairlineList } from "@/components/kit";
import { CopyForLlm } from "@/components/CopyForLlm";
import { pillClass } from "@/components/report/pill";
import { briefingHref, briefingPreview, composeBriefing } from "@/lib/report/briefing-scope";

/** "214 lines, ~3,100 tokens", plus the scope it covers. Pure, from the exact copied string. */
export function previewLine(text: string, picked: number, total: number): string {
  const p = briefingPreview(text);
  const scope = picked === 0 || picked === total ? "whole report" : `${picked} of ${total} dimensions`;
  return `${scope} · ${p.lines.toLocaleString("en-US")} lines · ~${p.approxTokens.toLocaleString("en-US")} tokens`;
}

/** Absolute when a browser is present (an agent needs a full URL), the path otherwise. */
function absolute(href: string): string {
  return typeof window === "undefined" ? href : `${window.location.origin}${href}`;
}

export function BriefingComposer({
  report,
  lifts,
  org,
}: {
  report: ScanReport;
  /** The org's measured lift map, as the page read it. Absent on the live-scan path. */
  lifts?: ReadonlyMap<string, LiftDistribution> | null;
  /** The page's own `?org=` hint, forwarded into the URL (the export door re-gates it). */
  org?: string | null;
}) {
  const { repo } = report;
  const repoParam = `${repo.owner}/${repo.name}${repo.headSha ? `@${repo.headSha}` : ""}`;
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<DimensionId[]>([]);
  // Report order, whatever the click order, so the text and the URL name the selection identically.
  const ordered = useMemo(
    () => report.dimensions.map((d) => d.id).filter((id) => picked.includes(id)),
    [report.dimensions, picked],
  );
  const text = useMemo(() => composeBriefing(report, ordered, lifts), [report, ordered, lifts]);
  const whole = useMemo(() => composeBriefing(report, null, lifts), [report, lifts]);
  const total = report.dimensions.length;
  const scoped = ordered.length > 0 && ordered.length < total;

  const toggle = (id: DimensionId) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <>
      {/* The same briefing `GET /api/report/llm?repo=...` serves: one composition (composeBriefing),
          so the clipboard payload and the endpoint body are identical by construction (G5-17). */}
      <CopyForLlm
        text={whole}
        label="Copy for LLM"
        ariaLabel={`Copy the ${repo.owner}/${repo.name} maturity briefing for an LLM`}
      />
      {total > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={pillClass({ focusRing: true, textSm: true })}
          title="Scope the LLM briefing to chosen dimensions, see its size, or copy its URL"
          aria-label={`Scope the briefing for ${repo.owner}/${repo.name}`}
        >
          Scope
        </button>
      )}

      <Modal open={open} onClose={() => setOpen(false)} ariaLabel="Compose the LLM briefing" size="lg">
        <ModalHeader kicker="LLM briefing" title="Scope the briefing" context={repoParam} />
        <ModalBody className="max-h-[60vh] overflow-y-auto">
          <p className="type-body-sm text-slate-400">
            Nothing selected copies the whole report. Pick dimensions to hand an agent only those: the
            briefing then opens by saying it is partial, and the overall score stays a whole-repository
            figure.
          </p>
          <HairlineList className="mt-4">
            {report.dimensions.map((d) => (
              <li key={d.id}>
                <label className="flex cursor-pointer items-center gap-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={picked.includes(d.id)}
                    onChange={() => toggle(d.id)}
                    className="focus-ring size-4 shrink-0 accent-accent"
                  />
                  <span className="w-8 shrink-0 type-label tracking-widest text-slate-500">{d.id}</span>
                  <span className="min-w-0 flex-1 truncate type-body-sm text-slate-200">{d.name}</span>
                  <span className="w-10 shrink-0 text-right type-mono-sm tabular-nums" style={{ color: scoreHex(d.score) }}>
                    {d.score}
                  </span>
                </label>
              </li>
            ))}
          </HairlineList>
        </ModalBody>
        <ModalFooter>
          <Kicker tone="muted">
            <span data-testid="briefing-preview">{previewLine(text, ordered.length, total)}</span>
          </Kicker>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setPicked([])} className={pillClass({ focusRing: true, textSm: true })}>
              Clear
            </button>
            <CopyForLlm
              text={absolute(briefingHref({ repo: repoParam, dims: scoped ? ordered : null, org }))}
              label="Copy URL"
              ariaLabel={`Copy the briefing URL for ${repo.owner}/${repo.name}`}
              title="Copy the GET /api/report/llm URL that serves exactly this briefing"
            />
            <CopyForLlm
              text={text}
              label={scoped ? "Copy scoped briefing" : "Copy briefing"}
              ariaLabel={`Copy the scoped briefing for ${repo.owner}/${repo.name}`}
            />
          </div>
        </ModalFooter>
      </Modal>
    </>
  );
}

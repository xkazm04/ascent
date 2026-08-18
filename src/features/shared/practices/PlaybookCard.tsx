"use client";

// One company playbook (Direction #3.2): display + per-playbook "Copy for LLM" + remove, plus adoption
// — how many repos applied it and the average dimension lift since — and a control to mark/unmark repos
// as having applied it (the explicit adoption signal). Applied set is managed locally + synced to the
// API; lift is the server-computed historical metric (changes only after the next scan).
// State/handlers live in `usePlaybookCard` (200-LOC cap).

import { CopyForLlm } from "@/components/CopyForLlm";
import { ConfirmAction, draftPrConfirm } from "@/components/ConfirmAction";
import { playbookMarkdown, playbookStarterFile } from "@/lib/org/playbook-brief";
import { PlaybookApplyControls } from "@/features/shared/practices/PlaybookCardActions";
import { PlaybookAdoptionRow } from "@/features/shared/practices/PlaybookCardAdoption";
import { PlaybookApplyBatch } from "@/features/shared/practices/PlaybookApplyBatch";
import { usePlaybookCard } from "@/features/shared/practices/usePlaybookCard";
import type { PlaybookAdoption, PlaybookRow } from "@/lib/db";

export function PlaybookCard({
  playbook: p,
  slug,
  dimLabel,
  adoption,
  repoOptions,
  onRemove,
}: {
  playbook: PlaybookRow;
  slug: string;
  dimLabel: string;
  adoption: PlaybookAdoption | undefined;
  repoOptions: string[];
  onRemove: () => void;
}) {
  const c = usePlaybookCard({ playbook: p, adoption });

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        {/* break-words lets a long unbroken playbook title wrap within this min-w-0 flex item instead
            of overflowing the card; the title stays fully visible (it sits inline with the dim badge). */}
        <div className="min-w-0 break-words">
          <span className="font-medium text-white">{p.title}</span>
          <span className="ml-2 rounded border border-slate-700 px-1.5 py-0.5 font-mono text-sm text-slate-400">
            {p.dimId} · {dimLabel}
          </span>
          {p.version > 1 && (
            <span className="ml-2 font-mono text-sm text-slate-500" title={`Last edited ${p.updatedAt.slice(0, 10)}`}>
              v{p.version}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <CopyForLlm text={playbookMarkdown(p, dimLabel)} label="Copy" ariaLabel={`Copy "${p.title}" for LLM`} />
          <button onClick={onRemove} className="focus-ring rounded font-mono text-sm text-slate-600 hover:text-orange-300">remove</button>
        </div>
      </div>
      {p.summary && <p className="mt-1 text-base text-slate-400">{p.summary}</p>}
      {p.steps.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-slate-300">
          {p.steps.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="select-none text-slate-600">·</span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      )}

      {/* PRAC-5: preview the exact docs/playbooks/<slug>.md the "Open draft PR" action commits. */}
      <details className="group mt-2">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-mono text-sm text-slate-500 transition hover:text-slate-300 [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="text-slate-600 transition-transform group-open:rotate-90">›</span>
          Preview starter file
        </summary>
        <pre className="mt-2 max-h-60 overflow-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono text-xs whitespace-pre-wrap text-slate-300">
          {playbookStarterFile(p, dimLabel)}
        </pre>
      </details>

      <PlaybookAdoptionRow playbook={p} slug={slug} adoption={adoption} applied={c.applied} />

      {c.applied.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {c.applied.map((r) => (
            <span key={r} className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-sm text-slate-300">
              {r.split("/").pop()}
              <button onClick={() => c.unapply(r)} className="text-slate-600 hover:text-orange-300" title={`Unmark ${r}`}>×</button>
            </span>
          ))}
        </div>
      )}

      <PlaybookApplyControls
        repoOptions={repoOptions}
        applied={c.applied}
        pick={c.pick}
        onPick={c.setPick}
        onApply={c.apply}
        onOpenPr={() => c.setConfirmingPr(true)}
        prBusy={c.prBusy || c.batchBusy}
      />

      {/* G7-24: the same one-click rollout practices already had, for an org's OWN playbook — bounded
          at MAX_BATCH repos per run and admin-gated server-side. */}
      <PlaybookApplyBatch
        playbookId={p.id}
        title={p.title}
        org={slug}
        repoOptions={repoOptions}
        applied={c.applied}
        singleBusy={c.prBusy}
        onBusyChange={c.setBatchBusy}
        onApplied={(repos) => c.setApplied((a) => [...new Set([...a, ...repos])])}
      />

      {/* Always mounted, toggled by `open`, so Modal's portal is armed before the Cancel-focus effect
          runs. `pick` can't change while the overlay is up, so openPr() reads the confirmed repo. */}
      <ConfirmAction
        open={c.confirmingPr}
        busy={c.prBusy}
        onCancel={() => c.setConfirmingPr(false)}
        onConfirm={() => {
          c.setConfirmingPr(false);
          void c.openPr();
        }}
        {...(c.pick
          ? draftPrConfirm(c.pick, `the "${p.title}" playbook`)
          : { title: "", body: "", confirmLabel: "", tone: "default" as const })}
      />
      {/* role="alert" so AT announces the failure — an optimistic chip silently rolling back was the
          exact bug markError was added to surface, but without the role it stayed invisible to screen
          readers while the adoption row's trackError already announced (playbooks #4). */}
      {c.markError && <p role="alert" className="mt-2 text-sm text-orange-300">{c.markError}</p>}
      {c.prError && <p role="alert" className="mt-2 text-sm text-orange-300">{c.prError}</p>}
      {c.prResult && (
        <p className="mt-2 text-sm text-emerald-300">
          {c.prResult.reused ? "Existing draft PR: " : "Draft PR opened: "}
          <a href={c.prResult.url} target="_blank" rel="noreferrer" className="underline hover:text-white">
            {c.prResult.url}
          </a>
        </p>
      )}
    </div>
  );
}

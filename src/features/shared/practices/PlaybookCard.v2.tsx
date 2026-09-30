"use client";

// Prism playbook, inside the practice level. The Panel outside is the focus object, so this is not
// a second card. Apply fields are the kit controls. Adoption and batch stay the shared actions.
import { CopyForLlm } from "@/components/CopyForLlm";
import { ConfirmAction, draftPrConfirm } from "@/components/ConfirmAction";
import { playbookMarkdown, playbookStarterFile } from "@/lib/org/playbook-brief";
import { Chip, ChipRow, DimensionMark, GhostAction, parseDimension } from "@/components/kit";
import { PlaybookApplyControlsV2 } from "./PlaybookApplyControls.v2";
import { PlaybookAdoptionRow } from "./PlaybookCardAdoption";
import { PlaybookApplyBatch } from "./PlaybookApplyBatch";
import { usePlaybookCard } from "./usePlaybookCard";
import type { PlaybookAdoption, PlaybookRow } from "@/lib/db";

export function PlaybookCardV2({
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
  const dim = parseDimension(p.dimId);
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 break-words">
          <span className="font-medium text-slate-100">{p.title}</span>
          <span className="ml-2 inline-flex items-center gap-2 align-middle">
            {dim ? <DimensionMark id={p.dimId} label={dimLabel} /> : <span className="type-caption text-slate-400">{p.dimId}</span>}
            <span className="type-caption text-slate-400">{dimLabel}</span>
          </span>
          {p.version > 1 && (
            <span className="ml-2 type-caption text-slate-400" title={`Last edited ${p.updatedAt.slice(0, 10)}`}>
              v{p.version}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <CopyForLlm text={playbookMarkdown(p, dimLabel)} label="Copy" ariaLabel={`Copy "${p.title}" for LLM`} />
          <GhostAction onClick={onRemove}>Remove</GhostAction>
        </div>
      </div>
      {p.summary && <p className="mt-2 text-slate-400">{p.summary}</p>}
      {p.steps.length > 0 && (
        <ul className="mt-2 space-y-1 text-slate-200">
          {p.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
      <details className="group mt-3">
        <summary className="cursor-pointer text-slate-400 hover:text-slate-100">Preview starter file</summary>
        <pre className="mt-2 max-h-60 overflow-auto border border-divider p-3 font-mono type-caption whitespace-pre-wrap text-slate-300">
          {playbookStarterFile(p, dimLabel)}
        </pre>
      </details>
      <PlaybookAdoptionRow playbook={p} slug={slug} adoption={adoption} applied={c.applied} proposed={c.proposed} />
      {c.applied.length > 0 && (
        <ChipRow className="mt-2">
          {c.applied.map((r) => (
            <Chip key={r} title={r}>
              {r.split("/").pop()}
              <button type="button" onClick={() => c.unapply(r)} className="text-slate-400 hover:text-slate-100" title={`Unmark ${r}`}>
                ×
              </button>
            </Chip>
          ))}
        </ChipRow>
      )}
      <PlaybookApplyControlsV2
        repoOptions={repoOptions}
        applied={c.applied}
        pick={c.pick}
        onPick={c.setPick}
        onApply={c.apply}
        onOpenPr={() => c.setConfirmingPr(true)}
        prBusy={c.prBusy || c.batchBusy}
      />
      <PlaybookApplyBatch
        playbookId={p.id}
        title={p.title}
        org={slug}
        repoOptions={repoOptions}
        applied={c.applied}
        singleBusy={c.prBusy}
        onBusyChange={c.setBatchBusy}
        onApplied={(repos) => c.setProposed((a) => [...new Set([...a, ...repos])])}
      />
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
      {c.markError && (
        <p role="alert" className="mt-2 text-slate-100">
          <span aria-hidden>! </span>
          {c.markError}
        </p>
      )}
      {c.prError && (
        <p role="alert" className="mt-2 text-slate-100">
          <span aria-hidden>! </span>
          {c.prError}
        </p>
      )}
      {c.prResult && (
        <p className="mt-2 text-slate-200">
          {c.prResult.reused ? "Existing draft PR: " : "Draft PR opened: "}
          <a href={c.prResult.url} target="_blank" rel="noreferrer" className="text-slate-100 underline">
            {c.prResult.url}
          </a>
        </p>
      )}
    </div>
  );
}

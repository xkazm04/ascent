"use client";

// playbooks-1: "N repos on v1-v2 -> update to v3". The revision half of a playbook's rollout, shown on
// the card once the playbook has been edited (version > 1). Behind repos are preselected; an
// unversioned repo with a landed file is listed but not preselected; a diverged repo (its landed file
// was edited or removed in the repo) is listed with the reason and is never selectable. The run is
// admin-only server-side, capped at 25, opens DRAFT PRs, and sits behind a confirm that names the org
// and every repo and needs the org slug typed.

import { CONTROL_CLASS, Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui";
import { revisionRolloutLine } from "@/lib/org/playbookRevisionModel";
import { PracticeApplyBatchResults } from "./PracticeApplyBatchResults";
import { usePlaybookRevision } from "./usePlaybookRevision";

const short = (repo: string) => repo.split("/").pop() ?? repo;

export function PlaybookRevisionRollout({ playbookId, org, version }: { playbookId: string; org: string; version: number }) {
  const r = usePlaybookRevision({ playbookId, org });
  if (version <= 1) return null;
  const sets = r.sets;
  const busy = r.phase === "running";

  return (
    <div className="mt-3 border-t border-slate-800 pt-3">
      {!sets ? (
        <button
          onClick={() => void r.load()}
          disabled={r.phase === "loading"}
          className="type-mono-sm uppercase tracking-widest text-accent hover:text-white disabled:opacity-60"
        >
          {r.phase === "loading" ? "Checking adopters..." : `Check which adopters are behind v${version}`}
        </button>
      ) : (
        <div>
          <p className="type-mono-sm uppercase tracking-widest text-slate-400">{revisionRolloutLine(sets)}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {r.selectable.map((repo) => {
              const from = sets.behind.find((b) => b.repo === repo)?.appliedVersion;
              return (
                <label key={repo} className="inline-flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 type-mono-sm text-slate-300">
                  <input type="checkbox" checked={r.selected.has(repo)} onChange={() => r.toggle(repo)} disabled={busy} />
                  {short(repo)} <span className="text-slate-500">{from ? `v${from}` : "unversioned"}</span>
                </label>
              );
            })}
          </div>
          {sets.diverged.length > 0 && (
            <p className="mt-2 type-body-sm text-slate-500">
              Not offered (the landed file was edited or removed in the repo):{" "}
              {sets.diverged.map((d) => `${short(d.repo)} (${d.state})`).join(", ")}.
            </p>
          )}
          {sets.inFlight.length > 0 && (
            <p className="mt-1 type-body-sm text-slate-500">PR open: {sets.inFlight.map(short).join(", ")}.</p>
          )}
          {r.selectedRepos.length > 0 && (
            <button
              onClick={() => r.setConfirming(true)}
              disabled={busy}
              className="mt-2 rounded-lg bg-accent px-3 py-1.5 type-body-sm font-semibold text-on-accent hover:bg-accent-soft disabled:opacity-60"
            >
              Open {r.selectedRepos.length} draft {r.selectedRepos.length === 1 ? "PR" : "PRs"} to v{sets.version}
            </button>
          )}
        </div>
      )}
      {r.error && <p role="alert" className="mt-2 type-body-sm text-orange-300">{r.error}</p>}
      <PracticeApplyBatchResults
        batchResults={r.results}
        batchSummary={r.results ? { attempted: r.results.length, skipped: r.skipped } : null}
      />

      <Modal open={r.confirming} onClose={() => r.setConfirming(false)} locked={busy} ariaLabel={r.confirm.title}>
        <ModalHeader kicker="Confirm revision" title={r.confirm.title} />
        <ModalBody>
          <p className="type-body text-slate-300">{r.confirm.body}</p>
          <input
            aria-label={`Type ${org} to confirm`}
            value={r.typed}
            onChange={(e) => r.setTyped(e.target.value)}
            className={`${CONTROL_CLASS} mt-3`}
            placeholder={org}
            autoComplete="off"
          />
        </ModalBody>
        <ModalFooter>
          <span className="type-caption text-slate-500">Esc or Cancel to back out</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => r.setConfirming(false)} disabled={busy} className={`${CONTROL_CLASS} max-w-max`}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void r.run()}
              disabled={busy || !r.confirm.ready}
              className="focus-ring rounded-lg bg-accent px-3 py-2 type-body font-semibold text-on-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Working..." : "Open draft PRs"}
            </button>
          </div>
        </ModalFooter>
      </Modal>
    </div>
  );
}

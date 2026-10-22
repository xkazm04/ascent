"use client";

// Bring your share in yourself. The share route accepts the browser session and nothing else (the CLI
// has no per-user credential), so this panel is the door: paste or drop a share file, see what leaves
// before it leaves, then commit in one click. Delete-my-share sits behind a confirm.
//
// The preview is `careSharePreview`, which runs the server's own validator and ledger, so the browser
// refuses exactly what the route refuses. The org-bands consent is a checkbox that starts OFF and is
// only ever ticked by the developer: the file's own flag is reported, never obeyed. On a preview
// fixture (`view.demo`) commit and delete are disabled and no request can be made.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { chipButtonClass, Kicker } from "@/components/ui";
import { MatrixGrid } from "@/components/shared/viz";
import { CARE_LEDGER_AXES, careLedgerRows } from "./careLedgerRows";
import { commitShare, deleteShare, type CareShareOutcome } from "./careShareClient";
import { CARE_SHARE_SECTION_LABEL, careShareLeaves, careSharePreview, careSharePreviewCopy as COPY } from "./shareUploadModel";
import type { DeveloperView } from "@/lib/org/developer-view";

const OUTCOME_COPY: Record<CareShareOutcome["state"], string> = {
  saved: "Shared. The page now shows what is stored.",
  deleted: "Deleted. Nothing of your share is stored any more.",
  refused: "The server refused the share:",
  "signed-out": "Sign in to share. The share door only opens for your own browser session.",
  "too-large": COPY.tooLarge,
  "nothing-stored": "Nothing was stored for you, so there was nothing to delete.",
  unavailable: "Sharing is not available here:",
  failed: "Something went wrong:",
};

function OutcomeLine({ outcome }: { outcome: CareShareOutcome | null }) {
  if (!outcome) return null;
  const detail = outcome.state === "refused" ? outcome.errors : "message" in outcome ? [outcome.message] : [];
  const tone = outcome.state === "saved" || outcome.state === "deleted" ? "text-success-soft" : "text-warn";
  return (
    <div className={`type-body-sm ${tone}`}>
      {OUTCOME_COPY[outcome.state]}
      {detail.length ? <ul className="mt-1 list-disc pl-5 font-mono type-caption">{detail.map((e) => <li key={e}>{e}</li>)}</ul> : null}
    </div>
  );
}

export function CareShareUpload({ view, onClose }: { view: DeveloperView; onClose?: () => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CareShareOutcome | null>(null);
  const preview = useMemo(() => careSharePreview(text, view, consent), [text, view, consent]);
  const fixture = Boolean(view.demo);
  const refresh = () => router.refresh();

  function take(next: string) {
    setText(next);
    setOutcome(null);
  }
  async function readFile(file: File | undefined) {
    if (file) take(await file.text());
  }
  async function run(request: () => Promise<CareShareOutcome>) {
    if (fixture || busy) return;
    setBusy(true);
    setOutcome(await request());
    setBusy(false);
    setConfirmDelete(false);
  }

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-divider bg-surface/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <Kicker tone="muted">Bring your share in</Kicker>
        {onClose ? (
          <button type="button" className={chipButtonClass("idle")} onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>
      {fixture ? <p className="type-body-sm text-warn">{COPY.fixture}</p> : null}

      <textarea
        aria-label="Share JSON"
        value={text}
        rows={6}
        spellCheck={false}
        placeholder='{ "contract": 1, ... }'
        onChange={(e) => take(e.target.value)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void readFile(e.dataTransfer.files[0]);
        }}
        className="focus-ring w-full rounded-lg border border-divider bg-surface-strong/60 p-3 font-mono type-caption text-slate-200"
      />
      <label className="flex items-center gap-2 type-body-sm text-slate-400">
        <span>Or choose a file</span>
        <input type="file" accept="application/json,.json" onChange={(e) => void readFile(e.target.files?.[0])} className="type-caption" />
      </label>

      <label className="flex items-start gap-2 type-body-sm text-slate-300">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
        <span>
          Add my shared values to the anonymous org bands
          <span className="block type-caption text-slate-500">Off unless you tick it. The bands are floored so no one person can be read out of them.</span>
        </span>
      </label>

      {preview.state === "empty" ? <p className="type-body-sm text-slate-500">{COPY.empty}</p> : null}
      {preview.state === "too-large" ? <p className="type-body-sm text-warn">{COPY.tooLarge} This one is {Math.ceil(preview.bytes / 1024)} KB.</p> : null}
      {preview.state === "invalid" || preview.state === "refused" ? (
        <div className="type-body-sm text-warn">
          Refused in your browser, before anything left it:
          <ul className="mt-1 list-disc pl-5 font-mono type-caption">{preview.errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      ) : null}
      {preview.state === "ready" ? (
        <div className="space-y-3">
          <div className="type-body-sm text-slate-300">
            What leaves: {careShareLeaves(preview).join(", ") || "only the contract marker"}.
          </div>
          {preview.fileConsent && !consent ? <p className="type-body-sm text-slate-400">{COPY.fileConsent}</p> : null}
          {preview.stopsSharing.length ? (
            <p className="type-body-sm text-warn">
              You stop sharing: {preview.stopsSharing.map((s) => CARE_SHARE_SECTION_LABEL[s]).join(", ")}. {COPY.replaces}
            </p>
          ) : (
            <p className="type-caption text-slate-500">{COPY.replaces}</p>
          )}
          <MatrixGrid title="What this share would light" axes={CARE_LEDGER_AXES} rows={careLedgerRows(preview.ledger)} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!preview.canCommit || busy || fixture}
          className={chipButtonClass("success", "disabled:cursor-not-allowed disabled:opacity-40")}
          onClick={() => preview.state === "ready" && run(() => commitShare(preview.body, refresh))}
        >
          Commit this share
        </button>
        {view.setup.lastShareAt && !confirmDelete ? (
          <button
            type="button"
            disabled={fixture || busy}
            className={chipButtonClass("danger", "disabled:cursor-not-allowed disabled:opacity-40")}
            onClick={() => !fixture && setConfirmDelete(true)}
          >
            Delete my share
          </button>
        ) : null}
      </div>
      {confirmDelete ? (
        <div className="flex flex-wrap items-center gap-2 type-body-sm text-slate-300">
          <span>Delete your stored share? The row is removed whole; nothing of it stays behind.</span>
          <button type="button" disabled={busy} className={chipButtonClass("danger")} onClick={() => run(() => deleteShare(refresh))}>
            Delete it
          </button>
          <button type="button" className={chipButtonClass("idle")} onClick={() => setConfirmDelete(false)}>
            Keep it
          </button>
        </div>
      ) : null}
      <div aria-live="polite">
        <OutcomeLine outcome={outcome} />
      </div>
    </div>
  );
}

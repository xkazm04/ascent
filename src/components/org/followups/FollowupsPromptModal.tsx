"use client";

// The hand-off: the batch's fix prompt, ready to paste into a local coding agent, and the one write
// that records the claim. Copy first, then "Hand off" marks every picked item in progress
// (POST /api/org/followups/handoff) and refreshes the ledger. Copying without handing off is allowed —
// a user may want to read the prompt before committing the batch — but the button says which state
// they are leaving in.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui";
import { FOLLOWUP_TRAILER, buildFixPrompt } from "@/lib/org/followups";
import type { FollowUpRow } from "./followupsModel";

export function FollowupsPromptModal({
  org,
  items,
  onClose,
  onHandedOff,
}: {
  org: string;
  /** null = closed. */
  items: FollowUpRow[] | null;
  onClose: () => void;
  onHandedOff: (ids: string[]) => void;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = items !== null && items.length > 0;
  const prompt = open ? buildFixPrompt(items!, { org, generatedAt: new Date().toISOString().slice(0, 10) }) : "";
  const repos = open ? new Set(items!.map((i) => i.repo)).size : 0;
  const alreadyOff = open ? items!.filter((i) => i.status === "in_progress").length : 0;
  const toMark = open ? items!.filter((i) => i.status === "open").map((i) => i.id) : [];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Clipboard blocked — select the text and copy it manually.");
    }
  };

  const handoff = async () => {
    if (toMark.length === 0) return onClose();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/org/followups/handoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, ids: toMark }),
      });
      const d = (await r.json().catch(() => ({}))) as { marked?: string[]; error?: string };
      if (!r.ok) throw new Error(d.error ?? `Failed (${r.status}).`);
      onHandedOff(d.marked ?? toMark);
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Hand-off failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} ariaLabel="Fix prompt for the selected follow-ups" size="reading" locked={busy}>
      <ModalHeader
        kicker="Fix prompt"
        title={`${items?.length ?? 0} follow-up${items?.length === 1 ? "" : "s"} · ${repos} repositor${repos === 1 ? "y" : "ies"}`}
        context={`Paste into your local agent. Each resolving commit should carry \`${FOLLOWUP_TRAILER}: <id>\`; the next scan of the default branch closes what landed.`}
      />
      <ModalBody>
        <pre className="max-h-[52vh] overflow-auto whitespace-pre-wrap rounded-xl border border-divider bg-ink p-4 font-mono text-sm leading-relaxed text-slate-200">{prompt}</pre>
        {alreadyOff > 0 && (
          <p className="mt-3 font-mono text-xs text-slate-500">
            {alreadyOff} of these {alreadyOff === 1 ? "is" : "are"} already handed off — included in the prompt, not re-marked.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </ModalBody>
      <ModalFooter>
        <button type="button" onClick={copy} className="focus-ring rounded-lg border border-divider px-3 py-1.5 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white">
          {copied ? "Copied ✓" : "Copy prompt"}
        </button>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-slate-500">
            {toMark.length === 0 ? "Nothing new to mark" : `Marks ${toMark.length} as handed off`}
          </span>
          <button
            type="button"
            onClick={handoff}
            disabled={busy}
            className="focus-ring rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-on-accent transition hover:bg-accent-soft disabled:opacity-50"
          >
            {busy ? "Marking…" : toMark.length === 0 ? "Close" : "Hand off"}
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
}

"use client";

// Prism new-practice dialog. Same seed, same POST, same re-list. Fields are the kit controls.
import { useState } from "react";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui";
import { GhostAction, PrimaryAction } from "@/components/kit";
import { PLAYBOOK_TEMPLATES } from "@/lib/org/playbook-templates";
import type { PlaybookDraft } from "./promotePractice";
import type { PlaybookRow } from "@/lib/db";
import { NewPracticeFieldsV2 } from "./NewPracticeFields.v2";

interface DimOption {
  id: string;
  label: string;
}

export function NewPracticeModalV2({
  open,
  slug,
  dimOptions,
  draft,
  onClose,
  onCreated,
}: {
  open: boolean;
  slug: string;
  dimOptions: DimOption[];
  draft?: PlaybookDraft | null;
  onClose: () => void;
  onCreated: (playbooks: PlaybookRow[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [dimId, setDimId] = useState(dimOptions[0]?.id ?? "D1");
  const [summary, setSummary] = useState("");
  const [stepsText, setStepsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed while rendering, keyed on open + draft, so the first paint is the prefill (same as v1).
  const seedKey = open && draft ? `${draft.dimId}:${draft.title}` : null;
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (seedKey !== null && seedKey !== seededFor && draft) {
    setSeededFor(seedKey);
    setTitle(draft.title);
    setDimId(draft.dimId);
    setSummary(draft.summary);
    setStepsText(draft.steps.join("\n"));
    setError(null);
  } else if (seedKey === null && seededFor !== null) {
    setSeededFor(null);
  }

  function applyTemplate(idx: number) {
    const t = PLAYBOOK_TEMPLATES[idx];
    if (!t) return;
    setTitle(t.title);
    setDimId(t.dimId);
    setSummary(t.summary);
    setStepsText(t.steps.join("\n"));
  }

  async function create() {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const steps = stepsText.split("\n").map((s) => s.trim()).filter(Boolean);
      const res = await fetch("/api/org/playbooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, title: title.trim(), dimId, summary: summary.trim() || undefined, steps }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed.");
      const listed = await fetch(`/api/org/playbooks?org=${encodeURIComponent(slug)}`);
      const playbooks: PlaybookRow[] = listed.ok ? (await listed.json()).playbooks ?? [] : [];
      onCreated(playbooks);
      setTitle("");
      setSummary("");
      setStepsText("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="lg" locked={busy} ariaLabel={draft ? "Save as playbook" : "New practice"}>
      <ModalHeader
        kicker="Company playbook"
        title={draft ? "Save as playbook" : "New practice"}
        context={
          draft
            ? "Pre-filled from the mined practice; edit anything before it becomes one of your org's own standards."
            : "Author a standard once: devs adopt it across the fleet."
        }
      />
      <ModalBody>
        <NewPracticeFieldsV2
          title={title}
          dimId={dimId}
          summary={summary}
          stepsText={stepsText}
          dimOptions={dimOptions}
          error={error}
          onTitle={setTitle}
          onDim={setDimId}
          onSummary={setSummary}
          onSteps={setStepsText}
          onTemplate={applyTemplate}
        />
      </ModalBody>
      <ModalFooter>
        <span className="text-slate-400">Saved to your org&apos;s playbooks.</span>
        <div className="flex items-center gap-2">
          <GhostAction onClick={onClose} disabled={busy}>
            Cancel
          </GhostAction>
          <PrimaryAction onClick={create} disabled={busy || !title.trim()}>
            {busy ? "Adding…" : "Add practice"}
          </PrimaryAction>
        </div>
      </ModalFooter>
    </Modal>
  );
}

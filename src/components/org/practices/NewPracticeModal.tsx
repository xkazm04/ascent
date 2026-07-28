"use client";

// The "New practice" dialog — layer 2, creation path. The company-playbook author form (title,
// dimension, optional summary + steps, with a starter-template prefill) lifted out of the always-on
// inline panel into a modal opened by the page's "+ New practice" button. On success it re-lists the
// org's playbooks and hands them back to the switcher so the new practice appears without a reload.
// `locked` pins the dialog open while the create request is in flight.

import { useState } from "react";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui";
import { PLAYBOOK_TEMPLATES } from "@/lib/org/playbook-templates";
import type { PlaybookDraft } from "./promotePractice";
import type { PlaybookRow } from "@/lib/db";

interface DimOption {
  id: string;
  label: string;
}

const FIELD =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600";

export function NewPracticeModal({
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
  /** G7-25: a prefill from a promoted mined practice. Applied when the dialog OPENS with it, so the
   *  fields are seeded once and stay fully editable — a promotion is a review, not a commit. */
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

  // Seed on open, as a RENDER-PHASE adjustment rather than an effect. React supports setting state
  // while rendering to derive from changed props — it re-runs the component before committing, so
  // nothing is painted in between — whereas the effect version showed one frame of an empty form
  // over the draft the user had just chosen. Keyed on the `open` + `draft` pair, so re-opening with
  // the SAME draft re-seeds a cleared form while in-progress edits are never clobbered mid-session.
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
      // Re-list so the new row carries its server-assigned id/version, not an optimistic guess.
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
            ? "Pre-filled from the mined practice — edit anything before it becomes one of your org's own standards."
            : "Author a standard once — devs adopt it across the fleet."
        }
      />
      <ModalBody className="space-y-3">
        {/* Start from a leak-free template instead of a blank form. */}
        <label className="flex flex-wrap items-center gap-2 font-mono text-sm text-slate-500">
          Start from a template
          <select
            value=""
            onChange={(e) => e.target.value !== "" && applyTemplate(Number(e.target.value))}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200"
          >
            <option value="">choose a template…</option>
            {PLAYBOOK_TEMPLATES.map((t, i) => (
              <option key={t.title} value={i}>
                {t.dimId} · {t.title}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Playbook title"
            placeholder="e.g. Our CI standard"
            className={`min-w-[12rem] flex-1 ${FIELD}`}
          />
          <select
            value={dimId}
            onChange={(e) => setDimId(e.target.value)}
            aria-label="Dimension"
            className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200"
          >
            {dimOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id} · {d.label}
              </option>
            ))}
          </select>
        </div>
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          aria-label="Summary (optional)"
          placeholder="What it is / why it matters (optional)"
          className={FIELD}
        />
        <textarea
          value={stepsText}
          onChange={(e) => setStepsText(e.target.value)}
          aria-label="Steps, one per line (optional)"
          placeholder="Steps, one per line (optional)"
          rows={4}
          className={FIELD}
        />
        {error && <p className="text-sm text-orange-300">{error}</p>}
      </ModalBody>
      <ModalFooter>
        <span className="font-mono text-sm text-slate-500">Saved to your org&apos;s playbooks.</span>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="focus-ring rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={create}
            disabled={busy || !title.trim()}
            className="focus-ring rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add practice"}
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
}

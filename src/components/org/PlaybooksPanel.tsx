"use client";

// Company playbooks — org-authored best-practice standards (Direction #3). Owners/admins write a
// playbook (title, dimension, summary, steps); the list + author form live here. Distinct from the
// DERIVED Practice Library below it on the page, which is mined from scans.

import { useState } from "react";
import { Card, SectionHeader } from "@/components/org/ui";
import { PlaybookCard } from "@/components/org/PlaybookCard";
import type { PlaybookAdoption, PlaybookRow } from "@/lib/db";

interface DimOption {
  id: string;
  label: string;
}

export function PlaybooksPanel({
  slug,
  initial,
  dimOptions,
  adoption,
  repoOptions,
}: {
  slug: string;
  initial: PlaybookRow[];
  dimOptions: DimOption[];
  adoption: Record<string, PlaybookAdoption>;
  repoOptions: string[];
}) {
  const [playbooks, setPlaybooks] = useState<PlaybookRow[]>(initial);
  const [title, setTitle] = useState("");
  const [dimId, setDimId] = useState(dimOptions[0]?.id ?? "D1");
  const [summary, setSummary] = useState("");
  const [stepsText, setStepsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dimLabel = new Map(dimOptions.map((d) => [d.id, d.label]));

  async function refresh() {
    const res = await fetch(`/api/org/playbooks?org=${encodeURIComponent(slug)}`);
    if (res.ok) setPlaybooks((await res.json()).playbooks ?? []);
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
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed.");
      setTitle("");
      setSummary("");
      setStepsText("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setPlaybooks((p) => p.filter((x) => x.id !== id));
    await fetch(`/api/org/playbooks/${id}`, { method: "DELETE" });
  }

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Company playbooks"
        description="Your org's own best-practice standards — author one once, devs adopt it across the fleet. Copy a playbook into Claude Code to apply it to a repo."
      />
      <div className="mt-4 space-y-3">
        {playbooks.length === 0 && <p className="text-base text-slate-500">No playbooks yet — define your first standard below.</p>}
        {playbooks.map((p) => (
          <PlaybookCard
            key={p.id}
            playbook={p}
            slug={slug}
            dimLabel={dimLabel.get(p.dimId) ?? p.dimId}
            adoption={adoption[p.id]}
            repoOptions={repoOptions}
            onRemove={() => remove(p.id)}
          />
        ))}
      </div>

      <div className="mt-4 space-y-2 border-t border-slate-800 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Our CI standard"
            className="min-w-[12rem] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
          />
          <select value={dimId} onChange={(e) => setDimId(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200">
            {dimOptions.map((d) => (
              <option key={d.id} value={d.id}>{d.id} · {d.label}</option>
            ))}
          </select>
        </div>
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="What it is / why it matters (optional)"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
        />
        <textarea
          value={stepsText}
          onChange={(e) => setStepsText(e.target.value)}
          placeholder="Steps, one per line (optional)"
          rows={3}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
        />
        <div className="flex justify-end">
          <button
            onClick={create}
            disabled={busy || !title.trim()}
            className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add playbook"}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-orange-300">{error}</p>}
    </Card>
  );
}

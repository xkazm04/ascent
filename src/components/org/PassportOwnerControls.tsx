"use client";

// Owner-only passport controls (P4) on the PassportCard: set the fields a scan can't observe
// (criticality / lifecycle / rollback — applied as a read-time overlay, so a save shows immediately via
// router.refresh()), and open a draft PR that commits `.ai/passport.json` into the repo. Rendered only
// when the server page resolved the viewer as an org owner of a non-public repo.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Criticality, Lifecycle } from "@/lib/types";

const CRITICALITY: Criticality[] = ["experimental", "internal", "business", "mission-critical"];
const LIFECYCLE: Lifecycle[] = ["prototype", "alpha", "beta", "ga", "maintenance", "deprecated"];

export function PassportOwnerControls({
  repo,
  criticality,
  lifecycle,
  rollback,
}: {
  repo: string;
  criticality?: Criticality;
  lifecycle?: Lifecycle;
  rollback: boolean;
}) {
  const router = useRouter();
  const [crit, setCrit] = useState<string>(criticality ?? "");
  const [life, setLife] = useState<string>(lifecycle ?? "");
  const [rb, setRb] = useState<boolean>(rollback);
  const [busy, setBusy] = useState<null | "save" | "pr">(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function save() {
    setBusy("save");
    setMsg(null);
    try {
      const res = await fetch("/api/report/passport/overrides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo, criticality: crit || undefined, lifecycle: life || undefined, rollback: rb }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to save.");
      setMsg({ kind: "ok", text: "Saved." });
      router.refresh(); // re-read with the overlay applied
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed to save." });
    } finally {
      setBusy(null);
    }
  }

  async function openPr() {
    setBusy("pr");
    setMsg(null);
    try {
      const res = await fetch("/api/report/passport/pr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to open PR.");
      setMsg({ kind: "ok", text: data.reused ? `Existing draft PR: ${data.url}` : `Draft PR opened: ${data.url}` });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed to open PR." });
    } finally {
      setBusy(null);
    }
  }

  const selectCls = "rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200";

  return (
    <div className="mt-4 border-t border-slate-800 pt-4">
      <div className="font-mono text-sm uppercase tracking-widest text-slate-500">Owner settings</div>
      <p className="mt-1 text-sm text-slate-500">Fields a scan can&apos;t infer — these frame how to read the scores and (rollback) lift the production score.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
          criticality
          <select value={crit} onChange={(e) => setCrit(e.target.value)} className={selectCls} aria-label="Criticality">
            <option value="">unset</option>
            {CRITICALITY.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
          lifecycle
          <select value={life} onChange={(e) => setLife(e.target.value)} className={selectCls} aria-label="Lifecycle">
            <option value="">unset</option>
            {LIFECYCLE.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-300">
          <input type="checkbox" checked={rb} onChange={(e) => setRb(e.target.checked)} className="accent-accent" />
          tested rollback
        </label>
        <button onClick={save} disabled={busy !== null} className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50">
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button onClick={openPr} disabled={busy !== null} className="ml-auto rounded-lg border border-slate-700 px-3 py-1.5 font-mono text-sm text-slate-300 hover:border-accent hover:text-white disabled:opacity-50" title="Open a draft PR committing .ai/passport.json">
          {busy === "pr" ? "Opening PR…" : "Commit .ai/passport.json →"}
        </button>
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.kind === "ok" ? "text-emerald-300" : "text-orange-300"}`}>{msg.text}</p>}
    </div>
  );
}

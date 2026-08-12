"use client";

// "Open a policy PR" — commit the published stance into one repo as AI_POLICY.md via
// POST /api/org/ai-stance/apply (a draft PR through the shared practices apply machinery).
// One control with a repo picker, rendered for admins in the stance section header.

import { useState } from "react";

export function StanceApplyControl({ org, repos, version }: { org: string; repos: string[]; version: number }) {
  const [repo, setRepo] = useState(repos[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "note" | "error"; text: string } | null>(null);

  if (repos.length === 0) return null;

  async function apply() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/org/ai-stance/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, repo }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string; url?: string; reused?: boolean };
      if (!res.ok) throw new Error(d.error ?? "Failed to open the policy PR.");
      setMsg({ kind: "note", text: d.reused ? `Existing PR reused: ${d.url}` : `Draft PR opened: ${d.url}` });
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Failed to open the policy PR." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm text-slate-400">
        <span className="sr-only">Repository for the policy PR</span>
        <select
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200 outline-none focus:border-accent"
        >
          {repos.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <button
        onClick={apply}
        disabled={busy || !repo}
        className="focus-ring rounded-md border border-accent/50 bg-accent/10 px-3 py-1 font-mono text-xs uppercase tracking-[0.14em] text-white transition hover:bg-accent/20 disabled:opacity-50"
      >
        {busy ? "Opening…" : `Open AI_POLICY.md PR (v${version})`}
      </button>
      <span role="status" aria-live="polite" className={`text-xs ${msg?.kind === "error" ? "text-orange-300" : "text-emerald-300"}`}>
        {msg ? (msg.kind === "error" ? `Error: ${msg.text}` : msg.text) : ""}
      </span>
    </div>
  );
}

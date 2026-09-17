"use client";

// "Open a policy PR" — HITL: preview the published stance as AI_POLICY.md bytes via
// POST /api/org/ai-stance/apply { preview: true } (no write), then confirm to open the
// draft PR through the shared practices apply machinery. Admin gate is the route's.

import { useState } from "react";

type Preview = { repo: string; path: string; body: string; bytes: number };

export function StanceApplyControl({ org, repos, version }: { org: string; repos: string[]; version: number }) {
  const [repo, setRepo] = useState(repos[0] ?? "");
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [msg, setMsg] = useState<{ kind: "note" | "error"; text: string } | null>(null);

  if (repos.length === 0) return null;

  async function post(target: string, extra: Record<string, unknown> = {}) {
    const res = await fetch("/api/org/ai-stance/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org, repo: target, ...extra }),
    });
    const d = (await res.json().catch(() => ({}))) as {
      error?: string;
      url?: string;
      reused?: boolean;
      path?: string;
      body?: string;
      bytes?: number;
    };
    if (!res.ok) throw new Error(d.error ?? "Failed to open the policy PR.");
    return d;
  }

  async function loadPreview() {
    const target = repo;
    setBusy("preview");
    setMsg(null);
    try {
      const d = await post(target, { preview: true });
      if (typeof d.body !== "string" || typeof d.path !== "string") {
        throw new Error("The preview did not return AI_POLICY.md.");
      }
      const bytes = typeof d.bytes === "number" ? d.bytes : new TextEncoder().encode(d.body).length;
      setPreview({ repo: target, path: d.path, body: d.body, bytes });
    } catch (e) {
      setPreview(null);
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Failed to preview AI_POLICY.md." });
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!preview || preview.repo !== repo) return;
    setBusy("apply");
    setMsg(null);
    try {
      const d = await post(preview.repo);
      if (!d.url) throw new Error("Failed to open the policy PR.");
      setMsg({ kind: "note", text: d.reused ? `Existing PR reused: ${d.url}` : `Draft PR opened: ${d.url}` });
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Failed to open the policy PR." });
    } finally {
      setBusy(null);
    }
  }

  const shown = preview && preview.repo === repo ? preview : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 type-body-sm text-slate-400">
          <span className="sr-only">Repository for the policy PR</span>
          <select
            value={repo}
            disabled={busy !== null}
            onChange={(e) => {
              setRepo(e.target.value);
              setPreview(null);
              setMsg(null);
            }}
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono type-micro text-slate-200 outline-none focus:border-accent disabled:opacity-50"
          >
            {repos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={loadPreview}
          disabled={busy !== null || !repo}
          className="focus-ring rounded-md border border-slate-700 px-3 py-1 font-mono type-micro uppercase tracking-[0.14em] text-slate-200 transition hover:border-accent hover:text-white disabled:opacity-50"
        >
          {busy === "preview" ? "Previewing…" : "Preview AI_POLICY.md"}
        </button>
        {shown && (
          <button
            onClick={apply}
            disabled={busy !== null}
            className="focus-ring rounded-md border border-accent/50 bg-accent/10 px-3 py-1 font-mono type-micro uppercase tracking-[0.14em] text-white transition hover:bg-accent/20 disabled:opacity-50"
          >
            {busy === "apply" ? "Opening…" : `Open AI_POLICY.md PR (v${version})`}
          </button>
        )}
        <span role="status" aria-live="polite" className={`type-micro ${msg?.kind === "error" ? "text-orange-300" : "text-emerald-300"}`}>
          {msg ? (msg.kind === "error" ? `Error: ${msg.text}` : msg.text) : ""}
        </span>
      </div>
      {shown && (
        <div>
          <span data-testid="stance-policy-bytes" className="font-mono type-micro text-slate-500">
            {shown.path} · {shown.bytes} bytes
          </span>
          <pre
            data-testid="stance-policy-preview"
            className="mt-2 max-h-72 overflow-auto rounded-md border border-slate-800 bg-black/40 p-3 font-mono type-micro leading-relaxed whitespace-pre-wrap text-slate-300"
          >
            {shown.body}
          </pre>
        </div>
      )}
    </div>
  );
}

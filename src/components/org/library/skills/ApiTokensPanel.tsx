"use client";

// Org API tokens (Feature 2 sync) — mint/list/revoke the `askl_` tokens a repo / CLI / CI uses to reach
// the Skills Library without a browser session. The raw token is returned ONCE by the create call and
// shown here exactly once (a dismissible reveal); after that only the prefix + metadata are listable.
// Sibling of SkillsPanel; members only (the page gates rendering).

import { useState } from "react";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import type { ApiTokenSummary, SkillTokenScope } from "@/lib/db";

const SCOPE_LABEL: Record<SkillTokenScope, string> = {
  "skills:read": "Read / download skills",
  "skills:write": "Register / update skills",
  "telemetry:write": "Report usage",
  "memory:read": "Recall org memory",
};

export function ApiTokensPanel({
  slug,
  initial,
  scopes,
}: {
  slug: string;
  initial: ApiTokenSummary[];
  scopes: readonly SkillTokenScope[];
}) {
  const [tokens, setTokens] = useState<ApiTokenSummary[]>(initial);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<SkillTokenScope>>(new Set(["skills:read"]));
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(scope: SkillTokenScope) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  async function create() {
    if (!name.trim() || picked.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, name: name.trim(), scopes: [...picked] }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to create token.");
      setRevealed(json.token);
      setTokens((t) => [json.summary, ...t]);
      setName("");
      setPicked(new Set(["skills:read"]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    const prev = tokens;
    setError(null);
    setTokens((t) => t.filter((x) => x.id !== id));
    const res = await fetch(`/api/org/tokens/${id}?org=${encodeURIComponent(slug)}`, { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) {
      setTokens(prev);
      setError((await res?.json().catch(() => ({})))?.error ?? "Couldn't revoke the token.");
    }
  }

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="API tokens"
        description="Give a repo, the sync CLI, or CI machine access to this library — no browser session needed. A token is shown once; store it as ASCENT_TOKEN."
      />

      {revealed && (
        <div className="mt-3 rounded border border-emerald-700/60 bg-emerald-950/40 p-3">
          <p className="text-sm text-emerald-200">Copy this token now — it won&apos;t be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-slate-900 px-2 py-1 font-mono text-xs text-emerald-100">{revealed}</code>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(revealed)}
              className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => setRevealed(null)}
              className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
            >
              Done
            </button>
          </div>
        </div>
      )}

      <div className="mt-4">
        {tokens.length === 0 ? (
          <p className="text-sm text-slate-500">No tokens yet — mint one below to connect a repo or CI.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded border border-slate-800">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <span className="font-medium text-slate-200">{t.name}</span>
                  <span className="ml-2 font-mono text-xs text-slate-500">{t.tokenPrefix}…</span>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {t.scopes.map((s) => (
                      <span key={s} className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{s}</span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span className="hidden sm:inline">{t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleDateString()}` : "never used"}</span>
                  <button type="button" onClick={() => revoke(t.id)} className="rounded border border-slate-700 px-2 py-1 text-orange-300 hover:bg-slate-800">
                    Revoke
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 space-y-3 border-t border-slate-800 pt-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Token name (e.g. CI, laptop)"
            className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-600"
          />
          <button
            type="button"
            onClick={create}
            disabled={busy || !name.trim() || picked.size === 0}
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create token"}
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          {scopes.map((s) => (
            <label key={s} className="flex items-center gap-1.5 text-xs text-slate-300">
              <input type="checkbox" checked={picked.has(s)} onChange={() => toggle(s)} className="accent-emerald-600" />
              {SCOPE_LABEL[s] ?? s}
            </label>
          ))}
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-orange-300">{error}</p>}
    </Card>
  );
}

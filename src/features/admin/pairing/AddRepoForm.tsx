"use client";

// Add a repository to the org's scan scope from the Pairing tab — `owner/repo` or any GitHub URL
// shape (parseRepoUrl is lenient server-side). The new row lands watched and unpaired; pairing its
// local path is the next act in the list below, so on success we just refresh the server list.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AddRepoForm({ org }: { org: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = value.trim();
    if (!url || busy) return;
    setBusy(true);
    setError(null);
    setAdded(null);
    try {
      const r = await fetch("/api/org/local/repo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, url }),
      });
      const d = (await r.json().catch(() => ({}))) as { fullName?: string; error?: string };
      if (!r.ok) throw new Error(d.error ?? `Failed (${r.status}).`);
      setAdded(d.fullName ?? url);
      setValue("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Adding the repository failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-3 rounded-xl border border-divider bg-surface/40 p-4">
      <label htmlFor="pairing-add-repo" className="font-mono text-xs uppercase tracking-widest text-slate-400">
        Add to scope
      </label>
      <input
        id="pairing-add-repo"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="owner/repo — public repos welcome"
        className="focus-ring min-w-64 flex-1 rounded-lg border border-divider bg-ink px-3 py-1.5 font-mono text-sm text-slate-200 placeholder:text-slate-600"
      />
      <button
        type="submit"
        disabled={busy || !value.trim()}
        className="focus-ring rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-on-accent transition hover:bg-accent-soft disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add repo"}
      </button>
      {added && <span className="font-mono text-xs text-success-soft">Added {added} ✓</span>}
      {error && <span className="text-sm text-danger">{error}</span>}
    </form>
  );
}

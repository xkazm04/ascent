"use client";

// Client controls for the personal watchlist: the add-repo form and the per-row untrack button.
// Both post to /api/me/watch (the personal-org pointer write — the scan series stays in the shared
// public corpus) and refresh the server-rendered overview on success.

import { useState } from "react";
import { useRouter } from "next/navigation";

async function postWatch(repo: string, watched: boolean): Promise<string | null> {
  try {
    const res = await fetch("/api/me/watch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo, watched }),
    });
    if (res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return body.error ?? "Something went wrong. Try again.";
  } catch {
    return "Network error. Try again.";
  }
}

export function AddRepoForm({ remaining }: { remaining: number }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = remaining <= 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const repo = value.trim();
    if (!repo || busy || full) return;
    setBusy(true);
    setError(null);
    const err = await postWatch(repo, true);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setValue("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="owner/repo"
          aria-label="Repository to track (owner/repo or GitHub URL)"
          disabled={busy || full}
          className="focus-ring w-52 rounded-lg border border-slate-700 bg-transparent px-3 py-1.5 text-base text-slate-200 placeholder:text-slate-600 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || full || value.trim().length === 0}
          className="focus-ring rounded-lg border border-slate-700 px-3 py-1.5 text-base text-slate-300 transition hover:border-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Adding…" : "Track repo"}
        </button>
      </div>
      {full && (
        <p className="font-mono text-sm text-slate-500">Watchlist full. Untrack a repository to add another.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-400">
          {error}
        </p>
      )}
    </form>
  );
}

export function UntrackButton({ fullName }: { fullName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function untrack() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await postWatch(fullName, false);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={untrack}
        disabled={busy}
        title={`Stop tracking ${fullName} (its shared scan history is untouched)`}
        className="focus-ring rounded-md px-2 py-1 font-mono text-sm text-slate-500 transition hover:text-rose-400 disabled:opacity-50"
      >
        {busy ? "…" : "Untrack"}
      </button>
      {error && (
        <span role="alert" className="text-sm text-rose-400">
          {error}
        </span>
      )}
    </span>
  );
}

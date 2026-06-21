"use client";

// The accept action for /invite/[token]. Acceptance is a single-use, role-granting mutation, so it
// runs ONLY on this explicit button click (a same-origin POST), never as a GET render side-effect —
// see the route comment for why (prefetch/unfurler/scanner burn + first-clicker capture).

import { useState } from "react";
import Link from "next/link";

type AcceptResult =
  | { ok: true; org: string; role: string }
  | { ok: false; reason: string; error?: string };

const REASON: Record<string, string> = {
  not_found: "This invitation link is invalid. Ask an owner to send a new one.",
  expired: "This invitation has expired. Ask an owner to send a fresh one.",
  used: "This invitation was already accepted or revoked.",
  wrong_user: "This invitation was issued to a different GitHub account. Sign in as that user to accept it.",
  auth: "Sign in to accept this invitation.",
  db: "Something went wrong applying the invitation. Try again, or ask an owner to re-send.",
};

export function AcceptInviteForm({
  token,
  org,
  role,
  mismatch,
}: {
  token: string;
  org: string;
  role: string;
  mismatch: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AcceptResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const d = (await res.json().catch(() => ({}))) as AcceptResult;
      setResult(d);
      if (!d.ok) setError(d.error ?? REASON[d.reason] ?? "Something went wrong applying the invitation.");
    } catch {
      setError("Couldn't reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (result?.ok) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-center">
        <h1 className="text-xl font-bold text-white">You&apos;ve joined {result.org}</h1>
        <p className="mt-2 text-base text-slate-400">
          You now have the {result.role} role in {result.org}.
        </p>
        <Link
          href={`/org/${encodeURIComponent(result.org)}`}
          className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
        >
          Open the org dashboard →
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-center">
      <h1 className="text-xl font-bold text-white">Join {org}</h1>
      <p className="mt-2 text-base text-slate-400">
        You&apos;ve been invited to <span className="font-mono text-slate-200">{org}</span> as{" "}
        <span className="font-mono text-slate-200">{role}</span>. Accept to gain access.
      </p>
      {mismatch && (
        <p role="alert" className="mt-3 text-sm text-orange-300">
          This invite is pinned to <span className="font-mono">@{mismatch}</span>; accepting will fail
          unless you&apos;re signed in as that account.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-orange-300">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={accept}
        disabled={busy}
        aria-busy={busy}
        className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-base font-semibold text-on-accent transition hover:bg-accent-soft disabled:opacity-50"
      >
        {busy ? "Accepting…" : "Accept invitation"}
      </button>
    </div>
  );
}

"use client";

// Owner-only "Invite a teammate" panel, co-located out of MembersPanel to keep that file within the
// 300-LOC budget. Mints a single-use /invite/[token] link (POST /api/org/invites), lists pending
// invites with optimistic revoke, and exposes the copy-link affordance only right after creation
// (the token is the capability, shown once).

import { useState } from "react";
import type { OrgRole } from "@/lib/db/members";
import { ROLES } from "@/components/org/memberRoles";

export interface InviteRow {
  id: string;
  email: string | null;
  githubLogin: string | null;
  role: OrgRole;
  // Present only for invites created in THIS session (the POST create response). Pre-existing
  // pending invites loaded from the server no longer carry the token (it's the capability, shown
  // once), so the copy-link affordance appears only right after creation.
  token?: string | null;
  expiresAt: string;
}

export function MemberInvites({ slug, initialInvites }: { slug: string; initialInvites: InviteRow[] }) {
  const [invites, setInvites] = useState<InviteRow[]>(initialInvites);
  const [inviteTarget, setInviteTarget] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("member");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // An invite target is an email if it contains "@", else a GitHub login.
  async function sendInvite() {
    const target = inviteTarget.trim();
    if (!target || inviteBusy) return;
    setInviteBusy(true);
    setInviteError(null);
    const payload = target.includes("@") ? { email: target } : { githubLogin: target };
    try {
      const res = await fetch("/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, role: inviteRole, ...payload }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Failed to create invite.");
      setInvites((xs) => [d.invite as InviteRow, ...xs]);
      setInviteTarget("");
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Failed to create invite.");
    } finally {
      setInviteBusy(false);
    }
  }

  async function revokeInvite(id: string) {
    const prev = invites;
    setInvites((xs) => xs.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/org/invites?org=${encodeURIComponent(slug)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setInvites(prev);
      setInviteError("Failed to revoke the invite.");
    }
  }

  function inviteLink(token: string): string {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/invite/${token}`;
  }

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(inviteLink(token));
      setCopied(token);
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 1500);
    } catch {
      /* clipboard blocked — the link is shown inline as a fallback */
    }
  }

  return (
    <div className="mt-6 border-t border-slate-800 pt-4">
      <h3 className="font-mono text-sm uppercase tracking-widest text-accent">Invite a teammate</h3>
      <p className="mt-1 text-sm text-slate-500">
        Creates a single-use link (expires in 7 days). A GitHub login pins the invite to that account.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={inviteTarget}
          onChange={(e) => setInviteTarget(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              sendInvite();
            }
          }}
          placeholder="GitHub login or email"
          className="min-w-[14rem] flex-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200 outline-none focus:border-accent"
        />
        <select
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value as OrgRole)}
          aria-label="Invite role"
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-sm text-slate-200 outline-none focus:border-accent"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          onClick={sendInvite}
          disabled={inviteBusy || !inviteTarget.trim()}
          className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
        >
          {inviteBusy ? "Creating…" : "Create invite"}
        </button>
      </div>
      {inviteError && (
        <p role="alert" className="mt-2 text-sm text-orange-300">
          {inviteError}
        </p>
      )}

      {invites.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2 font-mono text-sm">
              <span className="text-slate-300">{i.githubLogin ? `@${i.githubLogin}` : i.email}</span>
              <span className="rounded border border-slate-700 px-1.5 py-0.5 text-slate-400">{i.role}</span>
              {i.token ? (
                <button onClick={() => copyLink(i.token!)} className="text-accent transition hover:text-white">
                  {copied === i.token ? "copied ✓" : "copy link"}
                </button>
              ) : (
                <span className="text-slate-600" title="The invite link is shown only when it's created. Revoke and re-issue to get a fresh link.">
                  link shared at creation
                </span>
              )}
              <button onClick={() => revokeInvite(i.id)} className="text-slate-600 transition hover:text-orange-300">
                revoke
              </button>
              <span className="text-slate-600">expires {new Date(i.expiresAt).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

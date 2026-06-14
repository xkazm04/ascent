"use client";

// Owner-only member management UI — the surface that makes the RBAC backend (Membership.role +
// /api/org/members) usable without curl. Inline role change (optimistic POST) + remove (DELETE,
// refused for the last owner server-side). Owners can grant a teammate viewer/admin without sharing
// the GitHub App installation.

import { useState } from "react";
import { SectionHeader } from "@/components/org/ui";
import type { OrgRole } from "@/lib/db/members";

interface Member {
  login: string;
  name: string | null;
  role: OrgRole;
  createdAt: string;
}

interface InviteRow {
  id: string;
  email: string | null;
  githubLogin: string | null;
  role: OrgRole;
  token: string;
  expiresAt: string;
}

const ROLES: OrgRole[] = ["owner", "admin", "member", "viewer"];
const ROLE_HINT: Record<OrgRole, string> = {
  owner: "Full control, incl. member management & billing",
  admin: "Destructive ops (deletes, credit grants)",
  member: "Can act on the org (scan, watch, plan)",
  viewer: "Read-only access to dashboards",
};

export function MembersPanel({
  slug,
  initial,
  initialInvites,
  selfLogin,
}: {
  slug: string;
  initial: Member[];
  initialInvites: InviteRow[];
  selfLogin: string | null;
}) {
  const [members, setMembers] = useState<Member[]>(initial);
  const [busy, setBusy] = useState<string | null>(null); // login currently mutating
  const [error, setError] = useState<string | null>(null);
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

  async function changeRole(login: string, role: OrgRole) {
    const prev = members;
    setBusy(login);
    setError(null);
    setMembers((ms) => ms.map((m) => (m.login === login ? { ...m, role } : m)));
    try {
      const res = await fetch("/api/org/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, login, role }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Failed to update role.");
      }
    } catch (e) {
      setMembers(prev); // roll back the optimistic change
      setError(e instanceof Error ? e.message : "Failed to update role.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(login: string) {
    if (!window.confirm(`Remove @${login} from ${slug}? They lose all access to this org.`)) return;
    const prev = members;
    setBusy(login);
    setError(null);
    setMembers((ms) => ms.filter((m) => m.login !== login));
    try {
      const res = await fetch(
        `/api/org/members?org=${encodeURIComponent(slug)}&login=${encodeURIComponent(login)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Failed to remove member.");
      }
    } catch (e) {
      setMembers(prev);
      setError(e instanceof Error ? e.message : "Failed to remove member.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <SectionHeader
        className="mb-4"
        title="Members & access"
        description={
          <>
            Who can act on <span className="font-mono">{slug}</span>, and at what role. Grant a
            teammate access without sharing the GitHub App installation. Owner-only.
          </>
        }
      />
      {error && <p className="mb-3 text-sm text-orange-300">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-950/50 font-mono text-sm uppercase tracking-widest text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Member</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Joined</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.login} className="border-b border-slate-800/60 last:border-0" aria-busy={busy === m.login}>
                <td className="px-4 py-2.5">
                  <span className="font-mono text-slate-200">@{m.login}</span>
                  {m.login === selfLogin && (
                    <span className="ml-1.5 rounded border border-slate-700 px-1 py-0.5 font-mono text-[10px] text-slate-500">you</span>
                  )}
                  {m.name && <span className="ml-2 text-slate-500">{m.name}</span>}
                </td>
                <td className="px-4 py-2.5">
                  <select
                    value={m.role}
                    disabled={busy === m.login}
                    onChange={(e) => changeRole(m.login, e.target.value as OrgRole)}
                    aria-label={`Role for ${m.login}`}
                    title={ROLE_HINT[m.role]}
                    className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm text-slate-200 outline-none focus:border-accent disabled:opacity-50"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2.5 font-mono text-sm text-slate-500">
                  {new Date(m.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={() => remove(m.login)}
                    disabled={busy === m.login}
                    className="font-mono text-sm text-slate-600 transition hover:text-orange-300 disabled:opacity-50"
                  >
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 font-mono text-sm text-slate-500">
        Roles: owner → admin → member → viewer. Installation owners are seeded as owner automatically;
        the last owner can&apos;t be removed.
      </p>

      {/* Invite a teammate — mints a single-use /invite/[token] link to share (expires in 7 days). */}
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
        {inviteError && <p className="mt-2 text-sm text-orange-300">{inviteError}</p>}

        {invites.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 font-mono text-sm">
                <span className="text-slate-300">{i.githubLogin ? `@${i.githubLogin}` : i.email}</span>
                <span className="rounded border border-slate-700 px-1.5 py-0.5 text-slate-400">{i.role}</span>
                <button onClick={() => copyLink(i.token)} className="text-accent transition hover:text-white">
                  {copied === i.token ? "copied ✓" : "copy link"}
                </button>
                <button onClick={() => revokeInvite(i.id)} className="text-slate-600 transition hover:text-orange-300">
                  revoke
                </button>
                <span className="text-slate-600">expires {new Date(i.expiresAt).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

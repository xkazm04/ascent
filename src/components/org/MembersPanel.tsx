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
  selfLogin,
}: {
  slug: string;
  initial: Member[];
  selfLogin: string | null;
}) {
  const [members, setMembers] = useState<Member[]>(initial);
  const [busy, setBusy] = useState<string | null>(null); // login currently mutating
  const [error, setError] = useState<string | null>(null);

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
    </div>
  );
}

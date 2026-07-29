"use client";

// The member roster table — role select, self-demotion confirm, remove confirm. Extracted from
// MembersPanel.tsx (JSX region split, docs/ORG-TABS-REFACTOR.md) to keep the panel under the 200-LOC
// cap.

import type { OrgRole } from "@/lib/db/members";
import { ROLES, ROLE_HINT } from "@/components/org/govern/members/memberRoles";
import type { Member } from "./MembersTypes";

export function MembersTable({
  members,
  busy,
  selfLogin,
  confirmRemove,
  confirmDowngrade,
  onRoleSelect,
  onConfirmDowngrade,
  onCancelDowngrade,
  onRequestRemove,
  onConfirmRemove,
  onCancelRemove,
}: {
  members: Member[];
  busy: string | null;
  selfLogin: string | null;
  confirmRemove: string | null;
  confirmDowngrade: { login: string; role: OrgRole } | null;
  onRoleSelect: (m: Member, role: OrgRole) => void;
  onConfirmDowngrade: (m: Member) => void;
  onCancelDowngrade: () => void;
  onRequestRemove: (login: string) => void;
  onConfirmRemove: (login: string) => void;
  onCancelRemove: () => void;
}) {
  return (
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
                  onChange={(e) => onRoleSelect(m, e.target.value as OrgRole)}
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
                {confirmDowngrade?.login === m.login && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-sm">
                    <span className="text-orange-300">
                      Demote yourself to {confirmDowngrade.role}? You&apos;ll lose owner access to this page.
                    </span>
                    <button
                      onClick={() => onConfirmDowngrade(m)}
                      disabled={busy === m.login}
                      className="font-medium text-danger-soft transition hover:text-danger disabled:opacity-50"
                    >
                      confirm
                    </button>
                    <button
                      onClick={onCancelDowngrade}
                      disabled={busy === m.login}
                      className="text-slate-500 transition hover:text-white disabled:opacity-50"
                    >
                      cancel
                    </button>
                  </div>
                )}
              </td>
              <td className="px-4 py-2.5 font-mono text-sm text-slate-500">
                {new Date(m.createdAt).toLocaleDateString()}
              </td>
              <td className="px-4 py-2.5 text-right">
                {confirmRemove === m.login ? (
                  <span className="inline-flex items-center justify-end gap-2 font-mono text-sm">
                    <span className="text-slate-400">Remove?</span>
                    <button
                      onClick={() => onConfirmRemove(m.login)}
                      disabled={busy === m.login}
                      className="font-medium text-danger-soft transition hover:text-danger disabled:opacity-50"
                    >
                      confirm
                    </button>
                    <button
                      onClick={onCancelRemove}
                      disabled={busy === m.login}
                      className="text-slate-500 transition hover:text-white disabled:opacity-50"
                    >
                      cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => onRequestRemove(m.login)}
                    disabled={busy === m.login}
                    className="font-mono text-sm text-slate-500 transition hover:text-danger-soft disabled:opacity-50"
                  >
                    remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

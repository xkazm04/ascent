"use client";

// State/effects/handlers for the Members tab, extracted from MembersPanel.tsx to keep the component
// under the 200-LOC cap (AGENTS.md / docs/ORG-TABS-REFACTOR.md). Owns no JSX.

import { useState } from "react";
import type { OrgRole } from "@/lib/db/members";
import { ROLES } from "@/components/org/govern/members/memberRoles";
import type { Member } from "./MembersTypes";

export function useMembersPanel(slug: string, initial: Member[], selfLogin: string | null) {
  const [members, setMembers] = useState<Member[]>(initial);
  const [busy, setBusy] = useState<string | null>(null); // login currently mutating
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null); // login awaiting inline remove confirm
  const [confirmDowngrade, setConfirmDowngrade] = useState<{ login: string; role: OrgRole } | null>(null); // self-demotion awaiting confirm

  // ROLES is ordered highest→lowest privilege, so a HIGHER index is a LOWER role.
  const isDowngrade = (from: OrgRole, to: OrgRole) => ROLES.indexOf(to) > ROLES.indexOf(from);

  // Gate the role <select>: demoting YOUR OWN role below its current level locks you out of this
  // owner-only surface with no self-recovery (only another owner can restore you), so require an
  // explicit confirm first — mirroring the deliberate two-step inline confirm Remove already has. Any
  // other change (a downgrade of someone else, or any upgrade) commits immediately as before.
  function onRoleSelect(m: Member, role: OrgRole) {
    if (role === m.role) return;
    if (m.login === selfLogin && isDowngrade(m.role, role)) {
      setConfirmRemove(null);
      setConfirmDowngrade({ login: m.login, role });
      return;
    }
    void changeRole(m.login, role);
  }

  async function changeRole(login: string, role: OrgRole) {
    // Capture ONLY this row's prior role, not a whole-array snapshot: rows mutate concurrently (each is
    // gated by `busy === m.login`, not a global lock), so replaying a stale `members` snapshot on
    // failure would resurrect a member another in-flight op already removed / re-role a row it changed.
    const prevRole = members.find((m) => m.login === login)?.role;
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
      // Revert just this row's role via a functional update — never a stale snapshot (finding #4).
      if (prevRole) setMembers((ms) => ms.map((m) => (m.login === login ? { ...m, role: prevRole } : m)));
      setError(e instanceof Error ? e.message : "Failed to update role.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(login: string) {
    // Confirmation is the inline two-step affordance in the row (Remove? → confirm / cancel), so
    // this runs only on an explicit confirm — matching the app's bespoke UX instead of a native
    // window.confirm dialog that can't be themed or announced.
    setConfirmRemove(null);
    // Remember the removed row + its position so a failed DELETE re-inserts exactly that one row via a
    // functional update, rather than restoring a stale array that could clobber a concurrent edit (#4).
    const idx = members.findIndex((m) => m.login === login);
    const removed = idx >= 0 ? members[idx] : null;
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
      if (removed) {
        setMembers((ms) => {
          if (ms.some((m) => m.login === login)) return ms; // already present — don't duplicate
          const next = [...ms];
          next.splice(Math.min(idx, next.length), 0, removed);
          return next;
        });
      }
      setError(e instanceof Error ? e.message : "Failed to remove member.");
    } finally {
      setBusy(null);
    }
  }

  return {
    members,
    busy,
    error,
    confirmRemove,
    setConfirmRemove,
    confirmDowngrade,
    setConfirmDowngrade,
    onRoleSelect,
    changeRole,
    remove,
  };
}

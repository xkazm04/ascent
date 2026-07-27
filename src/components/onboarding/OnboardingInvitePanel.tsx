"use client";

// Invite teammates at peak motivation (the App path's done screen) — grants viewer access to the
// scanned org via the existing owner-gated members endpoint; the invitee needs no App install.
//
// Extracted from OnboardingScanStep verbatim so that file stays under the 300-LOC cap (AGENTS.md)
// while gaining the per-repo retry affordance. Pure relocation — the state, the error contract, and
// the focus-return behavior are unchanged.

import { useEffect, useRef, useState } from "react";

export function InvitePanel({ inviteOrg, onInvited }: { inviteOrg: string; onInvited?: () => void }) {
  const [handle, setHandle] = useState("");
  const [invited, setInvited] = useState<string[]>([]);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  // Mirror PickForm's error contract (the wizard's established pattern): when an invite fails,
  // focus returns to the handle input, which is wired to the error via aria-invalid +
  // aria-describedby — so SR users tabbing back hear WHY it failed. (ambiguity-ui #5)
  const inviteInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inviteErr) inviteInputRef.current?.focus();
  }, [inviteErr]);

  async function invite() {
    if (inviteBusy) return; // guard the keyboard entry point too — the button's disabled prop can't
    const login = handle.trim().replace(/^@/, "");
    if (!login || !inviteOrg) return;
    setInviteBusy(true);
    setInviteErr(null);
    try {
      const res = await fetch("/api/org/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: inviteOrg, login, role: "viewer" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Couldn't add that teammate.");
      setInvited((xs) => (xs.includes(login) ? xs : [...xs, login]));
      setHandle("");
      onInvited?.();
    } catch (e) {
      setInviteErr(e instanceof Error ? e.message : "Couldn't add that teammate.");
    } finally {
      setInviteBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <h2 className="text-base font-semibold text-white">Invite your team</h2>
      <p className="mt-1 text-sm text-slate-400">
        Add teammates as viewers on <span className="font-mono text-slate-300">{inviteOrg}</span> so they can see the
        dashboard. They&apos;ll need a GitHub login — no App install required.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-slate-600">@</span>
        <input
          ref={inviteInputRef}
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !inviteBusy && invite()}
          placeholder="github-handle"
          aria-label="Teammate's GitHub handle"
          aria-invalid={inviteErr ? true : undefined}
          aria-describedby={inviteErr ? "invite-error" : undefined}
          className="focus-ring w-48 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
        />
        <button
          onClick={invite}
          disabled={inviteBusy || !handle.trim()}
          className="focus-ring rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
        >
          {inviteBusy ? "Adding…" : "Invite"}
        </button>
      </div>
      {invited.length > 0 && (
        <p className="mt-2 font-mono text-sm text-emerald-300">
          Added as viewer: {invited.map((l) => `@${l}`).join(", ")}
        </p>
      )}
      {inviteErr && (
        <p id="invite-error" role="alert" className="mt-2 font-mono text-sm text-danger-soft">
          {inviteErr}
        </p>
      )}
    </div>
  );
}

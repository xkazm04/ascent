"use client";

// Owner-only "Invite a teammate" panel, co-located out of MembersPanel to keep that file within the
// 300-LOC budget. Mints a single-use /invite/[token] link (POST /api/org/invites), lists pending
// invites with optimistic revoke (the roster itself is InviteList.tsx), and exposes the copy-link
// affordance only right after creation (the token is the capability, shown once).
//
// DELIVERY DISCLOSURE. POST /api/org/invites mails an email-pinned invite and reports the outcome
// honestly as `emailed` — "sent" | "skipped" (no provider on this deploy) | "failed" | null (a
// GitHub-login invite, which has no address to send to). That field is the whole reason the route
// computes it: its own header says the UI should "tell the owner to share the link manually rather
// than implying a delivery". It had no consumer, so an owner on a deploy with no mail provider
// created an invite, saw a success, and waited for a mail that was never going to arrive.

import { useState } from "react";
import type { OrgRole } from "@/lib/db/members";
import { INVITE_ROLES } from "@/features/admin/members/memberRoles";
import { InviteList } from "./InviteList";
import type { InviteRow } from "./MembersTypes";

// Re-exported so the panel and the tab keep importing it from here (pure relocation).
export type { InviteRow };


/** The `emailed` wire vocabulary, rendered from ONE table keyed by the wire token — label and
 *  severity together, so a future member cannot gain a colour in one place and a sentence in
 *  another. `null` is absent from the table on purpose: it means "no address was involved", which is
 *  not a delivery outcome to report. */
const DELIVERY: Record<"sent" | "skipped" | "failed", { alert: boolean; cls: string; text: (to: string) => string }> = {
  sent: {
    alert: false,
    cls: "text-slate-400",
    text: (to) => `Invitation emailed to ${to}.`,
  },
  skipped: {
    alert: false,
    cls: "text-orange-300",
    text: (to) => `Nothing was sent to ${to} — this deployment has no email provider. Copy the link below and share it yourself.`,
  },
  failed: {
    alert: true,
    cls: "text-danger-soft",
    text: (to) => `Couldn't email ${to}. The invite is valid — copy the link below and share it yourself.`,
  },
};

export function MemberInvites({ slug, initialInvites }: { slug: string; initialInvites: InviteRow[] }) {
  const [invites, setInvites] = useState<InviteRow[]>(initialInvites);
  const [inviteTarget, setInviteTarget] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("member");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Outcome of the LAST create's mail, for the invite just minted. Cleared on the next attempt so a
  // stale "emailed" line can never sit above a different invite.
  const [delivery, setDelivery] = useState<{ to: string; status: keyof typeof DELIVERY } | null>(null);

  // An invite target is an email if it contains "@", else a GitHub login.
  async function sendInvite() {
    const target = inviteTarget.trim();
    if (!target || inviteBusy) return;
    setInviteBusy(true);
    setInviteError(null);
    setDelivery(null);
    const payload = target.includes("@") ? { email: target } : { githubLogin: target };
    try {
      const res = await fetch("/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, role: inviteRole, ...payload }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Failed to create invite.");
      const row = d.invite as InviteRow;
      setInvites((xs) => [row, ...xs]);
      // Report what actually happened to the mail. `emailed` is null for a GitHub-login invite (no
      // address), and only ever concerns the address the owner just typed on this request.
      const status = d.emailed as string | null;
      if (row.email && status && status in DELIVERY) {
        setDelivery({ to: row.email, status: status as keyof typeof DELIVERY });
      }
      setInviteTarget("");
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Failed to create invite.");
    } finally {
      setInviteBusy(false);
    }
  }

  async function revokeInvite(id: string) {
    // Remember only THIS row + its position, never a whole-array snapshot: nothing here serializes
    // two revokes (there is no per-row busy lock), so replaying the array captured at call time
    // resurrects an invite a concurrent revoke has already deleted on the server — and the owner
    // then sees a pending invite whose link is dead. Same rule, and the same targeted functional
    // re-insert, as the roster's useMembersPanel.remove (members-access-control 07-09 #4).
    const idx = invites.findIndex((i) => i.id === id);
    const removed = idx >= 0 ? invites[idx] : null;
    setInvites((xs) => xs.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/org/invites?org=${encodeURIComponent(slug)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      if (removed) {
        setInvites((xs) => {
          if (xs.some((i) => i.id === id)) return xs; // already present — don't duplicate
          const next = [...xs];
          next.splice(Math.min(idx, next.length), 0, removed);
          return next;
        });
      }
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
      <h3 className="type-mono-sm uppercase tracking-widest text-accent">Invite a teammate</h3>
      <p className="mt-1 type-body-sm text-slate-500">
        Creates a single-use link (expires in 7 days). A GitHub login pins the invite to that account.
        Owner is granted by promoting an existing member, not by invite.
      </p>
      {/* data-tour: the onboarding companion's "bring the team in" spotlight — the whole invite form. */}
      <div data-tour="invite-member" className="mt-2 flex flex-wrap items-center gap-2">
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
          className="min-w-[14rem] flex-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 type-mono-sm text-slate-200 outline-none focus:border-accent"
        />
        <select
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value as OrgRole)}
          aria-label="Invite role"
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 type-mono-sm text-slate-200 outline-none focus:border-accent"
        >
          {INVITE_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          onClick={sendInvite}
          disabled={inviteBusy || !inviteTarget.trim()}
          className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 type-body-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
        >
          {inviteBusy ? "Creating…" : "Create invite"}
        </button>
      </div>
      {inviteError && (
        <p role="alert" className="mt-2 type-body-sm text-danger-soft">
          {inviteError}
        </p>
      )}
      {delivery && (
        <p
          data-testid="invite-delivery"
          {...(DELIVERY[delivery.status].alert ? { role: "alert" as const } : {})}
          className={`mt-2 type-body-sm ${DELIVERY[delivery.status].cls}`}
        >
          {DELIVERY[delivery.status].text(delivery.to)}
        </p>
      )}

      <InviteList invites={invites} copied={copied} onCopy={copyLink} onRevoke={revokeInvite} />
    </div>
  );
}

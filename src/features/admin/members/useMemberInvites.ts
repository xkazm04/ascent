"use client";

// State and handlers for the owner's invite panel, extracted from MemberInvites.tsx (pure relocation
// of the single-invite, resend, revoke and copy-link logic, so that file stays under the 200-LOC cap
// `src/features/**` carries) plus the batch mode (members-1).
//
// Batch: text that parses to more than one target is previewed LOCALLY with the same pure classifier
// the server runs (src/lib/org/invite-batch.ts), against the roster and pending list the page already
// holds, so the preview costs no request. Confirm sends ONE POST { action: "batch" }; the server
// re-classifies and its per-target results are what the panel then shows. One target keeps today's
// body and today's no-preview path.

import { useMemo, useState } from "react";
import type { OrgRole } from "@/lib/db/members";
import {
  INVITE_BATCH_MAX,
  classifyInviteTargets,
  countInvitePlan,
  parseInviteTargets,
} from "@/lib/org/invite-batch";
import type { DeliveryStatus, InviteBatchResult, InviteRow, Member } from "./MembersTypes";

const DELIVERY_STATUSES: readonly string[] = ["sent", "skipped", "failed"] satisfies DeliveryStatus[];

async function postInvites(body: unknown, fallback: string) {
  const res = await fetch("/api/org/invites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error ?? fallback);
  return d;
}

const NO_MEMBERS: readonly Member[] = [];

export function useMemberInvites(slug: string, initialInvites: InviteRow[], members: readonly Member[] = NO_MEMBERS) {
  const [invites, setInvites] = useState<InviteRow[]>(initialInvites);
  const [inviteTarget, setInviteTarget] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("member");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Outcome of the last create/resend mail. Cleared on the next attempt so a stale line never sits
  // above a different invite.
  const [delivery, setDelivery] = useState<{ to: string; status: DeliveryStatus } | null>(null);
  const [batchResults, setBatchResults] = useState<InviteBatchResult[] | null>(null);

  const preview = useMemo(() => {
    const { targets, duplicates } = parseInviteTargets(inviteTarget);
    if (targets.length < 2) return null;
    const rows = classifyInviteTargets(targets, members, invites);
    return { targets, duplicates, rows, counts: countInvitePlan(rows), tooMany: targets.length > INVITE_BATCH_MAX };
  }, [inviteTarget, members, invites]);
  const mode: "single" | "preview" = preview ? "preview" : "single";

  function noteDelivery(row: InviteRow, emailed: unknown) {
    const status = emailed as string | null;
    if (row.email && status && DELIVERY_STATUSES.includes(status)) {
      setDelivery({ to: row.email, status: status as DeliveryStatus });
    }
  }

  async function sendInvite() {
    const target = inviteTarget.trim();
    if (!target || inviteBusy) return;
    setInviteBusy(true);
    setInviteError(null);
    setDelivery(null);
    setBatchResults(null);
    const payload = target.includes("@") ? { email: target } : { githubLogin: target };
    try {
      const d = await postInvites({ org: slug, role: inviteRole, ...payload }, "Failed to create invite.");
      const row = d.invite as InviteRow;
      setInvites((xs) => [row, ...xs]);
      noteDelivery(row, d.emailed);
      setInviteTarget("");
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Failed to create invite.");
    } finally {
      setInviteBusy(false);
    }
  }

  async function confirmBatch() {
    if (!preview || preview.tooMany || preview.counts.invite === 0 || inviteBusy) return;
    setInviteBusy(true);
    setInviteError(null);
    setDelivery(null);
    try {
      const d = await postInvites(
        { org: slug, action: "batch", role: inviteRole, targets: preview.targets },
        "Failed to create the invites.",
      );
      const results = (Array.isArray(d.results) ? d.results : []) as InviteBatchResult[];
      const created = results.flatMap((r) => (r.outcome === "created" ? [r.invite] : []));
      setInvites((xs) => [...created, ...xs]);
      setBatchResults(results);
      setInviteTarget("");
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Failed to create the invites.");
    } finally {
      setInviteBusy(false);
    }
  }

  async function resendInvite(id: string) {
    setInviteError(null);
    setDelivery(null);
    try {
      const d = await postInvites({ org: slug, id, action: "resend" }, "Failed to resend invite.");
      const row = d.invite as InviteRow;
      setInvites((xs) => xs.map((i) => (i.id === id ? { ...i, ...row } : i)));
      noteDelivery(row, d.emailed);
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Failed to resend invite.");
    }
  }

  async function revokeInvite(id: string) {
    // Targeted re-insert only: a whole-array snapshot would resurrect a concurrent revoke.
    const idx = invites.findIndex((i) => i.id === id);
    const removed = idx >= 0 ? invites[idx] : null;
    setInvites((xs) => xs.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/org/invites?org=${encodeURIComponent(slug)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      if (removed) {
        setInvites((xs) => {
          if (xs.some((i) => i.id === id)) return xs; // already present - don't duplicate
          const next = [...xs];
          next.splice(Math.min(idx, next.length), 0, removed);
          return next;
        });
      }
      setInviteError("Failed to revoke the invite.");
    }
  }

  async function copyLink(token: string) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    try {
      await navigator.clipboard.writeText(`${origin}/invite/${token}`);
      setCopied(token);
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 1500);
    } catch {
      /* clipboard blocked - the link is shown inline as a fallback */
    }
  }

  /** The form's one submit: a preview commits the batch, a single target creates one invite. */
  function submit() {
    return preview ? confirmBatch() : sendInvite();
  }

  return {
    invites, inviteTarget, setInviteTarget, inviteRole, setInviteRole, inviteBusy, inviteError, copied,
    delivery, mode, preview, batchResults, dismissResults: () => setBatchResults(null),
    submit, sendInvite, confirmBatch, resendInvite, revokeInvite, copyLink,
  };
}

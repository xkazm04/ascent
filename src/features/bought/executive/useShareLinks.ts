"use client";

// Client state for the Briefing tab's issued-share-link inventory: the one caller of
// GET /api/org/briefing/share and POST /api/org/briefing/share/revoke.
//
// Three decisions worth keeping:
//
//  1. "Could not read" is a THIRD state, never folded into "nothing issued". The grant list is
//     reconstructed from audit rows and the revocation lookup fails CLOSED, so an unreachable ledger
//     reports every grant revoked - an inventory that rendered an error as an empty list would tell an
//     owner they have published nothing. (Acceptance 6.)
//  2. A revoke is applied optimistically and rolled back by its inverse edit on failure, so the row
//     never needs a second GET to be correct and never shows "Revoked" over a failed ledger write.
//  3. The mint lives in a different component, inside a SERVER subtree (ExecutiveTabActions), so no
//     callback prop can reach this hook. A window event carries the fresh grant instead: one line in
//     BriefingShareButton, no state lifted through a server component, and the minted link gains a
//     durable home instead of existing only in the clipboard. (Acceptance 8.)

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BriefingShareGrant } from "@/lib/db/org-share";
import { shareLinkRows, type ShareLinkRow } from "./shareLinkRows";

export const SHARE_MINTED_EVENT = "ascent:briefing-share-minted";

/** What the mint route returns, as the inventory needs it. `expiresAt` is the route's epoch ms. */
export interface MintedShareGrant {
  org: string;
  jti: string;
  expiresAt: number | null;
  mintedBy?: string | null;
  segment?: string | null;
  stack?: string | null;
}

/** Announce a just-minted grant to any inventory panel mounted on this page. No-op server-side. */
export function publishMintedShareGrant(detail: MintedShareGrant): void {
  if (typeof window === "undefined" || !detail.jti) return;
  window.dispatchEvent(new CustomEvent<MintedShareGrant>(SHARE_MINTED_EVENT, { detail }));
}

/** The mint response as a grant row. Opens start absent, which is the truth: nobody has opened it. */
function grantFromMint(d: MintedShareGrant): BriefingShareGrant {
  const expiresAt = typeof d.expiresAt === "number" && Number.isFinite(d.expiresAt) ? new Date(d.expiresAt).toISOString() : null;
  return {
    jti: d.jti,
    mintedAt: new Date().toISOString(),
    mintedBy: d.mintedBy ?? null,
    expiresAt,
    // The frozen window is not in the mint response; claiming one would be inventing it. The next read
    // of the list fills it in from the audit row.
    window: null,
    segment: d.segment ?? null,
    stack: d.stack ?? null,
    revoked: false,
    expired: false,
    opens: 0,
    lastOpenedAt: null,
  };
}

export type InventoryStatus = "loading" | "ready" | "unreadable";

export interface ShareLinksState {
  rows: ShareLinkRow[];
  status: InventoryStatus;
  /** The jti whose revoke is in flight, so one row can show a busy state without freezing the table. */
  busyJti: string | null;
  error: string | null;
  /** Confirmation of a completed revoke, including one for a jti that was never in the list. */
  note: string | null;
  revoke: (jti: string) => Promise<void>;
}

export function useShareLinks(org: string, enabled: boolean): ShareLinksState {
  const [grants, setGrants] = useState<BriefingShareGrant[]>([]);
  const [status, setStatus] = useState<InventoryStatus>("loading");
  const [busyJti, setBusyJti] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/org/briefing/share?org=${encodeURIComponent(org)}&limit=50`);
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof d.error === "string" ? d.error : "Could not read the share links.");
        if (!alive) return;
        setGrants(Array.isArray(d.grants) ? (d.grants as BriefingShareGrant[]) : []);
        setStatus("ready");
      } catch {
        if (alive) setStatus("unreadable");
      }
    })();
    return () => {
      alive = false;
    };
  }, [org, enabled]);

  useEffect(() => {
    if (!enabled) return;
    function onMinted(e: Event) {
      const d = (e as CustomEvent<MintedShareGrant>).detail;
      if (!d?.jti || typeof d.org !== "string" || d.org.toLowerCase() !== org.toLowerCase()) return;
      setGrants((prev) => (prev.some((g) => g.jti === d.jti) ? prev : [grantFromMint(d), ...prev]));
    }
    window.addEventListener(SHARE_MINTED_EVENT, onMinted);
    return () => window.removeEventListener(SHARE_MINTED_EVENT, onMinted);
  }, [org, enabled]);

  const revoke = useCallback(
    async (jti: string) => {
      const id = jti.trim();
      if (!id) return;
      setBusyJti(id);
      setError(null);
      setNote(null);
      // Optimistic, and rolled back by the inverse edit rather than a snapshot: a sibling update (a
      // mint landing mid-flight) must survive the rollback, which restoring a captured array would undo.
      setGrants((prev) => prev.map((g) => (g.jti === id ? { ...g, revoked: true } : g)));
      try {
        const res = await fetch("/api/org/briefing/share/revoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ org, jti: id }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof d.error === "string" ? d.error : "Could not revoke the link. Try again.");
        setNote(`Revoked ${id}. Anyone holding that URL now gets a refusal.`);
      } catch (e) {
        setGrants((prev) => prev.map((g) => (g.jti === id ? { ...g, revoked: false } : g)));
        setError(e instanceof Error ? e.message : "Could not revoke the link. Try again.");
      } finally {
        setBusyJti(null);
      }
    },
    [org],
  );

  const rows = useMemo(() => shareLinkRows(grants), [grants]);
  return { rows, status, busyJti, error, note, revoke };
}

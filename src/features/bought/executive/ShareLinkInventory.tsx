"use client";

// The Briefing tab's issued-share-link inventory: owner-only, and the first caller in src/ of
// GET /api/org/briefing/share and POST /api/org/briefing/share/revoke.
//
// Why a panel and not a button: a mint publishes the fleet's posture to someone without an account, and
// until now the only record of that was whatever the owner pasted the URL into, and the only way to
// retire one was to demote the person who minted it (killing every link they had ever issued). The data
// layer was built for this reader - batched fail-closed revocation lookups "because the list view asks
// about every grant on the page at once" - and the reader did not exist.
//
// Revoking is destructive and OUTWARD-facing: it ends a capability somebody outside the org may be
// holding open right now. So it is a two-step control. The first click states what will happen and to
// whom; only the second one sends. Nothing about the gate is decided here: the server owns that, and
// this component simply does not mount when the tab says the viewer cannot share.

import { useState } from "react";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import { chipButtonClass } from "@/components/ui";
import { ShareLinkTable } from "./ShareLinkTable";
import { useShareLinks } from "./useShareLinks";

// The caveat org-share.ts wrote for a reader that had not been built: the list is reconstructed from
// audit rows, so retention bounds it, while revocation is permanent. Stating it is what makes the
// paste-an-id field legible rather than redundant.
const RETENTION_NOTE =
  "Rebuilt from the audit trail, so this list is bounded by audit retention and is not the enforcement point: " +
  "revocation is permanent and is checked on the shared page itself. A grant older than retention is absent " +
  "here but still revocable - paste its link id below.";

export function ShareLinkInventory({ org, canShare }: { org: string; canShare: boolean }) {
  const { rows, status, busyJti, error, note, revoke } = useShareLinks(org, canShare);
  const [pending, setPending] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");

  // The server decides who may read this; the client must not even knock when the answer is no.
  if (!canShare) return null;

  const pastedId = pasted.trim();
  const listed = rows.some((r) => r.jti === pending);

  async function confirm() {
    const jti = pending;
    setPending(null);
    if (jti) await revoke(jti);
  }

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Issued share links"
        description="Every read-only briefing link this org has published, newest first."
      />
      <p className="mt-2 type-body-sm text-slate-400">{RETENTION_NOTE}</p>

      <div className="mt-4">
        {status === "loading" && <p className="type-body-sm text-slate-400">Reading the links this org has issued…</p>}
        {/* An unreadable ledger is NOT an empty inventory. The revocation lookup fails closed, so a
            list rendered over a failed read would show every live link as revoked - and an empty state
            would tell an owner they have published nothing. Say which one happened. */}
        {status === "unreadable" && (
          <p role="alert" className="type-body-sm text-orange-300">
            The share-link inventory could not be read, so what this org has issued is unknown right now. Links already
            minted are unaffected. Revoke by link id below if you need to kill one, and reload to try the list again.
          </p>
        )}
        {status === "ready" &&
          (rows.length === 0 ? (
            <p className="type-body-sm text-slate-400">
              No briefing links issued yet. The Share read-only link button above mints one.
            </p>
          ) : (
            <ShareLinkTable rows={rows} busyJti={busyJti} pendingJti={pending} onRevoke={setPending} />
          ))}
      </div>

      {pending && (
        <div role="alert" className="mt-4 rounded-xl border border-orange-500/40 bg-orange-500/[0.06] px-4 py-3">
          <p className="type-body-sm text-orange-200">
            Revoke <span className="type-mono-sm">{pending}</span>? Anyone holding that URL, inside or outside the org,
            gets a refusal from their next read onward. It cannot be undone, and a reader part-way through the briefing
            loses the page. You can mint a fresh link afterwards.
          </p>
          {!listed && (
            <p className="mt-1 type-body-sm text-orange-200/80">
              This id is not in the list above, which is expected for a grant older than audit retention. The endpoint
              does not require it to be listed.
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={confirm} className={chipButtonClass("danger")}>
              Revoke now
            </button>
            <button type="button" onClick={() => setPending(null)} className={chipButtonClass()}>
              Keep the link
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="type-mono-sm uppercase tracking-widest text-slate-500">Link id (jti)</span>
          <input
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Paste a link id to revoke it"
            className="w-80 max-w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 type-mono-sm text-slate-200"
          />
        </label>
        <button
          type="button"
          onClick={() => setPending(pastedId)}
          disabled={!pastedId || busyJti != null}
          className={chipButtonClass("idle", "disabled:opacity-50")}
        >
          Revoke by id
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 type-body-sm text-orange-300">
          {error}
        </p>
      )}
      {note && <p className="mt-2 type-body-sm text-emerald-300">{note}</p>}
    </Card>
  );
}

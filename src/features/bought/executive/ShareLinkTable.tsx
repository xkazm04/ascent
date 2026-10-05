"use client";

// The issued-share-link rows. Split out of ShareLinkInventory.tsx for the 200-LOC cap under
// src/features (AGENTS.md); it renders the table and nothing else. "use client" because the Revoke
// control is a handler - the panel above owns the confirmation and the fetch.

import { OrgTable } from "@/components/org/shared/ui";
import { chipButtonClass } from "@/components/ui";
import type { ShareLinkRow } from "./shareLinkRows";

const STATUS_TONE: Record<ShareLinkRow["status"], string> = {
  live: "text-emerald-300",
  expired: "text-slate-400",
  revoked: "text-orange-300",
};

export function ShareLinkTable({
  rows,
  busyJti,
  pendingJti,
  onRevoke,
}: {
  rows: ShareLinkRow[];
  /** The jti whose revoke is in flight. */
  busyJti: string | null;
  /** The jti awaiting confirmation, so its own button reads back the state it put the panel in. */
  pendingJti: string | null;
  onRevoke: (jti: string) => void;
}) {
  return (
    <OrgTable
      caption="Briefing share links this org has issued"
      minWidth={820}
      head={
        <tr className="text-left">
          <th className="px-4 py-3">Scope</th>
          <th className="px-4 py-3">Minted</th>
          <th className="px-4 py-3">Frozen window</th>
          <th className="px-4 py-3">Opens</th>
          <th className="px-4 py-3">Status</th>
          <th className="px-4 py-3">
            <span className="sr-only">Revoke</span>
          </th>
        </tr>
      }
    >
      {rows.map((r) => (
        <tr key={r.jti} data-jti={r.jti}>
          <td className="px-4 py-3">
            <span className="type-body-sm text-slate-200">{r.scopeLabel}</span>
            {/* The jti is the revoke handle, so it is readable and selectable: an owner working from a
                leaked URL, a colleague's message or the audit log needs to match a row to an id. */}
            <span className="block type-mono-sm text-slate-500">{r.jti}</span>
          </td>
          <td className="px-4 py-3">
            <span className="type-body-sm text-slate-200">{r.mintedAtLabel}</span>
            <span className="block type-mono-sm text-slate-500">{r.mintedByLabel}</span>
          </td>
          <td className="px-4 py-3">
            <span className="type-body-sm text-slate-300">{r.windowLabel}</span>
            <span className="block type-mono-sm text-slate-500">{r.expiryLabel}</span>
          </td>
          <td className="px-4 py-3 type-body-sm text-slate-300">{r.opensLabel}</td>
          <td className={`px-4 py-3 type-mono-sm ${STATUS_TONE[r.status]}`}>{r.statusLabel}</td>
          <td className="px-4 py-3 text-right">
            {r.canRevoke && (
              <button
                type="button"
                onClick={() => onRevoke(r.jti)}
                disabled={busyJti === r.jti}
                title={`Kill the link minted ${r.mintedAtLabel} for ${r.scopeLabel.toLowerCase()}`}
                className={chipButtonClass("idle", "disabled:opacity-50")}
              >
                {busyJti === r.jti ? "Revoking…" : pendingJti === r.jti ? "Confirm below" : "Revoke"}
              </button>
            )}
          </td>
        </tr>
      ))}
    </OrgTable>
  );
}

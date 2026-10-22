"use client";

// Searchable, paginated audit-trail viewer for the org dashboard. Mirrors the audit
// surfaces in Stripe/GitHub/Datadog: filter by action, page with a keyset cursor, and —
// where an entry references a scan — link straight to that pinned report so you can see
// who triggered the scan that moved a score.
//
// Orchestrator only: state/effects live in useAuditLogFilters.ts, the two JSX regions
// (filter bar, table) are AuditLogFilterBar.tsx / AuditLogTable.tsx — split to keep this
// file under the 200-LOC cap (docs/ORG-TABS-REFACTOR.md).
//
// The whole-trail integrity sweep (useAuditIntegritySweep + AuditIntegrityStrip) runs over the query
// the CSV link is built from, so "verified" always describes the same rows the export would file.

import type { AuditLogPage } from "@/lib/db";
import { AuditLogFilterBar } from "./AuditLogFilterBar";
import { AuditLogTable } from "./AuditLogTable";
import { useAuditLogFilters } from "./useAuditLogFilters";
import { AuditIntegrityStrip } from "./AuditIntegrityStrip";
import { appliedQueryFromCsvHref } from "./auditIntegrityModel";
import { useAuditIntegritySweep } from "./useAuditIntegritySweep";

export function AuditLogViewer({ org, initial }: { org: string; initial: AuditLogPage }) {
  const f = useAuditLogFilters(org, initial);
  const sweep = useAuditIntegritySweep(appliedQueryFromCsvHref(f.csvHref));
  const tampered = sweep.showingTampered && sweep.summary ? sweep.summary : null;

  return (
    <div>
      <AuditLogFilterBar
        action={f.action}
        since={f.since}
        until={f.until}
        actor={f.actor}
        loading={f.loading}
        csvHref={f.csvHref}
        entriesShown={f.entries.length}
        onChangeAction={f.changeAction}
        onChangeSince={f.setSince}
        onChangeUntil={f.setUntil}
        onChangeActor={f.setActor}
        onSubmit={f.applyFilters}
      />
      <AuditIntegrityStrip
        summary={sweep.summary}
        stale={sweep.stale}
        loading={sweep.loading}
        error={sweep.error}
        showingTampered={sweep.showingTampered}
        onVerify={() => void sweep.verify()}
        onShowTampered={sweep.showTampered}
      />
      <AuditLogTable
        entries={f.entries}
        loading={f.loading}
        error={f.error}
        cursor={f.cursor}
        onLoadMore={f.loadMore}
        onVerifyAll={() => void sweep.verify()}
        sweepRun={sweep.summary != null}
        tamperedView={
          tampered ? { entries: tampered.tamperedEntries, total: tampered.tampered, onBack: sweep.back } : null
        }
      />
    </div>
  );
}

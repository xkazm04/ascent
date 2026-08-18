"use client";

// Searchable, paginated audit-trail viewer for the org dashboard. Mirrors the audit
// surfaces in Stripe/GitHub/Datadog: filter by action, page with a keyset cursor, and —
// where an entry references a scan — link straight to that pinned report so you can see
// who triggered the scan that moved a score.
//
// Orchestrator only: state/effects live in useAuditLogFilters.ts, the two JSX regions
// (filter bar, table) are AuditLogFilterBar.tsx / AuditLogTable.tsx — split to keep this
// file under the 200-LOC cap (docs/ORG-TABS-REFACTOR.md).

import type { AuditLogPage } from "@/lib/db";
import { AuditLogFilterBar } from "./AuditLogFilterBar";
import { AuditLogTable } from "./AuditLogTable";
import { useAuditLogFilters } from "./useAuditLogFilters";

export function AuditLogViewer({ org, initial }: { org: string; initial: AuditLogPage }) {
  const f = useAuditLogFilters(org, initial);

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
      <AuditLogTable
        entries={f.entries}
        loading={f.loading}
        error={f.error}
        cursor={f.cursor}
        onLoadMore={f.loadMore}
      />
    </div>
  );
}

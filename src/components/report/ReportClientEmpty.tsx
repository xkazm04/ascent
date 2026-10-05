// The report's empty/error state. Extracted from ReportClientStatus (300-LOC cap) and re-exported
// from it, so call sites are unchanged. No hooks and no handlers here on purpose: the actions are
// links, so this file must NOT carry "use client" (that would drag it across the boundary for nothing).

import { EmptyState } from "@/components/EmptyState";

export function Empty({
  title,
  message,
  repo,
  connect,
}: {
  title: string;
  message: string;
  repo?: string;
  /** The repo couldn't be read (404 / private) — offer the GitHub App connect path, since a retry with
   *  the same input can't succeed. */
  connect?: boolean;
}) {
  return (
    <EmptyState
      icon="🧭"
      title={title}
      body={message}
      actions={
        connect
          ? // Permanent failure (404 / private): a retry with the same input can't succeed (see the
            // `connect` doc above), so the one action that can actually resolve it leads, and the
            // retry loop is replaced by a "different repo" path (repo-report-shell-tabs #4).
            [
              { label: "Private repo? Connect GitHub", href: "/onboarding", primary: true },
              { label: "Scan a different repo", href: "/?scan=1" },
              { label: "← Back home", href: "/" },
            ]
          : // Transient failure (timeout / interrupted / network): retry is the right primary.
            [
              // `fresh=1` is what makes this button ACTUALLY try again. On /report the plain
              // `?repo=` href is the URL the user is already on, so the search params — and with
              // them useReportScan's effect deps — never change and nothing re-runs. `fresh=1` both
              // changes the URL and forces a re-score that bypasses the report cache.
              ...(repo
                ? [
                    {
                      label: "Try again",
                      href: `/report?repo=${encodeURIComponent(repo)}&fresh=1`,
                      primary: true,
                    },
                  ]
                : []),
              { label: "← Back home", href: "/" },
            ]
      }
    />
  );
}

"use client";

// Altimeter foundation panel, the shipped markup. The panel owns the actions.
import { Card, OrgTable, SectionHeader } from "@/components/org/shared/ui";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";
import { FoundationSecretsDialog } from "./FoundationSecretsDialog";
import { FoundationRolloutGrid } from "./FoundationRolloutGrid";
import { FoundationRolloutRowView } from "./FoundationRolloutRowView";
import type { useFoundationRollout } from "./useFoundationRollout";

export function FoundationRolloutV1({
  rows,
  state,
}: {
  rows: FoundationRolloutRow[];
  state: ReturnType<typeof useFoundationRollout>;
}) {
  const { viz, missing, busy, notice, dialog, dialogError, installAll, submitDialog, setDialog, setDialogError } = state;
  return (
    <Card id="foundation-rollout">
      <SectionHeader
        size="sm"
        title="Foundation rollout"
        description={`${viz.reporting}/${rows.length} reporting back`}
        right={
          <div data-tour="foundation-rollout" className="flex items-center gap-3">
            <button
              type="button"
              onClick={installAll}
              disabled={busy || missing.length === 0}
              className="focus-ring rounded-lg bg-accent px-4 py-2 type-body-sm font-semibold text-on-accent transition hover:bg-accent-soft disabled:opacity-40"
            >
              {/* The disabled state used to read "Foundation installed everywhere" — a claim the data
                  cannot support, since `foundation.pr_opened` records a DRAFT PR. The CTA still says
                  "install" (that is the intent, and the onboarding panel's twin says the same); only
                  the state claim is corrected. */}
              {missing.length === 0
                ? "Foundation PR opened in every repo"
                : `Install the foundation in ${missing.length} repo${missing.length === 1 ? "" : "s"}`}
            </button>
          </div>
        }
      />

      {notice && (
        <p role="status" className="mt-3 rounded-lg border border-divider bg-surface/60 px-3 py-2 type-body-sm text-slate-300">
          {notice}
        </p>
      )}

      {/* First sight is the grid; the table under it is the auditable per-repo evidence (§2.7). */}
      <FoundationRolloutGrid viz={viz} />

      <div className="mt-4">
        <OrgTable
          caption="Foundation rollout by repository"
          head={
            <tr>
              <th className="px-4 py-2.5 text-left">Repository</th>
              <th className="px-4 py-2.5 text-left">Foundation PR</th>
              <th className="px-4 py-2.5 text-left">Report-back</th>
              <th data-tour="conformance-reported" className="px-4 py-2.5 text-left">
                Conformance
              </th>
            </tr>
          }
        >
          {rows.map((row) => (
            <FoundationRolloutRowView
              key={row.repo}
              row={row}
              busy={busy}
              onProvision={() => {
                setDialogError(null);
                setDialog({ repo: row.repo, mode: "provision" });
              }}
              onRevoke={() => {
                setDialogError(null);
                setDialog({ repo: row.repo, mode: "revoke" });
              }}
            />
          ))}
        </OrgTable>
      </div>

      {dialog && (
        <FoundationSecretsDialog
          repo={dialog.repo}
          mode={dialog.mode}
          busy={busy}
          error={dialogError}
          onConfirm={submitDialog}
          onClose={() => {
            if (!busy) setDialog(null);
          }}
        />
      )}
    </Card>
  );
}

"use client";

// Prism foundation: one ruled table. The matrix grid was the same facts drawn as status blocks.
import { Caption, DataTable, Frame, HEAD_CELL, Lede, PrimaryAction, SectionHead } from "@/components/kit";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";
import { FoundationSecretsDialog } from "./FoundationSecretsDialog";
import { FoundationRowV2 } from "./FoundationRow.v2";
import type { useFoundationRollout } from "./useFoundationRollout";

export function FoundationRolloutV2({
  rows,
  state,
}: {
  rows: FoundationRolloutRow[];
  state: ReturnType<typeof useFoundationRollout>;
}) {
  const { viz, missing, busy, notice, dialog, dialogError, installAll, submitDialog, setDialog, setDialogError } = state;
  const label =
    missing.length === 0
      ? "Foundation PR opened in every repo"
      : `Install the foundation in ${missing.length} repo${missing.length === 1 ? "" : "s"}`;
  return (
    <Frame id="foundation-rollout">
      <SectionHead
        eyebrow="Foundation"
        title="Rollout across"
        named={`${rows.length} ${rows.length === 1 ? "repository" : "repositories"}.`}
        lede={`${viz.reporting} reporting conformance back. A foundation PR is a draft proposal, not an observed install. Never reported is not zero.`}
        actions={
          <div data-tour="foundation-rollout">
            <PrimaryAction onClick={installAll} disabled={busy || missing.length === 0}>
              {label}
            </PrimaryAction>
          </div>
        }
      />
      {notice && (
        <Lede className="mt-3">
          <span role="status">{notice}</span>
        </Lede>
      )}
      <div className="mt-4">
        <DataTable
          density="compact"
          caption="Foundation rollout by repository"
          minWidth={760}
          head={
            <tr>
              <th className={HEAD_CELL}>Repository</th>
              <th className={HEAD_CELL}>Foundation PR</th>
              <th className={HEAD_CELL}>Report-back</th>
              <th className={HEAD_CELL} data-tour="conformance-reported">Conformance</th>
            </tr>
          }
        >
          {rows.map((row) => (
            <FoundationRowV2
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
        </DataTable>
      </div>
      <Caption>
        {viz.unjudged} with no Ascent PR, {viz.declared} with a draft PR, {viz.provisioned} provisioned to report back.
      </Caption>
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
    </Frame>
  );
}

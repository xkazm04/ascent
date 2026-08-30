"use client";

// Fleet foundation rollout — the Repositories tab's install-and-instrument surface (moonshot #35).
//
// Three columns, one row per repo: did Ascent open the `.ai/` install PR here, does this repo report
// its own conformance back, and what did it last report. The bulk bar installs across every repo that
// hasn't got the PR yet; the per-row action provisions (or removes) report-back behind a typed
// confirmation.
//
// The LEGEND is not decoration. Two of the three columns can be honestly empty, and the two empties
// mean different things: "—" under conformance is NEVER REPORTED (not 0%), and "not provisioned" is
// not "off". Saying so in the panel is what keeps a reader from filling the gap with an assumption.
//
// Role is NOT prefetched: the panel renders for anyone who can read the tab and the route answers 403
// if they can't perform the action. That is the deliberate trade — a prefetched role would be a second
// place for the authorization answer to live, and it is the one that would drift.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";
import { Card, OrgTable, SectionHeader } from "@/components/org/shared/ui";
import { FoundationSecretsDialog } from "./FoundationSecretsDialog";
import { FoundationRolloutRowView } from "./FoundationRolloutRowView";

type Dialog = { repo: string; mode: "provision" | "revoke" } | null;

export function FoundationRolloutPanel({ slug, rows }: { slug: string; rows: FoundationRolloutRow[] }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (rows.length === 0) return null;

  const missing = rows.filter((r) => !r.foundationPrAt).map((r) => r.repo);

  async function installAll() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/report/foundation/pr-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, repos: missing }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        results?: Array<{ ok: boolean }>;
        skipped?: number;
      };
      if (!res.ok) {
        setNotice(body.error ?? "Couldn't open the foundation PRs.");
        return;
      }
      const opened = (body.results ?? []).filter((r) => r.ok).length;
      const failed = (body.results ?? []).length - opened;
      setNotice(
        `Opened ${opened} draft PR${opened === 1 ? "" : "s"}` +
          (failed ? ` · ${failed} couldn't be installed (see the rows)` : "") +
          (body.skipped ? ` · ${body.skipped} over the 25-repo cap` : ""),
      );
      router.refresh();
    } catch {
      setNotice("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function submitDialog(confirm: string) {
    if (!dialog) return;
    setBusy(true);
    setDialogError(null);
    try {
      const res = await fetch("/api/report/foundation/secrets", {
        method: dialog.mode === "provision" ? "POST" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, repos: [dialog.repo], confirm }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        results?: Array<{ ok: boolean; error?: string }>;
      };
      if (!res.ok) {
        setDialogError(body.error ?? "The request was refused.");
        return;
      }
      const first = body.results?.[0];
      if (first && !first.ok) {
        setDialogError(first.error ?? "GitHub refused the write.");
        return;
      }
      setNotice(
        dialog.mode === "provision"
          ? `${dialog.repo} now reports its conformance back on every CI run.`
          : `Report-back removed from ${dialog.repo} and its token revoked.`,
      );
      setDialog(null);
      router.refresh();
    } catch {
      setDialogError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="foundation-rollout">
      <SectionHeader
        size="sm"
        title="Foundation rollout"
        description="Install the .ai/ foundation across the fleet, then let each repo report its own conformance back."
        right={
          <div data-tour="foundation-rollout" className="flex items-center gap-3">
            <button
              type="button"
              onClick={installAll}
              disabled={busy || missing.length === 0}
              className="focus-ring rounded-lg bg-accent px-4 py-2 type-body-sm font-semibold text-on-accent transition hover:bg-accent-soft disabled:opacity-40"
            >
              {missing.length === 0
                ? "Foundation installed everywhere"
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

      <p className="mt-3 type-body-sm text-slate-500">
        <span className="font-mono text-slate-400">—</span> under Conformance means{" "}
        <strong className="text-slate-400">never reported</strong>, not 0%.{" "}
        <span className="text-slate-400">Not provisioned</span> means Ascent has written no report-back secrets here —
        the repo may still run <span className="font-mono">.ai/doctor.mjs</span> locally.
      </p>

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

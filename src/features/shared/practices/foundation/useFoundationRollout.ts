"use client";

// Install and report-back actions for the foundation panel. Both compositions call this.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";
import { foundationViz } from "./foundationViz";

type Dialog = { repo: string; mode: "provision" | "revoke" } | null;

export function useFoundationRollout(slug: string, rows: FoundationRolloutRow[]) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const missing = rows.filter((r) => !r.foundationPrAt).map((r) => r.repo);
  const viz = foundationViz(rows);

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

  return { dialog, setDialog, busy, dialogError, setDialogError, notice, missing, viz, installAll, submitDialog };
}

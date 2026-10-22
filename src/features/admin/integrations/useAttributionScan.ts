"use client";

// Runs the disclosed one-shot scan through the existing /api/org/import route (runImportScan), so its
// auth, credit reservation and capacity truncation apply unchanged. No new route. On completion the
// page refreshes and the server re-derives the buckets from what landed.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { runImportScan } from "@/components/onboarding/importScan";
import type { ScanPlan } from "./attributionReconcileModel";

export type ScanPhase = "idle" | "running" | "done" | "failed";

/** Per-repo outcome words, from the stream's `repo` events. */
export type RepoOutcome = "scanned" | "skipped" | "failed";

export function useAttributionScan(plan: ScanPlan | null) {
  const router = useRouter();
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [outcomes, setOutcomes] = useState<Record<string, RepoOutcome>>({});
  const [message, setMessage] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(async () => {
    if (!plan || controller.current) return;
    const ctrl = new AbortController();
    controller.current = ctrl;
    setPhase("running");
    setOutcomes({});
    setMessage(null);
    let notice: string | null = null;
    const result = await runImportScan(plan.request, ctrl, {
      onRepo: ({ repo, error, skipped }) => setOutcomes((prev) => ({ ...prev, [repo]: skipped ? "skipped" : error ? "failed" : "scanned" })),
      onResult: () => undefined,
      onError: (text) => {
        notice = text;
      },
      onNotice: ({ skipped }) => {
        if (skipped > 0) notice = `${skipped} skipped: not enough scan credits.`;
      },
    });
    controller.current = null;
    if (result.ok) {
      setPhase("done");
      setMessage(notice);
      router.refresh();
    } else if (!result.aborted || result.stalled) {
      setPhase("failed");
      setMessage(result.stalled ? "The scan stopped responding. It may still finish; reload to check." : (result.message ?? "Scan failed."));
    } else {
      setPhase("idle");
    }
  }, [plan, router]);

  return { phase, outcomes, message, run };
}

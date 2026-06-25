import { Suspense } from "react";
import { ReportShell } from "@/components/report/ReportShell";
import { ReportClient } from "@/components/report/ReportClient";

export const metadata = {
  title: "Scan a repository — Ascent",
  description:
    "Run an AI-native maturity scan of any GitHub repository: a 5-level ladder across 9 dimensions, with evidence, a radar, and a roadmap to the next level.",
};

export const dynamic = "force-dynamic";

export default function ReportPage() {
  return (
    <ReportShell>
      {/* useSearchParams in ReportClient requires a Suspense boundary; the client mounts
          immediately and renders its own live scan view, so a minimal fallback covers the
          brief hydration gap. */}
      <Suspense fallback={<div className="mx-auto w-full max-w-md py-12 text-center text-sm text-slate-500">Loading…</div>}>
        <ReportClient />
      </Suspense>
    </ReportShell>
  );
}

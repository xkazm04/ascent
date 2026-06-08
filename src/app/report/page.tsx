import { Suspense } from "react";
import { ReportShell } from "@/components/report/ReportShell";
import { ReportClient } from "@/components/report/ReportClient";
import { ReportSkeleton } from "@/components/report/ReportSkeleton";

export const metadata = {
  title: "Scan a repository — Ascent",
  description:
    "Run an AI-native maturity scan of any GitHub repository: a 5-level ladder across 9 dimensions, with evidence, a radar, and a roadmap to the next level.",
};

export const dynamic = "force-dynamic";

export default function ReportPage() {
  return (
    <ReportShell>
      {/* Show the report's silhouette on first paint / slow hydration rather than a bare
          "Loading…" line that then snaps to the polished checklist. */}
      <Suspense fallback={<div className="mx-auto w-full max-w-md py-12"><ReportSkeleton /></div>}>
        <ReportClient />
      </Suspense>
    </ReportShell>
  );
}

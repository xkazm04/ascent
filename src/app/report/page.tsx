import { Suspense } from "react";
import { ReportShell } from "@/components/report/ReportShell";
import { ReportClient } from "@/components/report/ReportClient";
import { ReportSkeleton } from "@/components/report/ReportSkeleton";

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

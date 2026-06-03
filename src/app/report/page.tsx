import { Suspense } from "react";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { ReportClient } from "@/components/report/ReportClient";
import { ReportSkeleton } from "@/components/report/ReportSkeleton";

export const dynamic = "force-dynamic";

export default function ReportPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-5 py-10">
        {/* Show the report's silhouette on first paint / slow hydration rather than a bare
            "Loading…" line that then snaps to the polished checklist. */}
        <Suspense fallback={<div className="mx-auto w-full max-w-md py-12"><ReportSkeleton /></div>}>
          <ReportClient />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}

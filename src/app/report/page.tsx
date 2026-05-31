import { Suspense } from "react";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { ReportClient } from "@/components/report/ReportClient";

export const dynamic = "force-dynamic";

export default function ReportPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-5 py-10">
        <Suspense fallback={<div className="py-24 text-center text-slate-500">Loading…</div>}>
          <ReportClient />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}

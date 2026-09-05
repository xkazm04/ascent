import { SiteFooter, SiteHeader } from "@/components/Brand";
import { EmptyState } from "@/components/EmptyState";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      {/* id="main": the global skip-to-content link (app/layout.tsx) targets #main. Without it the
          keyboard bypass silently no-ops on /usage. */}
      <main id="main" className="mx-auto w-full max-w-4xl px-5 py-10">{children}</main>
      <SiteFooter />
    </>
  );
}

export function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Shell>
      <EmptyState icon="📊" title={title} body={children} actions={[{ label: "← Home", href: "/" }]} />
    </Shell>
  );
}

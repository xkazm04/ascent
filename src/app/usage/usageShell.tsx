import { SiteFooter, SiteHeader } from "@/components/Brand";
import { EmptyState } from "@/components/EmptyState";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl px-5 py-10">{children}</main>
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

import { SiteFooter, SiteHeader } from "@/components/Brand";

/**
 * Shared page frame for the report + trends routes: the site header, a max-w-5xl main landmark
 * (carrying id="main" for the skip link), and the footer. Both pages hand-rolled this identical
 * scaffold inline and could drift on width/padding — this is the one source of truth.
 */
export function ReportShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-5xl px-5 py-10">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

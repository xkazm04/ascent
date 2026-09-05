// HairlineGrid — the editorial signature for a cluster of cells (levels, pricing, stat ledgers): a
// 1px gap over a divider-colored bed reads as hairline rules between cells. Children must set their
// own background (e.g. bg-ink) so the gap shows through as a rule.

export function HairlineGrid({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`grid gap-px overflow-hidden rounded-2xl border border-divider bg-divider ${className}`}>
      {children}
    </div>
  );
}

/** Static stand-in shown while the Suspense boundary resolves during prerender — visually identical to
 *  the real trigger so the primary CTA is present in the cached HTML; hydration swaps in the live modal. */
export function ScanTriggerFallback() {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      className="focus-ring inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-base font-semibold text-on-accent shadow-2xl shadow-black/40 transition hover:bg-accent-soft"
    >
      Scan a repository <span aria-hidden>→</span>
    </button>
  );
}

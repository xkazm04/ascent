// The centered "the link didn't work / there's nothing here" panel the token-authorized share pages
// render instead of their payload — /live/shared/[token] and /share/briefing/[token]. Both had defined
// this identical block privately; it is extracted here so the two capability-link surfaces keep saying
// "expired / revoked / nothing yet" in one voice.
//
// Only the min-height differs between the two sites and it is a genuine layout difference, not drift:
// the live wall is a full-viewport kiosk (min-h-screen), while the briefing notice sits between that
// page's own branded header and footer and so fills less (min-h-[60vh]). It stays a prop rather than
// being flattened to one value.
//
// NOTE: /report/compare and /trends also declare a local `Notice`, but those are one-line aliases that
// bind a page icon onto the shared `RepoScanNotice` (@/components/EmptyState) — a different, richer
// component with call-to-action buttons. They are already deduplicated and are NOT this component.

export function TokenNotice({
  title,
  body,
  minHeightClass = "min-h-screen",
}: {
  title: string;
  body: string;
  /** Tailwind min-height for the centering box. Defaults to the full-viewport kiosk framing. */
  minHeightClass?: string;
}) {
  return (
    <main
      id="main"
      className={`mx-auto flex ${minHeightClass} max-w-lg flex-col items-center justify-center px-5 text-center`}
    >
      <h1 className="text-xl font-bold text-white">{title}</h1>
      <p className="mt-2 text-base text-slate-400">{body}</p>
    </main>
  );
}

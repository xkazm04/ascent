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
// This panel still owns its own kiosk framing, but it now uses the same CTA pair (and the same
// Home / optional Scan pairing) so a dead token is a recoverable failure, not a quiet empty.

import Link from "next/link";
import { CTA_OUTLINE, CTA_PRIMARY } from "@/lib/ui";

export function TokenNotice({
  title,
  body,
  minHeightClass = "min-h-screen",
  repo,
}: {
  title: string;
  body: string;
  /** Tailwind min-height for the centering box. Defaults to the full-viewport kiosk framing. */
  minHeightClass?: string;
  /** When a repo is known, offer RepoScanNotice's "Scan {repo}" primary CTA next to Home. */
  repo?: string;
}) {
  return (
    <main
      id="main"
      className={`mx-auto flex ${minHeightClass} max-w-lg flex-col items-center justify-center px-5 text-center`}
    >
      {/* Danger kicker: this is a failed share, not the peaceful empty EmptyState uses for "nothing yet". */}
      <p className="type-mono-sm uppercase tracking-[0.3em] text-danger">Unavailable</p>
      <h1 className="mt-4 type-title font-bold text-white">{title}</h1>
      <p className="mt-2 type-body text-slate-400">{body}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {repo ? (
          <Link href={`/report?repo=${encodeURIComponent(repo)}`} className={CTA_PRIMARY}>
            Scan {repo}
          </Link>
        ) : null}
        <Link href="/" className={repo ? CTA_OUTLINE : CTA_PRIMARY}>
          ← Home
        </Link>
      </div>
    </main>
  );
}

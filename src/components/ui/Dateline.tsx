// Dateline — the editorial masthead rule: a mono, wide-tracked metadata row over a hairline bottom
// border. The signature "publication" header for flagship surfaces (landing masthead, report header,
// org overview). The eyebrow type tokens come from the canonical Kicker (tone="muted") so the
// "one treatment" promise holds — only the layout/border chrome lives here.

import { Kicker } from "./Kicker";

export function Dateline({
  left,
  right,
  className = "",
}: {
  left: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    // flex-wrap (not `hidden sm:inline` on the right): on a narrow viewport the metadata WRAPS onto its
    // own line beneath `left` instead of being dropped, so the information reflows rather than vanishing.
    // gap-y keeps the wrapped row from crowding the left label; justify-between still spreads them on one
    // line when both fit.
    <div className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-divider pb-4 ${className}`}>
      <Kicker tone="muted">{left}</Kicker>
      {right != null && <Kicker tone="muted">{right}</Kicker>}
    </div>
  );
}

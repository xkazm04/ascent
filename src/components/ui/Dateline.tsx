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
    <div className={`flex items-center justify-between border-b border-divider pb-4 ${className}`}>
      <Kicker tone="muted">{left}</Kicker>
      {right != null && (
        <Kicker tone="muted" className="hidden sm:inline">
          {right}
        </Kicker>
      )}
    </div>
  );
}

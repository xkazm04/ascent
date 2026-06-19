// Dateline — the editorial masthead rule: a mono, wide-tracked metadata row over a hairline bottom
// border. The signature "publication" header for flagship surfaces (landing masthead, report header,
// org overview).

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
    <div
      className={`flex items-center justify-between border-b border-divider pb-4 font-mono text-xs uppercase tracking-[0.22em] text-slate-500 ${className}`}
    >
      <span>{left}</span>
      {right != null && <span className="hidden sm:inline">{right}</span>}
    </div>
  );
}

// Kicker — the canonical brand label: mono, uppercase, wide-tracked. One treatment for the ~86
// hand-rolled "font-mono uppercase tracking-widest" labels scattered across the app. `accent` for
// section eyebrows, `muted` for table headers / datelines / metadata.

export type KickerTone = "accent" | "muted";

export function Kicker({
  children,
  tone = "accent",
  className = "",
}: {
  children: React.ReactNode;
  tone?: KickerTone;
  className?: string;
}) {
  const color = tone === "accent" ? "text-accent" : "text-slate-500";
  return <div className={`font-mono text-xs uppercase tracking-[0.22em] ${color} ${className}`}>{children}</div>;
}

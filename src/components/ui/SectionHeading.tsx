// SectionHeading — the canonical section header: an optional Kicker eyebrow, a title, an optional
// intro line, and an optional right-aligned slot. One treatment unifying the landing section heads
// and the org dashboard's SectionHeader.
//
//   size="page" → editorial section top (text-2xl/3xl)   [marketing + flagship surfaces]
//   size="lg"   → standalone dashboard section (text-lg)  [org default]
//   size="sm"   → in-card heading next to tiles (text-base)

import { Kicker, type KickerTone } from "./Kicker";

export function SectionHeading({
  kicker,
  kickerTone = "muted",
  title,
  intro,
  right,
  size = "lg",
  id,
  className = "",
  introClassName = "",
}: {
  kicker?: React.ReactNode;
  kickerTone?: KickerTone;
  title: React.ReactNode;
  intro?: React.ReactNode;
  right?: React.ReactNode;
  size?: "page" | "lg" | "sm";
  id?: string;
  className?: string;
  introClassName?: string;
}) {
  const titleCls =
    size === "page"
      ? "text-2xl font-bold text-white sm:text-3xl"
      : size === "lg"
        ? "text-lg font-semibold text-white"
        : "text-base font-semibold text-white";

  const heading = (
    <div>
      {kicker != null && <Kicker tone={kickerTone}>{kicker}</Kicker>}
      <h2 id={id} className={`${kicker != null ? "mt-2" : ""} ${titleCls}`}>
        {title}
      </h2>
      {intro != null && <p className={`mt-2 max-w-2xl text-base text-slate-400 ${introClassName}`}>{intro}</p>}
    </div>
  );

  if (right == null) return <div className={className}>{heading}</div>;
  return (
    <div className={`flex flex-wrap items-end justify-between gap-3 ${className}`}>
      {heading}
      {right}
    </div>
  );
}

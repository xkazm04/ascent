"use client";

// App Readiness Passport hero — the first thing seen on a repo report. A fusion of two prototyped
// directions: the Altimeter instrument panel (strata motif, sub-rung "equalizer", instrument readout)
// as the frame, with the two achieved readiness ratings rendered as embossed Credential Stamp SEALS in
// the top-right of the header. Motion is entry-only (seals press in once, equalizer bars grow once) and
// reduced-motion shows everything at rest. Fed report.passport (or the /api/report/passport fallback)
// by ReportView; renders nothing when no passport exists.

import { motion } from "framer-motion";
import type { AppPassport } from "@/lib/types";
import { scoreHex } from "@/lib/ui";
import { bandColor, bandLabel } from "@/lib/org/passport-display";
import { usePrefersReducedMotion } from "@/components/report/chartMotion";
import { Surface, Kicker } from "@/components/ui";

export function PassportHero({ passport: pp, repo }: { passport: AppPassport; repo: string }) {
  const reduced = usePrefersReducedMotion();
  const auto = pp.automationReadiness;
  const prod = pp.productionReadiness;

  return (
    <Surface radius="2xl" className="relative overflow-hidden p-6" data-testid="passport-hero">
      <div aria-hidden className="strata pointer-events-none absolute inset-0 opacity-70" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(34rem_16rem_at_85%_-20%,rgba(59,158,255,0.08),transparent_70%)]" />

      <div className="relative">
        {/* Header — title on the left, the two achieved ratings stamped into the top-right corner */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-divider pb-4">
          <div>
            <Kicker>App Readiness Passport</Kicker>
            <h2 className="mt-1.5 text-xl font-bold text-white">{repo}</h2>
            <p className="mt-1 font-mono text-xs uppercase tracking-[0.18em] text-slate-500">
              Instrument readout · {pp.generatedAt}
            </p>
          </div>
          <div className="flex shrink-0 gap-3">
            <CredentialSeal
              title="Automation"
              mark={auto.level}
              score={auto.score}
              caption="ready for agents"
              hint="Automation readiness: how ready this codebase is for AI agents to work in it safely — higher means more agent-ready."
              color={scoreHex(auto.score)}
              rotate={-4}
              delay={0.05}
              reduced={reduced}
            />
            <CredentialSeal
              title="Production"
              mark={bandLabel(prod.band).toUpperCase()}
              score={prod.score}
              caption="trusted in prod"
              hint="Production readiness: how trusted this codebase is to run in production — rolled up from CI, tests, security, observability, and delivery."
              color={bandColor(prod.band)}
              rotate={4}
              delay={0.13}
              reduced={reduced}
            />
          </div>
        </div>

        {/* Production sub-rungs — instrument equalizer */}
        <div className="mt-5">
          <Kicker tone="muted" className="mb-3">Production rungs</Kicker>
          <RungEqualizer rungs={productionRungs(prod)} reduced={reduced} />
        </div>

        {/* Named stack */}
        <div className="mt-5">
          <Kicker tone="muted" className="mb-1.5">Stack</Kicker>
          <StackChips pp={pp} />
        </div>

        {/* Provenance + export */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-xs text-slate-600">
            {pp.evidence.source} · confidence {Math.round(pp.evidence.confidence * 100)}% · as of {pp.generatedAt}
            {pp.identity.license ? ` · ${pp.identity.license}` : ""}
          </p>
          <a
            href={`/api/report/passport?repo=${encodeURIComponent(repo)}&download`}
            className="focus-ring shrink-0 rounded-md border border-divider px-3 py-1.5 font-mono text-xs text-slate-300 transition hover:border-accent hover:text-white"
            title="Download app-passport.json"
          >
            ↓ passport.json
          </a>
        </div>
      </div>
    </Surface>
  );
}

/** An embossed rubber-stamp seal: double ring + serrated tick ring + arced axis title + the achieved
 *  mark/score at centre, with a caption below. Slightly rotated; presses in once on mount. */
function CredentialSeal({
  title,
  mark,
  score,
  caption,
  hint,
  color,
  rotate,
  delay,
  reduced,
}: {
  title: string;
  mark: string;
  score: number;
  caption: string;
  /** Hover glossary so a first-time reader knows what this readiness rating measures. */
  hint: string;
  color: string;
  rotate: number;
  delay: number;
  reduced: boolean;
}) {
  const S = 150;
  const c = S / 2;
  const rOuter = 70;
  const rInner = 62;
  const rText = 52;
  const topArc = `M ${c - rText},${c} A ${rText},${rText} 0 0 1 ${c + rText},${c}`;
  const ticks = Array.from({ length: 52 }, (_, i) => {
    const a = (i / 52) * 2 * Math.PI;
    return [c + 64 * Math.cos(a), c + 64 * Math.sin(a), c + 67.5 * Math.cos(a), c + 67.5 * Math.sin(a)] as const;
  });
  const markFont = mark.length <= 3 ? 30 : mark.length <= 6 ? 21 : 16;

  return (
    <motion.div
      className="flex w-[116px] cursor-help flex-col items-center"
      title={hint}
      initial={reduced ? false : { opacity: 0, scale: 0.82, rotate: rotate - 8 }}
      animate={{ opacity: 1, scale: 1, rotate }}
      transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 130, damping: 12, delay }}
    >
      <svg viewBox={`0 0 ${S} ${S}`} className="h-auto w-full" role="img" aria-label={`${title} readiness: ${mark}, score ${score} of 100`}>
        <defs>
          <path id={`arc-${title}`} d={topArc} fill="none" />
        </defs>
        <circle cx={c} cy={c} r={rOuter} fill="none" stroke={color} strokeWidth={2.5} opacity={0.9} />
        <circle cx={c} cy={c} r={rInner} fill="none" stroke={color} strokeWidth={1} opacity={0.5} />
        <circle cx={c} cy={c} r={rInner - 4} fill={color} opacity={0.06} />
        {ticks.map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={1} opacity={0.45} />
        ))}
        <text fontSize={9.5} letterSpacing={2} fontWeight={700} fill={color} opacity={0.85}>
          <textPath href={`#arc-${title}`} startOffset="50%" textAnchor="middle">
            {title.toUpperCase()}
          </textPath>
        </text>
        <text x={c} y={c + 2} textAnchor="middle" fontSize={markFont} fontWeight={800} fill={color} className="font-mono">
          {mark}
        </text>
        <text x={c} y={c + 26} textAnchor="middle" fontSize={14} fontWeight={800} fill={color} className="font-mono">
          {score}
          <tspan fontSize={8} opacity={0.6} dx={1.5}>
            /100
          </tspan>
        </text>
      </svg>
      <span className="mt-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">{caption}</span>
    </motion.div>
  );
}

/** The five production sub-rungs as a vertical "equalizer" of meter bars that grow once on mount. */
function RungEqualizer({ rungs, reduced }: { rungs: Rung[]; reduced: boolean }) {
  return (
    <div className="grid grid-cols-5 gap-2 sm:gap-3">
      {rungs.map((r, i) => (
        <div key={r.label} className="flex flex-col items-center gap-2">
          <div className="relative flex h-24 w-full max-w-[44px] items-end overflow-hidden rounded bg-slate-800/70">
            <motion.div
              className="w-full origin-bottom rounded"
              style={{ height: `${Math.max(3, r.pct)}%`, backgroundColor: scoreHex(r.pct) }}
              initial={reduced ? false : { scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={reduced ? { duration: 0 } : { duration: 0.7, ease: "easeOut", delay: 0.1 + i * 0.06 }}
            />
          </div>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-300">{r.label}</span>
          <span className="text-center font-mono text-[10px] leading-tight text-slate-500">{r.level}</span>
        </div>
      ))}
    </div>
  );
}

/** The named-stack chip row — languages in accent, everything else muted. The passport's "first sight" identity. */
function StackChips({ pp }: { pp: AppPassport }) {
  const rest: string[] = [];
  for (const f of pp.stack.frameworks) rest.push(f);
  for (const p of pp.stack.persistence) if (p.engine) rest.push(p.engine);
  for (const i of pp.stack.integrations) rest.push(i.name);
  if (pp.stack.hosting) rest.push(`host: ${pp.stack.hosting}`);
  const chips = [...new Set(rest)].slice(0, 10);
  if (pp.stack.languages.length === 0 && chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {pp.stack.languages.map((l) => (
        <span key={`lang-${l.name}`} className="rounded border border-accent/30 bg-accent/5 px-2 py-0.5 font-mono text-xs text-accent">
          {l.name}
        </span>
      ))}
      {chips.map((ch) => (
        <span key={ch} className="rounded border border-divider bg-surface/60 px-2 py-0.5 font-mono text-xs text-slate-400">
          {ch}
        </span>
      ))}
    </div>
  );
}

// ── production sub-rung fill (display-only; mirrors the weighted contributions in lib/analyze/passport.ts) ──
interface Rung {
  label: string;
  level: string;
  pct: number;
}
const CI_PTS: Record<string, number> = { none: 0, build: 20, checks: 45, gated: 70, delivery: 85, progressive: 100 };
const TEST_PTS: Record<string, number> = { none: 0, smoke: 25, partial: 50, substantial: 75, comprehensive: 100 };
const SEC_PTS: Record<string, number> = { none: 0, policy: 25, scanning: 50, gated: 75, "supply-chain": 100 };
const OBS_PTS: Record<string, number> = { none: 0, logs: 40, errors: 60, metrics: 80, tracing: 100 };

function productionRungs(prod: AppPassport["productionReadiness"]): Rung[] {
  const deliv =
    (prod.delivery.migrations === "versioned" ? 50 : prod.delivery.migrations === "scripted" ? 25 : 0) +
    (prod.delivery.iac ? 25 : 0) +
    (prod.delivery.rollback ? 25 : 0);
  const delivLevel = `migrations ${prod.delivery.migrations}${prod.delivery.iac ? " · iac" : ""}${prod.delivery.rollback ? " · rollback" : ""}`;
  return [
    { label: "CI", level: prod.ci.level, pct: CI_PTS[prod.ci.level] ?? 0 },
    { label: "Tests", level: prod.tests.level, pct: TEST_PTS[prod.tests.level] ?? 0 },
    { label: "Security", level: prod.security.level, pct: SEC_PTS[prod.security.level] ?? 0 },
    { label: "Observ.", level: prod.observability.level, pct: OBS_PTS[prod.observability.level] ?? 0 },
    { label: "Delivery", level: delivLevel, pct: Math.min(100, deliv) },
  ];
}

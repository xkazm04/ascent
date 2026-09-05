// The App Readiness Passport card (P2) — the per-repo scorecard rendered on the report. Server-safe (no
// client hooks). Two readiness axes side by side, the named stack, the production sub-scale rungs, the
// honest blockers, and a download of the raw passport.json. Sibling to the maturity report, not a
// replacement: the report explains the maturity score; the passport names the stack + the prod posture.

import { Card, Meter, SectionHeader } from "@/components/org/shared/ui";
import { PassportOverridePin } from "@/components/report/PassportOverridePin";
import { PassportCardDeclined } from "@/features/standing/passports/PassportCardDeclined";
import { PassportDeclineControl } from "@/features/standing/passports/PassportDeclineControl";
import { PassportOwnerControls } from "@/features/standing/passports/PassportOwnerControls";
import { bandColor, bandLabel, passportStackChips } from "@/lib/org/passport-display";
import { scoreHex } from "@/lib/ui";
import type { AppPassport } from "@/lib/types";

function Rung({ label, value, tone }: { label: string; value: string; tone?: "warn" | "ok" }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-800/60 py-1.5 type-body-sm last:border-0">
      <span className="font-mono uppercase tracking-widest text-slate-500">{label}</span>
      <span className={`font-mono ${tone === "warn" ? "text-orange-300" : tone === "ok" ? "text-emerald-300" : "text-slate-300"}`}>{value}</span>
    </div>
  );
}

export function PassportCard({ passport: pp, repo, canEdit = false }: { passport: AppPassport; repo: string; canEdit?: boolean }) {
  const auto = pp.automationReadiness;
  const prod = pp.productionReadiness;
  const chips = passportStackChips(pp);
  const allBlockers = [...auto.blockers, ...prod.blockers];
  const blockers = allBlockers.slice(0, 6);
  const hidden = allBlockers.length - blockers.length;

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="App Readiness Passport"
        description="The portfolio scorecard: how ready this app is for full LLM-automated development, and for production. Names the stack on purpose."
        right={
          <a
            href={`/api/report/passport?repo=${encodeURIComponent(repo)}&download`}
            className="focus-ring rounded-md border border-slate-700 px-3 py-1.5 type-mono-sm text-slate-300 transition hover:border-accent hover:text-white"
            title="Download app-passport.json"
          >
            ↓ passport.json
          </a>
        }
      />

      {/* Two readiness axes */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="type-mono-sm uppercase tracking-widest text-slate-500">Automation readiness</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="type-figure font-bold" style={{ color: scoreHex(auto.score) }}>{auto.level}</span>
            <span className="font-mono type-body" style={{ color: scoreHex(auto.score) }}>{auto.score}</span>
            <span className="type-mono-sm text-slate-500">/100 · ready for agents</span>
          </div>
          <Meter className="mt-2" size="sm" value={auto.score} color={scoreHex(auto.score)} />
          <div className="mt-2 type-mono-sm text-slate-500">
            self-verify: {(["build", "test", "lint", "typecheck"] as const).filter((k) => auto.selfVerify[k]).join(" · ") || "none"}
            {auto.aiInWorkflow ? " · AI in workflow" : ""}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="type-mono-sm uppercase tracking-widest text-slate-500">Production readiness</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="type-figure font-bold" style={{ color: bandColor(prod.band) }}>{bandLabel(prod.band)}</span>
            <span className="font-mono type-body" style={{ color: bandColor(prod.band) }}>{prod.score}</span>
            <span className="type-mono-sm text-slate-500">/100 · trusted in prod</span>
          </div>
          <Meter className="mt-2" size="sm" value={prod.score} color={bandColor(prod.band)} />
          {prod.overridden ? <PassportOverridePin overridden={prod.overridden} className="mt-2" /> : null}
          <div className="mt-3 space-y-0">
            <Rung label="CI" value={prod.ci.level} tone={prod.ci.level === "gated" || prod.ci.level === "delivery" || prod.ci.level === "progressive" ? "ok" : "warn"} />
            <Rung label="Tests" value={prod.tests.level} tone={prod.tests.criticalPathCovered ? "ok" : "warn"} />
            <Rung label="Security" value={prod.security.level} tone={prod.security.level === "gated" || prod.security.level === "supply-chain" ? "ok" : "warn"} />
            <Rung label="Observability" value={prod.observability.level} tone={prod.observability.level === "none" ? "warn" : "ok"} />
            <Rung label="Delivery" value={`migrations: ${prod.delivery.migrations}${prod.delivery.iac ? " · iac" : ""}${prod.delivery.rollback ? " · rollback" : ""}`} />
          </div>
        </div>
      </div>

      {/* Named stack */}
      {chips.length > 0 && (
        <div className="mt-4">
          <div className="type-mono-sm uppercase tracking-widest text-slate-500">Stack</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {pp.stack.languages.map((l) => (
              <span key={`lang-${l.name}`} className="rounded border border-accent/30 bg-accent/5 px-1.5 py-0.5 type-caption text-accent">{l.name}</span>
            ))}
            {chips.map((c) => (
              <span key={c} className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 type-caption text-slate-400">{c}</span>
            ))}
            {pp.stack.hosting && <span className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 type-caption text-slate-400">host: {pp.stack.hosting}</span>}
          </div>
        </div>
      )}

      {/* Honest blockers */}
      {blockers.length > 0 && (
        <div className="mt-4">
          <div className="type-mono-sm uppercase tracking-widest text-slate-500">Blockers</div>
          <ul className="mt-1.5 space-y-1 type-body-sm text-slate-400">
            {blockers.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="select-none text-orange-400/70">▸</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
          {/* Truncation is DISCLOSED. Six of eleven blockers under a heading that says "Blockers" reads
              as the whole list, which is the one thing an honest scorecard must not do. */}
          {hidden > 0 && (
            <p className="mt-1.5 type-caption text-slate-600">
              +{hidden} more — see the <a href={`/api/report/passport?repo=${encodeURIComponent(repo)}&download`} className="focus-ring text-slate-400 underline decoration-dotted hover:text-white">full passport</a>.
            </p>
          )}
        </div>
      )}

      {/* Gaps the owner has ACCEPTED. Retired from `blockers` above by the overlay, so without this
          list an accepted gap is invisible — indistinguishable from a gap that isn't there. */}
      <PassportCardDeclined declined={pp.declined} />

      {(pp.identity.criticality || pp.identity.lifecycle) && (
        <p className="mt-3 type-mono-sm text-slate-500">
          {pp.identity.criticality && <>criticality: <span className="text-slate-300">{pp.identity.criticality}</span></>}
          {pp.identity.criticality && pp.identity.lifecycle ? " · " : ""}
          {pp.identity.lifecycle && <>lifecycle: <span className="text-slate-300">{pp.identity.lifecycle}</span></>}
        </p>
      )}

      <p className="mt-3 type-caption text-slate-600">
        {pp.evidence.source} · confidence {Math.round(pp.evidence.confidence * 100)}% · as of {pp.generatedAt}
      </p>

      {canEdit && (
        <>
          <PassportOwnerControls
            repo={repo}
            criticality={pp.identity.criticality}
            lifecycle={pp.identity.lifecycle}
            rollback={pp.productionReadiness.delivery.rollback}
          />
          <PassportDeclineControl repo={repo} passport={pp} />
        </>
      )}
    </Card>
  );
}

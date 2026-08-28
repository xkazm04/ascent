"use client";

// "Audit-ready by default": the governance rollup as a compliance sheet, with the audit trail
// underneath it.
//
// The visual argument is that the two halves are the same artifact at two time scales — the top is the
// fleet's CURRENT state per control, the bottom is the append-only record of how it got there. A
// security review asks for both, and the point of the picture is that neither had to be assembled.

import { motion } from "framer-motion";
import { usePrefersReducedMotion } from "@/components/report/chartMotion";

interface Control {
  name: string;
  /** Repos meeting this control, out of the fleet. */
  pass: number;
}
const FLEET = 40;

// Each control is a field the branch-governance read actually returns (src/lib/github/governance.ts:
// `protected`, `requiresPullRequest` + `requiredApprovals`, `requiresStatusChecks`, `ruleCount`), and
// the last row is a repo's VERDICT against the org gate, not a per-repo setting. The row before this
// edit read "Merge gate policy applied", which described a policy that does not exist per repo:
// src/lib/org/governance.ts:2 — "Applies ONE org policy uniformly to every scanned repo". What varies
// across the fleet is who passes it, which is what the sheet is for.
const CONTROLS: Control[] = [
  { name: "Protected default branch", pass: 37 },
  { name: "Pull request required, with approvals", pass: 33 },
  { name: "Required status checks", pass: 28 },
  { name: "Passing the org gate policy", pass: 31 },
];

// Actions as the trail really records them — every string below is a live `recordAudit` /
// `recordOrgAudit` call site, not a plausible-looking invention:
//   org.gate_policy   src/app/api/org/gate-policy/route.ts:224
//   scan.created      src/lib/db/scans-persist.ts:671
//   practice.pr_opened src/lib/practices/apply.ts:89
//   org.member.role   src/app/api/org/members/route.ts:69
// The previous four ("gate.policy.update", "scan.complete", "practice.apply-batch",
// "member.role.change") were none of them: a reader who opened the real Audit tab expecting these
// strings would find four different ones, which is a worse first impression than showing no trail.
// Dated relatively so the sample never goes stale, and deliberately dull — an audit trail that reads
// exciting is a bad one.
const TRAIL: Array<{ actor: string; action: string; target: string; when: string }> = [
  { actor: "d.okafor", action: "org.gate_policy", target: "org-wide · set", when: "2h" },
  { actor: "system", action: "scan.created", target: "payments-web", when: "5h" },
  { actor: "m.iqbal", action: "practice.pr_opened", target: "checkout-api", when: "1d" },
  { actor: "a.lindqvist", action: "org.member.role", target: "j.tran → admin", when: "2d" },
];

export function GovernanceEvidence() {
  const reduced = usePrefersReducedMotion();
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Fleet controls</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-600">{FLEET} repos</span>
      </div>

      <ul className="mt-3 space-y-3">
        {CONTROLS.map((c, i) => {
          const pct = Math.round((c.pass / FLEET) * 100);
          // The bar is the evidence, so the colour has to be honest: a control most of the fleet
          // fails must not read the same green as one it passes. Three plain bands, no gradient.
          const tone = pct >= 90 ? "bg-tone-rising" : pct >= 70 ? "bg-accent" : "bg-warn";
          return (
            <li key={c.name}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm text-slate-300">{c.name}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-slate-400">
                  {c.pass}/{FLEET}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-divider">
                <motion.span
                  className={`block h-full rounded-full ${tone}`}
                  style={reduced ? { width: `${pct}%` } : undefined}
                  initial={reduced ? false : { width: 0 }}
                  whileInView={reduced ? undefined : { width: `${pct}%` }}
                  viewport={{ once: false, margin: "-12%" }}
                  transition={reduced ? { duration: 0 } : { duration: 0.55, delay: 0.1 + i * 0.08, ease: "easeOut" }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {/* The gate policy is ONE org-wide setting, and the sheet has to say so — otherwise the last
          bar above reads as 31 repos having configured something individually. */}
      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        One gate policy, set once for the org, applied uniformly to every scanned repository. The bar is
        how many clear it.
      </p>

      <div className="mt-5 border-t border-divider pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Audit trail</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-600">append-only</span>
        </div>
        <ul className="mt-2 divide-y divide-divider/70">
          {TRAIL.map((t) => (
            <li key={`${t.actor}-${t.action}`} className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 py-2">
              <span className="font-mono text-[11px] text-slate-500">{t.actor}</span>
              <span className="truncate font-mono text-[11px] text-slate-300">
                {t.action} <span className="text-slate-600">· {t.target}</span>
              </span>
              <span className="font-mono text-[11px] tabular-nums text-slate-600">{t.when}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

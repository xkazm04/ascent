// How an arms run PRINTS. Split from the driver so the transport logic and the presentation of the
// numbers can be read separately, and because the honesty rules below are the whole point of this
// file rather than incidental formatting.
//
// THE RULES THIS FILE ENFORCES, mirroring the ledger view they duplicate in text:
//   • a conditioned figure never prints without the population it was conditioned on;
//   • both reliability figures print, because any-of-N and all-of-N answer opposite questions and
//     the second is the one that matters when deciding to run something unattended;
//   • a null observation reads "unmeasured", never "cleared" and never 0;
//   • void, parked and timed-out lanes print as outcomes, because a dropped void lane flatters the
//     arm that produced it.

const pad = (s, n) => String(s).padEnd(n);
const usd = (micros) => (micros == null ? "—" : `$${(micros / 1e8).toFixed(4)}`);
const num = (n, digits = 1) => (n == null ? "—" : Number(n).toFixed(digits));
const pct = (n) => (n == null ? "—" : `${(n * 100).toFixed(0)}%`);

/** The preflight, per arm and per half. A PASS that checked nothing is not a pass worth printing
 *  silently, so the hosted half's "no endpoint applied" finding is shown too. */
export function formatProbe(reply) {
  const lines = [];
  for (const arm of reply.arms ?? []) {
    lines.push(`  ${arm.ok ? "ok  " : "BLOCK"} ${pad(arm.label ?? arm.armId, 40)}`);
    for (const h of arm.halves ?? []) {
      const probe = (reply.probes ?? [])[h.probe];
      // `endpoint` is the resolved base URL or null — a hosted half has no endpoint at all, which is
      // a fact worth printing rather than a blank.
      const where = h.endpoint ? `→ ${h.endpoint}` : `→ ${h.transport} seat (no local endpoint)`;
      lines.push(`        ${pad(h.role, 8)} ${pad(`${h.transport}:${h.model}`, 30)} ${where}`);
      for (const f of probe?.findings ?? []) {
        if (f.ok) continue;
        lines.push(`          FAIL ${pad(f.check, 15)} ${f.observed ?? "—"}  (needs ${f.required ?? "—"})`);
        if (f.remedy) lines.push(`               ${f.remedy}`);
      }
    }
  }
  if (reply.refusal) lines.push(`\n  refusal: ${reply.refusal}`);
  return lines.join("\n");
}

/** Per-lane: which arm ran it, what it cost on each side, and what it produced. */
export function formatLanes(detail) {
  const lines = ["\nlanes:"];
  const economics = new Map((detail.economics ?? []).map((e) => [e.laneId, e]));
  for (const o of detail.outcomes ?? []) {
    const lane = o.lane ?? o;
    const e = economics.get(lane.id);
    const score = o.before && o.after ? `${o.before.overallScore} → ${o.after.overallScore}` : "not measured";
    const arm = lane.armId ? `[${lane.armId}]` : "[—]";
    const planned = lane.planModel ? ` plan ${lane.planModel}` : "";
    lines.push(
      `  ${pad(arm, 28)} ${pad(lane.repoFullName, 22)} ${pad(lane.phase, 10)} ${pad(score, 16)}` +
        ` ${lane.commits ?? 0} commits  ${usd(lane.costMicros)}  ${lane.transport ?? "—"}:${lane.model ?? "—"}${planned}`,
    );
    if (lane.voidReason) lines.push(`      VOID — ${lane.voidReason}`);
    // Tokens are printed as two halves, because the optimized metric counts only the Claude side and
    // a pooled number cannot answer the question the run was armed to answer.
    const pin = lane.planInputTokens;
    const pout = lane.planOutputTokens;
    if (pin != null || pout != null) lines.push(`      plan tokens   in ${pin ?? "—"} out ${pout ?? "—"}`);
    if (lane.inputTokens != null || lane.outputTokens != null) {
      lines.push(`      exec tokens   in ${lane.inputTokens ?? "—"} out ${lane.outputTokens ?? "—"}  turns ${lane.turns ?? "—"}`);
    }
    if (e) lines.push(`      ${e.verifiedPoints} verified point(s)  ${e.microsPerVerifiedPoint == null ? "—" : usd(e.microsPerVerifiedPoint) + "/point"}`);
  }
  return lines.join("\n");
}

/** The comparison, with its metric contract attached. */
export function formatComparison(report) {
  if (!report) {
    return "\ncomparison: none — a single-arm run, or a compare run whose lanes carry no arm id.";
  }
  const lines = ["\ncomparison"];
  lines.push(`  optimized: ${report.optimized.label} (${report.optimized.direction})`);

  lines.push("\n  constraints (each cleared or not — a gain that breaches one does not advance):");
  for (const v of report.constraints ?? []) {
    const state = v.cleared == null ? "UNMEASURED" : v.cleared ? "cleared" : "BREACHED";
    lines.push(
      `    ${pad(state, 11)} ${pad(v.constraint.label, 34)} observed ${pad(num(v.observed, 3), 8)}` +
        ` ${v.constraint.direction} ${v.constraint.threshold}  [${v.constraint.kind}]`,
    );
  }

  lines.push("\n  arms:");
  for (const a of report.arms ?? []) {
    lines.push(`    ${a.label}${a.belowFloor ? "  [below floor]" : ""}`);
    lines.push(`      optimized      ${a.claudeTokensPerVerifiedPoint == null ? "— (no verified points; not zero)" : num(a.claudeTokensPerVerifiedPoint, 0) + " Claude tokens / point"}`);
    lines.push(`      tokens         claude ${a.claudeTokens}  local ${a.localTokens}   points ${a.verifiedPoints}`);
    // THE SUBSET SIZE IS PART OF THE NUMBER, never a footnote: a conditioned delta over most of the
    // population is a refinement, one over a third of it is a different study, and only the count
    // tells the reader which they are looking at.
    const all = a.costAllCompleted;
    const cond = a.costConditioned;
    lines.push(`      cost (all)     ${usd(all?.value)}  over ${all?.n ?? 0} trial(s) — ${all?.predicate ?? "?"}`);
    lines.push(`      cost (cond.)   ${usd(cond?.value)}  over ${cond?.n ?? 0} trial(s) — ${cond?.predicate ?? "?"}`);
    const r = a.reliability;
    if (r) {
      lines.push(
        `      reliability    per-trial ${pct(r.perTrial?.value)} (n=${r.perTrial?.n ?? r.n})` +
          `   any-of-${r.n} ${pct(r.anyOfN)}   all-of-${r.n} ${pct(r.allOfN)}   ${r.modelled ? "MODELLED from a rate (assumes independence)" : "observed"}`,
      );
    }
    lines.push(`      outcomes       landed ${a.landed}  failed ${a.failed}  void ${a.voided}  parked ${a.parked}  timed-out ${a.timedOut}`);
  }

  lines.push(`\n  advance: ${report.advance ?? "none"}`);
  if (report.note) lines.push(`  note: ${report.note}`);
  return lines.join("\n");
}

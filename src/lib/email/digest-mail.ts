// The weekly digest as MAIL: the body a `mailto:` alert sink receives (backlog develop-2026-09-17 row 16).
//
// The in-app Weekly digest tab is the leadership artefact (`buildWeeklyDigest` -> `WeeklyDigest`); the
// Slack push is a summary of it in Block Kit with a plain-text fallback. A mail sink used to get that
// fallback in a <pre> block: the worst rendering of the best page. This renders the ARTEFACT itself
// (standing with its cohort, coverage, dimension table, follow-ups, ranked actions, movement,
// provenance) plus the blocks only the cron computes (controls with their coverage, standing
// concerns, credits, trajectory), so a leader who reads mail gets the page they would have copied.
//
// PURE (no env, no Date, no I/O): the exact bytes are snapshot-tested. Every interpolated value goes
// through `escapeHtml`, because all of it is customer data (org slug, repository names, titles,
// observations); the output is PRE-ESCAPED HTML for `AlertMailPart.bodyHtml`, which the shared shell
// wraps with the why-you-got-this line and the off switch. Wording follows `digest-markdown.ts`, so
// the mail and the "Copy as markdown" payload print the same word for the same number.

import { ordinal, type AlertMailPart, type FleetDigestInput } from "@/lib/alerts";
import type { DigestMover, WeeklyDigest } from "@/lib/org/digest-types";
import { escapeHtml as e } from "./render";

const sign = (n: number): string => (n > 0 ? `+${n}` : String(n));
const repositories = (n: number): string => `${n} repositor${n === 1 ? "y" : "ies"}`;

const H2 = "margin:22px 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8";
const P = "margin:0 0 8px;font-size:15px;color:#cbd5e1;line-height:1.5";
const MUTED = "margin:0 0 8px;font-size:13px;color:#94a3b8;line-height:1.5";
const LIST = "margin:0 0 8px;padding-left:20px;font-size:14px;color:#cbd5e1;line-height:1.5";
const CELL_BOX = "padding:4px 8px 4px 0;border-bottom:1px solid #334155;font-size:13px";
const CELL = `${CELL_BOX};color:#cbd5e1`;
const HEAD = `${CELL_BOX};color:#94a3b8;font-weight:600`;

/** Callers pass pre-escaped HTML to every helper below; only the leaf builders escape. */
const p = (html: string, style = P) => `<p style="${style}">${html}</p>`;
const section = (title: string, inner: string) => `<h2 style="${H2}">${e(title)}</h2>${inner}`;
const list = (items: string[], tag: "ul" | "ol" = "ul") =>
  `<${tag} style="${LIST}">${items.map((i) => `<li>${i}</li>`).join("")}</${tag}>`;

/** Only an http(s) URL becomes a link: the digest URL is ours, but a scheme check costs nothing. */
const httpUrl = (u: string | null | undefined): string | null => (u && /^https?:\/\//i.test(u) ? u : null);

function standing(d: WeeklyDigest, f: FleetDigestInput): string {
  const h = d.headline;
  const pct = f.percentile != null ? ` · ${e(ordinal(f.percentile))} percentile` : "";
  const out = [
    p(`<strong style="font-size:24px;color:#fff">${h.overall}/100</strong> · ${e(`${h.levelId} ${h.levelName}`)}${pct}`),
  ];
  if (h.dOverall == null || h.cohortSize == null || h.cohortSize <= 0) {
    out.push(p("Not enough history yet for a week-over-week comparison."));
  } else {
    const q = [
      `measured over ${repositories(h.cohortSize)} scanned on both sides of the week`,
      ...(h.onboarded > 0 ? [`${h.onboarded} onboarded`] : []),
      ...(h.departed > 0 ? [`${h.departed} departed`] : []),
    ].join("; ");
    out.push(p(`${e(sign(h.dOverall))} this week (${e(q)})`));
  }
  const axis = (label: string, v: number, dv: number | null) => `${label} ${v} (${dv == null ? "not measured" : sign(dv)})`;
  out.push(p(e(`${axis("AI Adoption", h.adoption, h.dAdoption)} · ${axis("Engineering Rigor", h.rigor, h.dRigor)}`)));
  const coverage = [
    `${h.scanned}/${h.total} repositories scanned`,
    ...(d.provenance.scansInWindow != null ? [`${d.provenance.scansInWindow} scans this week`] : []),
    `generated ${d.generatedOn}`,
  ];
  out.push(p(e(coverage.join(" · ")), MUTED));
  if (d.provenance.engineCaveat) out.push(p(`⚠ ${e(d.provenance.engineCaveat)}`, MUTED));
  if (f.trajectory) out.push(p(`<em>${e(f.trajectory)}</em>`, MUTED));
  return out.join("");
}

/** Controls and standing concerns: undefined omits the block, `[]` is the positive statement. */
function concerns(f: FleetDigestInput): string {
  const out: string[] = [];
  if (f.controlsFailed) {
    const rows = f.controlsFailed.map((c) => e(`${c.repo}: ${c.control}${c.detail ? ` (${c.detail})` : ""}`));
    const cov = f.controlCoverage;
    // The coverage law (control-observations.ts): a state over a period travels with its N.
    const coverage = !cov
      ? ""
      : cov.observations === 0
        ? p("Coverage: no control was observed in this window, so the all-clear above is not evidence.", MUTED)
        : p(
            e(
              `Coverage: ${cov.observations}${cov.truncated ? "+" : ""} observation${cov.observations === 1 ? "" : "s"} across ` +
                `${cov.pairs} repo/control pair${cov.pairs === 1 ? "" : "s"}` +
                (cov.maxGapDays == null ? " (a single observation per pair, no gap measurable)." : `, largest gap ${cov.maxGapDays}d.`),
            ),
            MUTED,
          );
    const title = rows.length ? `Controls that failed this week (${rows.length})` : "Controls";
    out.push(section(title, (rows.length ? list(rows) : p("None failed this week.")) + coverage));
  }
  if (f.standingConcerns) {
    const rows = f.standingConcerns.map(
      (c) => e(`${c.repo}: ${c.observation}`) + (c.evidence?.length ? `<br><span style="color:#94a3b8">${c.evidence.map(e).join("<br>")}</span>` : ""),
    );
    const title = rows.length ? `Standing concerns (${rows.length}): observed, cause not attributed` : "Standing concerns";
    out.push(section(title, rows.length ? list(rows) : p("None open.")));
  }
  return out.join("");
}

function dimensions(d: WeeklyDigest): string {
  if (!d.dims.length) return "";
  const cell = (delta: number | null, band: string, n: number | null) => {
    if (band === "unmeasured" || delta == null || n == null || n <= 0) return "not measured";
    return `${band === "flat" ? "flat (within noise)" : sign(delta)} over ${repositories(n)}`;
  };
  const th = (t: string, align = "left") => `<th style="${HEAD};text-align:${align}">${t}</th>`;
  const rows = d.dims.map(
    (x) =>
      `<tr><td style="${CELL}">${e(`${x.dimId} ${x.label}`)}</td><td style="${CELL};text-align:right">${x.now}</td>` +
      `<td style="${CELL};text-align:right">${e(cell(x.delta, x.band, x.cohortSize))}</td></tr>`,
  );
  const table = `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 8px"><tr>${th("Dimension")}${th("Now", "right")}${th("This week", "right")}</tr>${rows.join("")}</table>`;
  return section("Score deltas per dimension", table);
}

function followups(d: WeeklyDigest): string {
  const f = d.followups;
  if (!f) return "";
  const row = (r: { title: string; repo: string; dimId: string }) => e(`${r.title}, ${r.repo} (${r.dimId})`);
  // The provenance split prints only when the sample is the whole set (digest-markdown.ts closedBreakdown).
  const split =
    f.closed > 0 && f.closedRows.length === f.closed
      ? ` (${f.closedRows.filter((r) => r.how === "scan").length} by rescan, ${f.closedRows.filter((r) => r.how === "human").length} by hand)`
      : "";
  const out = [p(e(`Closed this week: ${f.closed}${split}${f.dismissed > 0 ? ` · Dismissed: ${f.dismissed}` : ""}`))];
  if (f.closedRows.length) out.push(list(f.closedRows.map(row)));
  if (!f.openedMeasurable) {
    out.push(p(e(`Opened this week: not measurable. No repository has a scan from before ${d.window.from} to compare against.`)));
  } else {
    const excluded = f.unmeasuredRepos > 0 ? ` (${repositories(f.unmeasuredRepos)} had no earlier scan and are not counted)` : "";
    out.push(p(e(`Opened this week: ${f.opened}${excluded}`)));
    if (f.openedRows.length) out.push(list(f.openedRows.map(row)));
  }
  return section("Follow-ups", out.join(""));
}

function actions(d: WeeklyDigest): string {
  if (!d.actions.length) return "";
  const items = d.actions.map((a, i) => (i === 0 ? `<strong>Recommended next move:</strong> ${e(a.line)}` : e(a.line)));
  return section("Next actions", list(items, "ol"));
}

function movement(d: WeeklyDigest): string {
  const mv = d.movement;
  if (!mv || !(mv.gainers.length || mv.regressers.length || mv.held?.length || mv.onboarded?.length)) return "";
  const line = (arrow: string, m: DigestMover, tag = "") => {
    const delta = m.dOverall == null ? "" : ` ${sign(m.dOverall)}`;
    const levels = m.levelFrom !== m.levelTo ? ` (${m.levelFrom}→${m.levelTo})` : "";
    return e(`${arrow} ${m.name}${delta}${levels}${tag}`);
  };
  const items = [
    ...mv.gainers.map((m) => line("▲", m)),
    ...mv.regressers.map((m) => line("▼", m)),
    ...(mv.held ?? []).map((m) => line("○", m, " (held)")),
    ...(mv.onboarded ?? []).map((m) => line("+", m, " (onboarded)")),
  ];
  const compared = mv.compared > 0 ? p(e(`${repositories(mv.compared)} compared`), MUTED) : "";
  return section("Repository movement", list(items) + compared);
}

function closing(d: WeeklyDigest, f: FleetDigestInput): string {
  const out: string[] = [];
  if (f.creditsRemaining != null) out.push(p(e(`Credits remaining: ${f.creditsRemaining}, top up to keep autoscans flowing.`)));
  const url = httpUrl(f.url);
  if (url) out.push(p(`<a href="${e(url)}" style="color:#22d3ee">Open the weekly digest in Ascent</a>`));
  const notes = d.provenance.notes.length ? ` ${d.provenance.notes.join(" ")}` : "";
  out.push(
    p(
      e(
        `Window [${d.window.from}, ${d.window.to}] in the org's canonical zone. Fleet averages are over scanned ` +
          `repositories; deltas compare each repository's latest scan with its latest scan before ${d.window.from}.${notes}`,
      ),
      MUTED,
    ),
  );
  return out.join("");
}

/** The weekly digest as the mail part of the digest alert. Pure. */
export function buildDigestMailPart(input: { digest: WeeklyDigest; fleet: FleetDigestInput }): Required<AlertMailPart> {
  const { digest: d, fleet: f } = input;
  return {
    // Plain text: the shell escapes it as the card heading, the transport as a header.
    subject: `Weekly digest: ${d.org} · ${d.window.title}`,
    bodyHtml: [standing(d, f), concerns(f), dimensions(d), followups(d), actions(d), movement(d), closing(d, f)].join(""),
  };
}

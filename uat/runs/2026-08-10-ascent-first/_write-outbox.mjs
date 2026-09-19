// Appends this run's project-level learnings to .personas/memory-outbox.jsonl (lane 1).
// One JSON object per line, matching the existing node contract in that file.
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../../..");
const outbox = path.join(repo, ".personas", "memory-outbox.jsonl");

const nodes = [
  {
    type: "node",
    kind: "finding",
    skill: "uat",
    context: "Credits & Entitlements",
    title: "The /usage low-balance banner is the DEFAULT state of every org, not an edge case",
    body:
      "Second consecutive UAT cycle raising this (recurrence 2). src/app/usage/page.tsx:142 computes " +
      "lowBalance = creditBalance != null && (creditBalance === 0 || (billable > 0 && creditBalance <= billable)) " +
      "— the monthly plan allowance never enters the condition. Because scanCredits is DEFAULT 0, a brand-new org " +
      "that has never run a private scan renders 'Out of private-scan credits — the next private scan will be " +
      "refused (402)' (usageDashboard.tsx:50) directly above AllotmentPanel.tsx's 'Comfortably within your 5/mo " +
      "Free allotment'. Executing every branch also shows the condition is NON-MONOTONIC: (0 credits, 0 scans) " +
      "fires the harshest message while (1 credit, 0 scans) fires nothing, so topping up one credit silences the " +
      "alarm without changing anything real. Fix is to consult the monthly allowance, not just the credit wallet.",
  },
  {
    type: "node",
    kind: "finding",
    skill: "uat",
    context: "GitHub OAuth & Session",
    title: "The advertised free no-signup public scan returns 401 under the production auth shape",
    body:
      "Verified live by restarting the dev server with ASCENT_AUTH_BYPASS=0 (Supabase vars present, so " +
      "authGateEnabled() is true — the production configuration). POST /api/scan returns " +
      "401 {\"error\":\"Sign in to run a scan.\",\"code\":\"auth_required\"} while every READ-ONLY surface stays " +
      "open anonymously: GET /report/<o>/<r> 200, /api/badge 200, /api/gate 422. README.md:94-98 states, under " +
      "the heading 'Free & public — no signup', that 'Everything here works anonymously' and 'Scan any public " +
      "repo'. The landing hero CTA still reads 'Scan a repository'. Either the wall or the copy has to move; a " +
      "buyer Character bounces here and the surfaces that stay open are the ones that would not have convinced him.",
  },
  {
    type: "node",
    kind: "finding",
    skill: "uat",
    context: "Executive Briefing",
    title: "Board PDF prints a regression under 'Value this period' and four unlabelled repo denominators",
    body:
      "From the live generated PDF (GET /api/org/briefing/pdf?org=vercel, HTTP 200). valueRealizedLine pushes " +
      "pointsMoved sign-blind, so the artifact reads 'Value this period: 1 recommendation completed · fleet -6 " +
      "pts'. The same page states 'Across 6 of 6 repositories scanned', 'Coverage: 6/6', 'Of 2 repositories " +
      "comparable across the period, 0 improved and 0 regressed', 'PERCENTILE vs 1 repos', and 'shared by 3 " +
      "repositories' — a fleet-wide -6 sitting beside a cohort-matched '0 moved'. Each is right in its own scope; " +
      "on one board slide they read as an artifact that cannot count its own fleet. The percentile tile suppresses " +
      "its value (CORPUS_MIN fires, renders an em dash) but the sub-label guards independently on corpusRepos > 0. " +
      "Notably the Copy-for-LLM markdown is clean here — the export the MODEL reads is honest, the one the BOARD " +
      "reads is not.",
  },
  {
    type: "node",
    kind: "insight",
    skill: "uat",
    context: "LLM Provider Abstraction",
    title: "The LLM moves the score ~2 points; its real output is the roadmap and the discrepancies",
    body:
      "Control arm, measured not inferred — the app persists signalScore (detector) beside llmScore and the " +
      "blended score. On a real 193s claude-cli/sonnet scan of vercel/swr the model moved off the detector in 7 of " +
      "9 dimensions but never by more than 6 points, <=3 in five of them, and D6/D9 came back byte-identical. The " +
      "guardband allows +/-25; the model used at most 24% of it. So README.md:34's 'calibrates the signal scores' " +
      "is weakly supported while 'writes the roadmap' is strongly supported: the roadmap cited '0 of 8 Action " +
      "references pinned to a SHA' and '56% of merged PRs carry an approving review', and the discrepancies block " +
      "had the model OVERTURNING the app's own D9 detector (Signed releases 0/10 is a false negative — " +
      "trigger-release.yml sets id-token: write and installs npm >=11.5.1 for OIDC trusted publishing). Protect " +
      "the discrepancies surface; consider repositioning the wait around explanation rather than score precision.",
  },
  {
    type: "node",
    kind: "insight",
    skill: "uat",
    context: "Fleet Rollups & Insights",
    title: "No seeded org can produce a forecast, so all trajectory/ETA findings are untestable at L2",
    body:
      "Both seeders scan an org in a single pass, so every repo gets one scan on one calendar day. " +
      "forecastTrajectory returns null below 2 distinct calendar days, so rollup.forecast is null, so " +
      "briefing.ts:283 nulls forecastHeadline and NO trajectory line renders anywhere — verified across six " +
      "generated board PDFs (vercel|acme x 30d|90d|180d, all HTTP 200, zero 'Trajectory:' lines). Any UAT finding " +
      "about ETA honesty therefore resolves 'uncertain — not reproducible on this host'. To fix, seed >=3 scans of " +
      "one repo across >=2 calendar days, and >=14 days of span to exercise isProjectable — the presentability " +
      "gate /trends uses and the briefing path imports nowhere. Backdating scannedAt on seeded rows is cheapest. " +
      "Now documented in uat/env.md so it is not rediscovered every run.",
  },
  {
    type: "node",
    kind: "insight",
    skill: "uat",
    context: "Scan Persistence & History",
    title: "The 2026-07-16 vanishing-scan bug is genuinely dead on the DB path",
    body:
      "Re-certified live with fresh evidence: a real claude-cli scan of vercel/swr, then 26 minutes and one server " +
      "restart later /report/vercel/swr driven ANONYMOUSLY rendered the full persisted report (L3 Augmented, 47, " +
      "'Scanned 26m ago', engine provenance, confidence 85%, passport, all sections). persistScanReport + " +
      "commit-SHA dedup + peek re-hydrate all work; the comment at src/lib/db/improvement.ts:513 ('scan row may " +
      "never exist') is now stale and misleading — worth deleting. CEILING: verified only DB-ON, and the " +
      "discoverability half is still open — a scan ends on /report?repo=... and the durable permalink is never " +
      "surfaced, so the artifact survives but the user is never handed its address.",
  },
];

fs.appendFileSync(outbox, nodes.map((n) => JSON.stringify(n)).join("\n") + "\n");
console.error(`appended ${nodes.length} nodes to .personas/memory-outbox.jsonl`);

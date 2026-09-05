# L2 preflight — environment preconditions, resolved BEFORE driving

v1.2 rule: *an `l2_priority` scoped to a degraded or alternate code path must declare its
environment precondition; L2 preflights those against the live environment before spending
browser time, and anything it cannot satisfy resolves `uncertain` with the reason — never a
silent pass, and never `refuted`.* This file is that preflight. Verified 2026-08-10 against the
live host.

| Precondition | Live value | Verified by | Consequence for L2 |
|---|---|---|---|
| `LLM_PROVIDER` | `claude-cli` | `.env.local`; live scan returned `engine.provider:"claude-cli"`, `model:"sonnet"` | ✅ Real Claude output. Senior-quality dimension is meaningful. |
| `claude` binary | on PATH (`/c/users/kazda/.local/bin/claude`) | `which claude` | ✅ |
| Scan latency | **193 s** wall-clock for `vercel/swr` via `POST /api/scan` | `_l2-warm-scan-swr.json`, `curl -w` | ✅ measured, not estimated |
| `DATABASE_URL` / PGlite | **ON** (`dbMode:"pglite"`, 227 MB store) | `GET /api/health` | ⚠ A real anonymous visitor may hit a DB-less deploy. Any finding about persistence-on-reload is scoped **DB-ON**. |
| Org fixtures | `/org/vercel` (147 KB), `/org/acme` (227 KB) populated; `/org/ascent`, `/org/demo` empty shells (~42 KB) | HTTP size probe | ✅ Dana binds to `vercel` or `acme` only. |
| `ASCENT_AUTH_BYPASS` | `1` | `.env.local` | ⚠ RBAC/role gating is NOT exercised. Any reachability verdict that depends on a real OAuth role is **deferred/uncertain**. |
| `ASCENT_OPEN_ORG_DASHBOARDS` | `1` | `.env.local` | ⚠ Same as above for org dashboard reads. |
| **`BRIEFING_NARRATIVE`** | **ABSENT** | `grep` on `.env.local` | 🔴 **Surface B (Executive Briefing narrative) is OFF.** `deterministicNarrative` runs instead (`briefing-narrative.ts:43-46,102`). Any `l2_priority` on the briefing *narrative* → **`uncertain — not reproducible on this host`**. The briefing's deterministic parts (trajectory headline, ETA, caveats) ARE testable. |
| **`ANTHROPIC_API_KEY`** | **ABSENT** | `grep` on `.env.local` | 🔴 Second half of the same gate. Also means the briefing narrative could not run even if the flag were set. |
| **`TECH_STACK_PROMPT`** | **ABSENT** → `techStackPromptEnabled() === false` | `src/lib/llm/config.ts:106-109` | 🔴 Grounding denominator for Surface A is **N/11, not N/12** on this host. Source #7 (detected tech stack) never reaches the prompt — **while still being computed and rendered in the report**. Treat any "the model considered our stack" claim as false here. |
| **`PUBLIC_SCAN_QUOTA_DISABLED`** | **`1` — quota gate is OFF** | `.env.local`; `src/lib/public-scan-quota.ts:74-76` | 🔴 **Tomáš's anonymous-scan path is NOT the real one.** A genuine prospect hits the monthly public-scan quota; this host bypasses it. Any "an anonymous buyer can just run a scan" verdict is scoped **quota-disabled** and must be re-driven with the flag cleared, or resolved `uncertain`. |
| `LLM_FALLBACK_PROVIDER` | **ABSENT** | `grep` on `.env.local` | ⚠ **Overlay drift:** `uat/env.md:30` asserts "`LLM_FALLBACK_PROVIDER=mock` is set so a CLI hiccup degrades gracefully". It is not set. `scan-assess.ts:283` therefore resolves `providerByName(undefined)` → null; the run still terminates at the final `MockProvider` (`:355`), so the *outcome* is similar, but the documented safety net does not exist as described. → correct `env.md`. |
| `SUPPLY_CHAIN_PROVIDER` | `mock` | `.env.local` | ⚠ D9 security signals are mocked. Any D9-specific quality verdict is scoped **mocked supply chain**. |
| `GITHUB_TOKEN` | present | `.env.local` | ✅ PR + branch-governance signals unlocked (the live scan returned real `prStats`/`governance`). A tokenless visitor gets less — scope accordingly. |
| Port | **3002** (3000/3001 held by a different app) | `netstat`, identity-asserted via `/api/health` shape | ✅ `BASE_URL=http://localhost:3002` |

## Consequences to carry into the L2 report
1. **Surface B verdicts cannot be earned on this host** — the briefing *narrative* LLM is doubly gated off. Report `uncertain — not reproducible on this host`, per v1.2. Do not mark refuted.
2. **Grounding for Surface A is scored `/11` on this host**, and the gap between "tech stack shown in the report" and "tech stack never sent to the model" is itself testable and worth a finding.
3. **Tomáš's quota path needs a deliberate second arm** — either restart the server with `PUBLIC_SCAN_QUOTA_DISABLED` cleared, or mark his free-scan-reachability verdict `uncertain`.
4. **Control arms** (v1.2): for any claim of the form "the live output used input X", re-run with X removed. The cheapest available here: re-scan a repo whose signals differ, and compare `signalScore` vs `llmScore` per dimension to demonstrate the LLM moved off the deterministic floor rather than echoing it.

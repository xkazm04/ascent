# L2 — empirical (live) run · 2026-06-19 · PARTIAL (infra-blocked)

L2 drives the **real app** to answer the questions L1 deferred — chiefly the dominant theme:
*does the live `claude-cli` LLM produce credible output (real discrepancies, a repo-specific roadmap,
a non-inflated D2, a gate verdict that reads `claude`) where the default mock path shows the floor?*

## Environment + what happened

- **Server reuse (per skill):** the running dev server on **:3001 is configured with `claude-cli`** (confirmed via the scan-stream's early `"provider":"claude-cli"` progress event). A second dedicated L2 server could **not** be started — Next.js 16 enforces **one dev server per project dir** and :3001 holds the lock.
- **`claude-cli` works headlessly:** a direct `claude -p --output-format json --model sonnet` call (the provider's exact invocation, no `ANTHROPIC_API_KEY` → subscription auth) returned valid JSON in **~1.9s**. The engine is healthy.
- **BLOCKER — the shared dev server wedged under load.** The machine was simultaneously running **~25 parallel `claude --dangerously-skip-permissions` sessions** (the operator's other work) + ~60 node processes. A full live scan of a real repo (`vercel/swr`) exceeded the server's **150s `CLAUDE_CLI_TIMEOUT_MS`** and fell back to mock; subsequent scans returned `HTTP 000` and `/api/health` went unresponsive. Only **1** of the 26 `claude` processes was a scan child (killed); the 25 interactive sessions were **left untouched**, and the operator's dev server was **not restarted** (it's theirs to recover).

## What L2 DID establish

### MOCK baseline (captured: `swr-mock.json`) — confirms every L1 prediction about the floor
| Signal | Mock value | L1 finding corroborated |
|---|---|---|
| `engine.provider` | `mock` | — |
| overall / level / posture | 45 · L3 · manual | — |
| **discrepancies** | **0** (`[]`) | **Sam** — MockProvider hard-sets `discrepancies:[]`; the "Flagged for review" self-audit never appears on the default path. |
| **roadmap** | catalog/templated — *"Agent guidance is thin…", "AI isn't in the loop yet…", "AI use is ad hoc…"* | **Sam/Dana** — public roadmap is the catalog template, not repo-specific. |
| D2 | 100 (deterministic signal, maxed) | **Oliver** — D2 = signal verbatim under mock (swr is genuinely well-tested, so 100 is defensible here; the assertion-light case wasn't exercised). |

This is the deterministic floor the demo every Character lands on — exactly what P1 (badge/gate honesty) + P4 (decision-grade output) were built to stop misrepresenting.

### L2 carry-forwards ALREADY confirmed live during P1–P6 implementation (on :3001, pre-wedge)
These were verified by live `curl` while landing each package, so L2 needn't re-confirm them:
- **Badge mock-vs-live honesty** (Sam/Mei/Raj) — `Ascent · demo: ◔ L2 Assisted` etc. rendered live (P1).
- **Privacy disclosure at /connect** (Elena) — "Where your code goes" + active provider rendered live (P2).
- **Pricing legibility + nav** (Tomáš) — `$0`/credit-model + header/footer → `/pricing` live (P2).
- **Gate accepts `require_protection`/`min_security`; policy round-trips** (Raj/Priya) — live gate JSON carried the enriched policy (P3).
- **Decision-grade overview** (Dana) — "The move to make next / Start here · advances N to the next level" rendered live (P4).
- **Contributors opt-in + bus-factor default-visible** (Marcus) — Involvement collapsed, Concentration visible (P5).
- **Discoverability** (Mei/Priya/Nadia) — footer Badge link, "Install the AI-native standard" on /practices (P6).

## STILL UNRESOLVED (the one true L2 question — needs a quieter run)

The **live `claude-cli` scan-quality comparison** — on a real repo, does the live LLM:
1. populate **real, re-traceable discrepancies** (vs mock `[]`) [Sam];
2. produce a **roadmap that names a file/config**, not the catalog template [Sam/Oliver/Dana];
3. yield a **D2 the LLM/guardband can pull down** on an assertion-light suite [Oliver];
4. stamp a **gate verdict whose provider line reads `claude`** and that agrees with mock on pass/fail [Raj];
5. produce **scores that reconcile** with a senior's own read [Tomáš/Sam/Mei].

**Not answered** — blocked by the wedged shared server on a heavily-loaded machine. The engine is proven healthy (direct claude-cli test), so this is purely an environment/throughput constraint, not a product defect.

### Recommendation to unblock
Run the live scan in a **quieter environment**: a dedicated `next dev` (claude-cli) with **no other Claude Code sessions competing**, a **small repo** (e.g. `sindresorhus/p-map`) so the prompt finishes well under the 150s CLI timeout (or raise `CLAUDE_CLI_TIMEOUT_MS`), and scans run **one at a time**. Then capture `report.json` and diff discrepancies/roadmap/D2/gate-provider against `swr-mock.json` here.

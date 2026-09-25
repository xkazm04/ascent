---
vault: ["C:/Users/kazda/kiro/ascent/.contest"]
vault_subdir: Contest
arena: .contest/arena
participants: "claude:opus@xhigh,claude:opus@max"
judges: ""
variants: 3
timeout_min: 120
---

# Contest overlay - Ascent

## Engines

`claude` resolves from PATH (`C:/Users/kazda/.local/bin/claude.exe`, a real binary, not an npm
shim). No `CONTEST_*_BIN` override is needed.

## Data

Material for a Live-tab brief comes from the running self-hosted dev server (`npm run dev`,
embedded PGlite), not from a hand-written fixture:

- round history: `GET /api/org/loop?org=<slug>&limit=50&beforeSeq=<n>` (paged), then
  `GET /api/org/loop/<id>?org=<slug>` per run; plans, directions and lessons from
  `/api/org/loop/{plans,directions,lessons}`; drives from `/api/org/local/drive`. The run detail's
  `outcomes[].before/after` scans make it ~8 MB - slim it (drop the two scans, keep `diff`).
- the live signal: sample `fixturePulseAt(DEMO_EPOCH + s * 1000, scenario)` from
  `src/features/inflight/live/theater/theaterFixture.ts` through jiti with
  `JITI_ALIAS='{"@/":"<repo>/src/"}'` - the product's own deterministic theater clock. The argument
  is ABSOLUTE epoch ms: passing `s * 1000` clamps the script to its first second and every frame is
  the same pulse with a new `at` (shipped that way on 2026-09-25; assert the frames differ).
- the wire contract: copy `src/lib/local/runner-types.ts` and `src/lib/local/arm.ts` verbatim.
- current state: headless screenshots of `/theater/<slug>?demo=running`, and `?tab=live&view=`
  `ledger|cockpit|wall`.

## Taste

The owner judges this repo's surfaces by these, in order:

- **Honesty over drama.** No invented progress, ETA or success rate; a claim is not a verified
  result; unknown is shown as unknown; a stale feed looks stale. (docs/features/org-planning/live.md)
- **Practical before spectacular.** The owner overruled a unanimous panel twice for the variant they
  would actually open tomorrow. Levels, not one layer; heavy content gets its own surface; body text
  is comfortable to read.
- **No LLM judging on UI contests here.** The owner reviews the blinded variants themselves; the host
  supplies measurements (load, errors, font floors, wall time, cost), never scores.

## Skill improvement log

- 2026-09-25 (1.4.1, live-fleet-rounds): Claude Code's low-memory reaper killed the backgrounded
  `run` at 26 min with ~14 interactive sessions open, and later the measurement pass. The seats died
  with the runner (no record, no NOTES). Close idle sessions before a run, or have the owner run the
  step in their own terminal.
- 2026-09-25 (1.4.1, live-fleet-rounds): collect redacted `opus`/`claude`/`sonnet` where they were
  the MATERIAL's arm keys (`a.key === "opus"`, a fixture arm `transport: "claude"`), turning
  `var opus = ...` into `var [redacted] = ...` - valid JS that silently drops a footnote. With two
  seats of one model the word identifies nobody; the host restored the four files from `entries/`.

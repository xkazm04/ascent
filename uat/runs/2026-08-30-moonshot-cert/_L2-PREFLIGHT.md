# L2 preflight — 2026-08-30-moonshot-cert

| Arm / precondition | State on this host | Resolution |
|---|---|---|
| Server identity | :3000 answers Ascent's health shape (`dbMode: "pglite"`, `autoscan{…}`) — verified, not assumed | drive against :3000 (shared dev server; reuse, never restart) |
| `LLM_PROVIDER` | `claude-cli` (subscription-billed, real model output) | senior-quality dimension is meaningful; budget 30s–5min per scan |
| `ASCENT_SELF_HOSTED` / `ASCENT_AUTOPILOT` | both `1` | loop-to-l5 L2 arm SATISFIED on the shared instance |
| `ASCENT_AUTH_BYPASS` | `1` on the shared server | Tomáš's anonymous journey is INVALID there (identity chrome) → construct the arm: `npx next dev -p <free port>` with `ASCENT_AUTH_BYPASS=` unset, assert no signed-in chrome before trusting any evidence |
| GitHub App | `autoscan.githubApp: false` | #35 secrets provisioning + pr-batch live flow **not reproducible on this host** — needs an installed App with `secrets: write`; L1-only verdicts there resolve `uncertain — not reproducible`, fixture named |
| Seeded org + usage lanes | to verify before driving: org rows, ≥1 scan history, UsageEvent rows across ≥2 lanes, control observations | seed via scripts/seed-scans.mjs + seed-org.mjs if empty; lane spend may need one live Athena turn / memory check to mint real UsageEvents; treat any pre-existing singleton rows as suspect provenance (residue rule) |
| MCP work tools | need an org API token with `followups:write` | mint via the tokens panel or db helper during L2; record what we create (residue rule) |

# Ascent — Product Backlog

Prioritization: **MoSCoW** (Must / Should / Could / Won't-yet). Estimates in
**points** (1 ≈ a few hours, 3 ≈ a day, 5 ≈ multiple days). Phase 1 = hackathon MVP
(no DB). Phase 2 = DB + enterprise.

## Epic A — Foundation & Scaffolding `[Phase 1]`
| ID | Story | MoSCoW | Pts | Status |
|---|---|---|---|---|
| A1 | Scaffold Next.js 16 + TS + Tailwind v4 app | Must | 1 | ✅ done |
| A2 | Project docs: PRD, maturity model, architecture, backlog, plan | Must | 3 | ✅ done |
| A3 | `blog.md` journey log aligned to bonus-point rules | Should | 1 | ✅ done |
| A4 | Shared types + maturity model config (levels, dims, weights) | Must | 2 | 🔜 |
| A5 | `.env.example`, README, lint/build green | Must | 1 | 🔜 |

## Epic B — Repo Ingestion `[Phase 1]`
| ID | Story | MoSCoW | Pts | Status |
|---|---|---|---|---|
| B1 | Parse/validate GitHub URL → {owner, repo} | Must | 1 | 🔜 |
| B2 | `RepoSource` interface | Must | 1 | 🔜 |
| B3 | `GitHubPublicSource`: repo metadata + recursive git tree | Must | 2 | 🔜 |
| B4 | Budgeted file-content fetch (README, configs, CI, sampled src/tests) | Must | 3 | 🔜 |
| B5 | Recent commit messages (for AI-attribution signals) | Should | 1 | 🔜 |
| B6 | Optional GitHub token + rate-limit handling + clear errors | Must | 2 | 🔜 |
| B7 | Cache by `owner/repo@headSha` | Should | 1 | 🔜 |

## Epic C — Scoring Engine `[Phase 1]`
| ID | Story | MoSCoW | Pts | Status |
|---|---|---|---|---|
| C1 | Deterministic detectors D1–D7 → signals + `signalScore` | Must | 5 | 🔜 |
| C2 | `LLMProvider` interface + structured-JSON contract | Must | 1 | 🔜 |
| C3 | `GeminiProvider` (`gemini-3-flash-preview`, responseSchema) | Must | 3 | 🔜 |
| C4 | `MockProvider` (deterministic, keyless) | Must | 2 | 🔜 |
| C5 | Blend + guardband + weighted rollup + level banding | Must | 2 | 🔜 |
| C6 | Roadmap generation (prioritized, impact/effort, level-unlock) | Must | 2 | 🔜 |
| C7 | Confidence from inspection coverage | Should | 1 | 🔜 |

## Epic D — Scan API `[Phase 1]`
| ID | Story | MoSCoW | Pts | Status |
|---|---|---|---|---|
| D1 | `POST /api/scan` orchestration + validation + errors | Must | 3 | 🔜 |
| D2 | In-memory cache + `?mock=1` override | Should | 1 | 🔜 |
| D3 | Streaming/progress (SSE) for long scans | Could | 3 | ⏳ later |

## Epic E — Web UI `[Phase 1]`
| ID | Story | MoSCoW | Pts | Status |
|---|---|---|---|---|
| E1 | Landing: hero, the 5 levels, how-it-works, pricing tiers | Must | 3 | 🔜 |
| E2 | Scan form + loading/skeleton states + error UX | Must | 2 | 🔜 |
| E3 | Report: overall score gauge + level | Must | 2 | 🔜 |
| E4 | Dimension radar chart (dependency-free SVG) | Must | 3 | 🔜 |
| E5 | Per-dimension cards: score, summary, evidence, strengths/gaps | Must | 3 | 🔜 |
| E6 | Prioritized roadmap section | Must | 2 | 🔜 |
| E7 | Shareable SVG badge endpoint + copy-markdown snippet | Should | 2 | 🔜 |
| E8 | Example repos / "try one" quick links | Should | 1 | 🔜 |
| E9 | PDF / share export | Could | 2 | ⏳ later |

## Epic F — Persistence & History `[Phase 2]`
| ID | Story | MoSCoW | Pts | Status |
|---|---|---|---|---|
| F1a | DSQL-safe Prisma schema + migrations (local Postgres) | Must | 3 | ✅ done |
| F1b | Provision real Aurora DSQL cluster + IAM-token auth | Must | 2 | 🔜 |
| F2 | Persist scans/dimensions/evidence/recommendations | Must | 3 | ✅ done |
| F3a | Scan history API (`/api/history`) | Must | 2 | ✅ done |
| F3b | Progress trend charts + score/dimension deltas in report UI | Must | 2 | ✅ done |
| F4 | Recommendation tracking (open→done) + API + UI | Should | 3 | ✅ done |
| F5 | Vercel Cron scheduled re-scans | Could | 2 | ⏳ later |

## Epic G — Enterprise & Privacy `[Phase 2]`
| ID | Story | MoSCoW | Pts |
|---|---|---|---|
| G1 | Auth + org/tenant model + RBAC | Must | 5 |
| G2 | GitHub App (private/org repos) | Must | 5 |
| G3 | `BedrockProvider` (privacy-preserving inference) | Must | 3 |
| G4 | Audit log (every sensitive action) | Must | 2 |
| G5 | Org rollup dashboard + multi-repo scoring | Should | 3 |
| G6 | Anonymized peer benchmarking percentiles | Could | 3 |
| G7 | SSO/SAML, data-residency/VPC options | Could | 5 |

## Epic H — Monetization `[Phase 2]`
| ID | Story | MoSCoW | Pts |
|---|---|---|---|
| H1 | Stripe plans + checkout + entitlements | Must | 5 |
| H2 | Usage limits / rate limiting per tier | Must | 2 |
| H3 | Billing portal | Should | 2 |

## Epic I — Quality & Calibration `[ongoing]`
| ID | Story | MoSCoW | Pts |
|---|---|---|---|
| I1 | Labeled benchmark set (~30 repos, L1–L5) | Should | 3 |
| I2 | Tune weights/BLEND to ≥80% human agreement | Should | 3 |
| I3 | Unit tests for detectors + scoring rollup | Should | 3 |
| I4 | Eval harness for prompt/scoring regressions | Could | 3 |

## MVP "Definition of Done" (hackathon-submittable)
- Paste a public GitHub URL → full evidence-backed report with level, radar, and
  roadmap, in < ~60s.
- Works **with** a Gemini key (live) and **without** one (mock mode).
- Deployed on Vercel; lint + build green.
- Architecture diagram + docs explain the Aurora DSQL/Bedrock path for Phase 2.

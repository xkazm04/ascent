# Ascent — Hackathon Submission Checklist

**Event:** AWS Databases × Vercel hackathon (1 month). **$80k cash + $80k AWS credits.**
**Our track:** **Track 2 — Monetizable B2B** (with a B2C free tier as the funnel).

## Required deliverables

| Requirement | Plan / status |
|---|---|
| Full-stack app using one of Aurora PostgreSQL / **Aurora DSQL** / DynamoDB | **Aurora DSQL** (Phase 2 persistence: scans, history, audit, multi-tenant). MVP is DB-free by design; DSQL is wired in Week 2. |
| Front end on Vercel or v0.app | **Vercel** (Next.js 16, Turbopack, preview deploys). |
| Text description naming the AWS database used | Drafted — names **Aurora DSQL** and why (serverless, multi-region, Postgres-compatible for audit/history). |
| **Under-3-min** demo video (problem, who, why, working app, AWS DB used) | Script in [../blog.md](../blog.md) §Demo; record in Week 4. **Official rules require < 3:00 — trim the script to that (not the older "3–5 min" note).** |
| Published Vercel project link + Vercel Team ID | Captured at deploy (Week 1 for MVP URL; final in Week 4). |
| Architecture diagram (app ↔ back-end) | In [ARCHITECTURE.md](./ARCHITECTURE.md) (Mermaid: MVP + Phase 2). Export a clean image for submission. |
| Screenshot: Storage Configuration proving AWS DB usage | Capture from the AWS console once DSQL is connected. The app now also surfaces the live backend on-screen — `GET /api/health` returns `dbMode` and the landing register shows "Served live from Aurora DSQL" — as a second, in-product proof. |

## Demo affordances built (June 2026)

Five hardening directions are implemented, verified (tsc clean · 2636 vitest · `next build` green) and
checked live; all auto-activate against Aurora DSQL with **no code change** (just env).

1. **Aurora DSQL surfaced on-screen** — the landing register shows "Served live from {Aurora DSQL} ·
   as of {freshness}" and `GET /api/health` reports `dbMode` (`dsql` once `DSQL_ENDPOINT` is set;
   `pglite`/`postgres` in dev). The AWS database is now visible in the product + a quick proof signal.
   (`src/lib/db/mode.ts`)
2. **Fleet-scale demo data** — `POST /api/dev/seed-fleet` (`npm run db:seed:fleet`) generates a large org
   of repos with back-dated scan histories + a curated public set, so Overview/Trajectory/Repositories/
   Live War Room and the landing register render at scale. Runs in-process (PGlite locally, DSQL in
   prod); secret-gated for prod via `ASCENT_SEED_SECRET`. (`src/lib/dev/fleet-seed.ts`)
3. **Monetization loop, demoable end-to-end** — org-dashboard Plan switcher (Free→Pro→Team→Enterprise,
   gated by `ASCENT_ALLOW_PLAN_CHANGES`) + "Simulate a purchase" credit grants, so
   upgrade → credits → unlock → `/usage` is shown without Polar. Polar sandbox env still wires the real
   checkout. (`src/components/org/PlanControl.tsx`)
4. **Frictionless first 30 seconds** — a one-click "See a sample report" on the hero → an instant,
   server-rendered seeded report (`/report/vercel/next.js`).
5. **AWS depth + growth loop** — an "inference · AWS Bedrock" provenance chip on reports scored via
   Bedrock (`LLM_PROVIDER=bedrock`), and a "Scan your repo / Add a README badge" CTA on the register
   that feeds the badge growth loop.

**Local demo:** `npm run dev` → `npm run db:seed:fleet` → open `/`, `/org/acme`,
`/report/vercel/next.js`. (Add `ASCENT_ALLOW_PLAN_CHANGES=1` to make the Plan switcher live.)

**Still external-credential-gated — the real submission blockers:**
- **Aurora DSQL** free-tier cluster + IAM keys (`dsql:DbConnectAdmin`) + `npm i @aws-sdk/dsql-signer`
  → flips the indicator to "Aurora DSQL" and unlocks the AWS-console screenshot.
- **Vercel Pro** deploy → published URL + Team ID.
- *(Optional)* Polar sandbox (real checkout); Bedrock model access (live inference + the provenance chip).

## Bonus points (published content)
- [ ] Publish a blog/video on building Ascent with **Aurora DSQL + Vercel**
      (builder.aws.com / dev.to / Medium / LinkedIn / YouTube).
- [ ] Include the required language: *"I created this content for the purposes of
      entering the AWS Databases × Vercel hackathon."*
- [ ] Use **#H0Hackathon** when sharing on social.
- [ ] `blog.md` (repo root) is the source draft for this content — it documents the
      full journey and is pre-aligned to these rules.

## Why this submission is strong
- **"Shippable, not a demo":** the MVP genuinely works (live + mock mode); Phase 2 runs
  on production-grade Aurora DSQL.
- **Clear AWS-DB justification:** an audit/history/multi-tenant B2B product is a textbook
  relational fit — and Aurora DSQL adds serverless + multi-region scale, matching the
  hackathon's "ship fast, scale to enterprise" thesis.
- **Bedrock angle:** demonstrates the AWS stack beyond the DB — privacy-preserving
  enterprise inference (the AWS analog to Azure OpenAI).
- **Monetization is built in:** Free → Pro → Team → Enterprise tiers with a viral badge
  growth loop.

## Submission-day runbook
1. Final deploy to Vercel; record URL + Team ID.
2. Connect/confirm Aurora DSQL; screenshot storage configuration.
3. Export architecture diagram to image.
4. Record + upload demo video (YouTube).
5. Publish bonus content with required language + #H0Hackathon.
6. Submit text description (name **Aurora DSQL**), links, diagram, screenshots.

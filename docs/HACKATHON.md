# Ascent — Hackathon Submission Checklist

**Event:** AWS Databases × Vercel hackathon (1 month). **$80k cash + $80k AWS credits.**
**Our track:** **Track 2 — Monetizable B2B** (with a B2C free tier as the funnel).

## Required deliverables

| Requirement | Plan / status |
|---|---|
| Full-stack app using one of Aurora PostgreSQL / **Aurora DSQL** / DynamoDB | **Aurora DSQL** (Phase 2 persistence: scans, history, audit, multi-tenant). MVP is DB-free by design; DSQL is wired in Week 2. |
| Front end on Vercel or v0.app | **Vercel** (Next.js 16, Turbopack, preview deploys). |
| Text description naming the AWS database used | Drafted — names **Aurora DSQL** and why (serverless, multi-region, Postgres-compatible for audit/history). |
| 3–5 min demo video (problem, who, why, working app, AWS DB used) | Script in [../blog.md](../blog.md) §Demo; record in Week 4. |
| Published Vercel project link + Vercel Team ID | Captured at deploy (Week 1 for MVP URL; final in Week 4). |
| Architecture diagram (app ↔ back-end) | In [ARCHITECTURE.md](./ARCHITECTURE.md) (Mermaid: MVP + Phase 2). Export a clean image for submission. |
| Screenshot: Storage Configuration proving AWS DB usage | Capture from Vercel/AWS console once DSQL is connected (Week 2+). |

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

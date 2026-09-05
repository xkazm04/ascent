# Roadmap

A status snapshot, not a backlog: the evidence-backed work items live in
[`BACKLOG.md`](./BACKLOG.md) and the direction of the product in
[`VISION-TRANSITION.md`](./VISION-TRANSITION.md).

## Shipped

**Phase 2:** DSQL-safe persistence · history + dimension trends · org intelligence
(rollups, forecast, gap analysis, contributors, delivery, practices, planning, audit) ·
GitHub App (private repos, PR auto-gate, push re-scans) · usage metering · regression
alerts · Bedrock enterprise inference · optional GitHub OAuth.

**Since:** enforced **org roles (RBAC)**, **Polar billing** + prepaid scan credits on the usage
meter, **PDF report export**, the read-only **MCP door** for coding agents
([`features/org-knowledge/skills.md`](./features/org-knowledge/skills.md)), and **local mode**
on self-hosted deployments: repo↔folder pairing, scan-from-disk, and the autopilot improvement loop
([`features/local-mode/README.md`](./features/local-mode/README.md)).

## Next

- A live **Aurora DSQL** cluster (IAM-token auth) for the hosted deployment.
- The T1/T2 tracks in [`GOLDEN-TRIO.md`](./GOLDEN-TRIO.md): evidence ledger, `.ai` standard +
  fleet remediation.

### Next steps toward Athena

Ascent's resident companion is **Athena** ([`features/companion/README.md`](./features/companion/README.md));
the founding plan lives in the AI registry
(`ai-registry/docs/plans/athena-inject-ascent-2026-08-24.md`) and much of its phase sequence is
already in build (schema, turn runner, drawer surface, action catalog, autonomous cycle). What
remains from that plan, deliberately not started yet:

- **The shared-brain seam in fact, not just in name**: export/import of the document-shaped
  identity so an operator's kp/desktop Athena and an org's Ascent Athena can exchange what consent
  allows (today they share vocabulary and format, zero storage).
- **P5 retro**: lessons back to the registry's `skills/spark/LESSONS.md` + companion-doctrine
  deepen candidates, and updating the registry plan's "verify at execution" notes with what drifted.

## History

Hackathon-era plan: [`archive/2026-hackathon/PLAN.md`](./archive/2026-hackathon/PLAN.md).
Build journal: [`../blog.md`](../blog.md).

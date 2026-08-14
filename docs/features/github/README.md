# Identity & GitHub Connectivity

Sign-in, the GitHub App installation, webhooks, and the repo data layer every scan
reads from.

Context-map group: **Identity & GitHub Connectivity** (`integration`).

| Doc | Covers | Freshness (audited 2026-07-28) |
| --- | --- | --- |
| [auth.md](auth.md) | Both sign-in stacks: the active Supabase wall and the dormant custom OAuth | CURRENT |
| [github-app.md](github-app.md) | App install, webhooks, connect UI, governance signals | STALE (see gaps) |
| [setup.md](setup.md) | Operator setup guide: creating the App, env vars | STALE (see gaps) |

## Implementation roots

- `src/lib/access.ts`: `getViewer`/`requireViewer`/`resolveViewerLogin` (the live gate)
- `src/lib/supabase/{client,server}.ts`, `src/proxy.ts`, `src/app/auth/callback`: Supabase OAuth
- `src/lib/auth.ts`: legacy custom GitHub OAuth (dormant, kept as fallback)
- `src/lib/github/**`: App JWT + installation tokens, repo source, checks, write, governance
- `src/app/api/app/{setup,repos,webhook}`, `src/app/api/auth/**`, `src/app/connect`

## Known gaps

- **A brand-new production sign-in lands on an empty dashboard.** Four sign-in-moment
  behaviors live only in the dormant custom callback and never run under the active
  Supabase wall: installation linking, revocation-version stamping, org
  auto-discovery + watchlist seeding, and the re-sync round-trip. Detail and the fix
  shape are in [auth.md](auth.md) "Known gaps"; this is a product gap, not a doc gap.
- `github-app.md` omits webhook delivery dedup/replay protection (`WebhookDelivery`),
  the suspend-vs-delete distinction, the `check_run` re-run trigger, and the fact
  that PR/push work is deferred via `after()` so GitHub gets a fast 2xx.
- `setup.md`'s §4 still walks through the **dormant** OAuth stack step by step. Its
  status note now says so and points at the active path, but the section itself
  should be trimmed to a pointer rather than duplicating auth setup.

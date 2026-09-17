# DevInspector: click a component, copy its source path

A dev-only overlay for grabbing a component's `src/.../File.tsx:line` and pasting it
straight into an AI coding CLI (Claude Code, etc.). Off by default; never present in
production builds.

```bash
npm run dev:inspect   # dev server with source-location stamping on
```

In the app, press **`;`** (enters keyboard mode) then **`i`** (Inspect) to arm it. Hover
highlights the element under the cursor and pins a `File.tsx:line` chip; **right-click** copies
the call-site path, **Alt+right-click** copies the innermost element, click a HUD row to copy
any enclosing file, and **Esc** exits. A plain `npm run dev` works too, but the HUD will say
source mapping is OFF until you relaunch with `npm run dev:inspect`.

## How it is wired

A gated Turbopack loader ([`scripts/dev-inspector/`](../../scripts/dev-inspector/)) stamps host JSX
with `data-loc` only when `DEV_INSPECT=1`; the overlay
([`src/app/_dev-inspector/`](../../src/app/_dev-inspector/)) reads it at runtime. Both are absent
from production. The `dev:inspect` script in [`package.json`](../../package.json) is just
`cross-env DEV_INSPECT=1 next dev`.

HUD copy stays two formats: Claude `path:line` (default right-click) and VS Code
`code -g path:line` (HUD-only). Alt+right-click is still "innermost element", not a format switch.

## Dev seed writes

The four `/api/dev/seed-*` routes share [`src/lib/dev/seed-auth.ts`](../../src/lib/dev/seed-auth.ts).
`ASCENT_EMPTY` (empty-tenant mode, `npm run dev:empty`) **refuses** those writes — even with a valid
`ASCENT_SEED_SECRET`, even in production — so a seeder pointed at the throwaway tenant cannot
populate it. Real scans and org import stay open; those are the onboarding path empty-tenant exists
to exercise. The secret-less path is still production-floored: with no `ASCENT_SEED_SECRET` the
routes are allowed only outside production. `ASCENT_EMPTY` itself is not an escape hatch, so it has
no production floor.

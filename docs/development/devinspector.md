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

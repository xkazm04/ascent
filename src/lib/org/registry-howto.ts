// The developer-facing commands + manifest pointer for a registry, as ONE pure function.
//
// Split out of `registry-view.ts` so the FIXTURES (and therefore the client-side preview switcher in
// `src/features/shared/registry/RegistryPreviewShell.tsx`) can import it without dragging
// `registry-view.ts` — and through it the whole `@/lib/db` layer — across the client boundary. That
// is the exact failure mode recorded in the "build not in the gate" note: `tsc` and the unit suite
// stay green while `next build` fails on a server-only import reaching a client component.
//
// No imports beyond a type: safe on the server, in a route, and in a browser bundle.

import type { RegistryView } from "./registry-view";

/**
 * The developer-facing commands + manifest pointer. Same strings on every path, real or fixture.
 *
 * Every string names something that EXISTS: `ascent-skills.mjs` is a single zero-dependency file in
 * ascent's `scripts/` that a repo copies in (there is no npm package and no `npx ascent` bin), and the
 * pointer is the `registry.remote` key the ai-manifest spec actually carries. An earlier version showed
 * `npx ascent skills sync` — a command nobody could run.
 */
export function registryHowTo(registryFullName: string, orgSlug: string): RegistryView["howTo"] {
  return {
    syncCmd: `node scripts/ascent-skills.mjs sync --org ${orgSlug}`,
    hooksCmd: "node scripts/ascent-skills.mjs hooks install",
    pointer: `registry.remote: github:${registryFullName}`,
  };
}

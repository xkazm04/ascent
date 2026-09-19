// The developer-facing commands + manifest pointer for a registry, as ONE pure function.
//
// Split out of `registry-view.ts` so the FIXTURES (and therefore the client-side preview switcher in
// `src/features/shared/registry/RegistryPreviewShell.tsx`) can import it without dragging
// `registry-view.ts` — and through it the whole `@/lib/db` layer — across the client boundary. That
// is the exact failure mode recorded in the "build not in the gate" note: `tsc` and the unit suite
// stay green while `next build` fails on a server-only import reaching a client component.
//
// No imports beyond types that live here: safe on the server, in a route, and in a browser bundle.

export type RegistryHowToCommands = {
  /** Hosted library pull (`GET /api/org/skills/manifest`). Token. Kept for the fleet-pointing stepper. */
  syncCmd: string;
  hooksCmd: string;
  pointer: string;
  /** Sink B: `usage/<contributor>.json` in a registry checkout. No token. */
  reportCmd: string;
  /** Hosted `POST /api/org/skills/push`. Token. */
  hostedPushCmd: string;
  /** Sink A: drain the spool to `POST /api/org/skills/events`. Token. */
  hostedEventsCmd: string;
};

/**
 * The developer-facing commands + manifest pointer. Same strings on every path, real or fixture.
 *
 * Every string names something that EXISTS: `ascent-skills.mjs` is a single zero-dependency file in
 * ascent's `scripts/` that a repo copies in (there is no npm package and no `npx ascent` bin), and the
 * pointer is the `registry.remote` key the ai-manifest spec actually carries. Usage sync is
 * `report --to-registry` (a file write, no account). Hosted `push` / `report` still talk to the API.
 */
export function registryHowTo(registryFullName: string, orgSlug: string): RegistryHowToCommands {
  return {
    syncCmd: `node scripts/ascent-skills.mjs sync --org ${orgSlug}`,
    hooksCmd: "node scripts/ascent-skills.mjs hooks install",
    pointer: `registry.remote: github:${registryFullName}`,
    reportCmd: "node scripts/ascent-skills.mjs report --to-registry --contributor <id>",
    hostedPushCmd: `node scripts/ascent-skills.mjs push --org ${orgSlug}`,
    hostedEventsCmd: `node scripts/ascent-skills.mjs report --org ${orgSlug}`,
  };
}

/** Git-native usage: a file in the registry checkout. Must not name ASCENT_TOKEN. */
export const HOWTO_USAGE_NOTE =
  "ascent-skills.mjs is one zero-dependency file: copy it from ascent's scripts/ into the repo. report --to-registry writes usage/<contributor>.json in a registry checkout: no token. The pointer goes under registry: in each repo's .ai/manifest.yaml.";

/** Token sentence: sink A / MCP (and hosted push, which uses the same askl_ door). Never usage sync. */
export const HOWTO_HOSTED_NOTE =
  "Hosted push, sink A events, and the MCP door read an askl_ token from ASCENT_TOKEN (mint one on the Skills tab).";

export function splitHowToSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Sentences that still tell a reader they need ASCENT_TOKEN to sync usage into the registry.
 * A token sentence is allowed only when it names sink A and MCP and does not name the usage lane.
 */
export function sentencesRequiringTokenForUsageSync(text: string): string[] {
  return splitHowToSentences(text).filter((sentence) => {
    if (!sentence.includes("ASCENT_TOKEN")) return false;
    const namesUsageLane =
      /--to-registry/.test(sentence) ||
      /usage\/<contributor>/.test(sentence) ||
      /\busage\/\S+\.json\b/.test(sentence) ||
      /registry usage/i.test(sentence) ||
      /usage sync/i.test(sentence);
    if (namesUsageLane) return true;
    if (/\bSync reads\b/.test(sentence)) return true;
    const namesSinkA = /\bsink A\b/i.test(sentence);
    const namesMcp = /\bMCP\b/.test(sentence);
    return !(namesSinkA && namesMcp);
  });
}

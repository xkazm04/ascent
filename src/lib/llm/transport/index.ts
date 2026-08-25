// Adapter registry + probe caching for the agent-CLI transport seam. See types.ts for the contract
// and the registry subject it implements (agent-cli-transport).
//
// Routing status: `claude-cli` is consumed through src/lib/llm/claude-cli.ts (the assessment seam,
// gated by cliProviderAllowed). `codex-cli` is READY BUT UNROUTED — it is not an LLM_PROVIDER value
// yet; wiring it into provider selection means touching ProviderName, PROVIDER_LABEL, pricing and
// the failover ladder in one deliberate change, not as a side effect of introducing the seam.

import { claudeCliTransport } from "@/lib/llm/transport/claude";
import { codexCliTransport } from "@/lib/llm/transport/codex";
import type { AgentCliTransport, TransportProbe } from "@/lib/llm/transport/types";

const TRANSPORTS = {
  "claude-cli": claudeCliTransport,
  "codex-cli": codexCliTransport,
} as const;

export type TransportName = keyof typeof TRANSPORTS;

export const TRANSPORT_NAMES = Object.keys(TRANSPORTS) as TransportName[];

export function getTransport(name: TransportName): AgentCliTransport {
  return TRANSPORTS[name];
}

/** A probe answer is true of a MOMENT (a login can expire, a binary can be uninstalled), so cached
 *  results carry a short TTL rather than living for the process. 5 min keeps a scan loop from
 *  re-spawning `--version` + auth-status children per repo without letting staleness linger. */
const PROBE_TTL_MS = 5 * 60_000;

const probeCache = new Map<TransportName, { at: number; result: TransportProbe }>();

/** Probe a transport with TTL caching. `fresh: true` bypasses the cache (e.g. right after the
 *  operator says "I just logged in"). Probes never throw, so failures cache too — retrying a
 *  missing binary every call would re-pay the spawn for a known answer. */
export async function probeTransport(name: TransportName, opts: { fresh?: boolean } = {}): Promise<TransportProbe> {
  const cached = probeCache.get(name);
  if (!opts.fresh && cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.result;
  const result = await getTransport(name).probe();
  probeCache.set(name, { at: Date.now(), result });
  return result;
}

/** Test hook: drop cached probe results (mirrors the restubbable-env convention in config.ts). */
export function clearProbeCache(): void {
  probeCache.clear();
}

export type { AgentCliTransport, TransportProbe } from "@/lib/llm/transport/types";
export type { TransportMode, TransportRunArgs, TransportRunResult, TransportError, TransportCapabilities } from "@/lib/llm/transport/types";

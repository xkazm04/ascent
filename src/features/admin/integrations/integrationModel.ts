// Shared facts for both Integrations compositions. Wire rows only: timestamps are ISO strings.
// Connection is a word (connected / not configured). Fidelity is a mark, never a hue.
import type { CellState } from "@/components/kit";
import type { ForgeInstallationRow } from "@/lib/db/forge-installations";
import type { ProviderConnectionRow } from "@/lib/db/provider-credentials";
import { FIDELITY_META, PROVIDERS, type Fidelity } from "@/lib/integrations/providers";

export interface IngestWire {
  source: string;
  lastReceived: string;
  repos: number;
  costCents: number;
  tokens: number;
  seats: number;
  sessions: number;
  measured: boolean;
}

export interface IntegrationsData {
  slug: string;
  ingestToken: string;
  ingestPath: string;
  statuses: IngestWire[];
  forgeInstallations: ForgeInstallationRow[];
  openai: { connection: ProviderConnectionRow | null; encryptionConfigured: boolean };
  encryptionConfigured: boolean;
}

export const INTEGRATION_LEVELS = [
  { id: "gitlab", name: "GitLab" },
  { id: "claude-code", name: "Claude Code" },
  { id: "copilot", name: "GitHub Copilot" },
  { id: "openai", name: "OpenAI · Codex" },
] as const;

export type IntegrationLevelId = (typeof INTEGRATION_LEVELS)[number]["id"];

export function isIntegrationLevel(raw: string): raw is IntegrationLevelId {
  return INTEGRATION_LEVELS.some((level) => level.id === raw);
}

export type ConnectWord = "connected" | "not configured";

export function emptyIntegrations(slug: string): IntegrationsData {
  return {
    slug,
    ingestToken: "",
    ingestPath: "/api/integrations/ingest",
    statuses: [],
    forgeInstallations: [],
    openai: { connection: null, encryptionConfigured: false },
    encryptionConfigured: false,
  };
}

export function statusFor(data: IntegrationsData, source: string): IngestWire | null {
  return data.statuses.find((status) => status.source === source) ?? null;
}

/** Connected when a credential is stored, or (no stored secret) when data has actually landed. */
export function connectionWord(data: IntegrationsData, id: IntegrationLevelId): ConnectWord {
  if (id === "gitlab") return data.forgeInstallations.some((row) => row.hasCredential) ? "connected" : "not configured";
  if (id === "openai") return data.openai.connection?.hasCredential ? "connected" : "not configured";
  if (id === "copilot") return statusFor(data, "copilot") ? "connected" : "not configured";
  return statusFor(data, "claude-code") ? "connected" : "not configured";
}

export function connectionCell(word: ConnectWord): { state: CellState; word: ConnectWord } {
  return word === "connected" ? { state: "met", word: "connected" } : { state: "unmeasured", word: "not configured" };
}

export function connectionCounts(data: IntegrationsData): { connected: number; notConfigured: number; costSources: number } {
  const connected = INTEGRATION_LEVELS.filter((level) => connectionWord(data, level.id) === "connected").length;
  const costSources = (data.openai.connection?.hasCredential ? 1 : 0) + (statusFor(data, "claude-code") ? 1 : 0);
  return { connected, notConfigured: INTEGRATION_LEVELS.length - connected, costSources };
}

const FIDELITY_STATE: Record<Fidelity, CellState> = {
  measured: "met",
  allocated: "partial",
  // Seats-only never reports cost. That is unknown, not a failed allocated figure.
  "seats-only": "unmeasured",
};

export function fidelityCell(fidelity: Fidelity): { state: CellState; word: string } {
  return { state: FIDELITY_STATE[fidelity], word: FIDELITY_META[fidelity].label };
}

export function levelBlurb(id: IntegrationLevelId): string {
  if (id === "gitlab") return "Scan GitLab projects with the same rubric and the same report.";
  return PROVIDERS.find((provider) => provider.id === id)?.blurb ?? "";
}

export function providerByLevel(id: IntegrationLevelId) {
  return id === "gitlab" ? null : (PROVIDERS.find((provider) => provider.id === id) ?? null);
}

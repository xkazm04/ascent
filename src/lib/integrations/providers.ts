// The provider registry — the shared connector spine. One typed definition per AI coding provider,
// carrying the honest per-repo attribution reality (see memory: ai-usage-connector-feasibility). The
// Integrations page renders these; a later resolver turns each connected provider's usage into the
// AiRepoRoi shape the /delivery views already consume, at the fidelity declared here.
//
// Fidelity tiers (the core of the whole design):
//   measured   — the vendor attributes spend to the exact repo (only Claude Code, via OTel git.repository)
//   allocated  — the vendor reports above repo level; Ascent distributes it by git-attributed AI volume
//   seats-only — the vendor reports seats and engagement but NOT spend (Copilot: GitHub does not
//                expose the negotiated per-seat price through any API, so no cost figure exists to
//                report and none is invented). W3c retired the old "simulated" tier entirely.

export type Fidelity = "measured" | "allocated" | "seats-only";
export type ProviderStatus = "available" | "planned";
export type ConnectKind = "otel-push" | "admin-pull";

export interface ProviderDef {
  id: "claude-code" | "copilot" | "openai";
  name: string;
  /** One line for the card. */
  blurb: string;
  status: ProviderStatus;
  /** Best per-repo fidelity this provider can reach once connected. */
  fidelity: Fidelity;
  connectKind: ConnectKind;
  /** What connecting it brings, shown as a short list on the card. */
  capabilities: string[];
  /** The honest per-repo attribution note. */
  perRepo: string;
  /** A card sigil accent (kept off the brand azure so the three read as distinct). */
  accent: string;
}

export const FIDELITY_META: Record<Fidelity, { label: string; hex: string; note: string }> = {
  measured: { label: "Measured", hex: "#22c55e", note: "attributed to the exact repo by the provider" },
  allocated: { label: "Allocated", hex: "#f59e0b", note: "reported above repo level; Ascent distributes it by git-attributed AI volume" },
  "seats-only": {
    label: "Seats only",
    hex: "#64748b",
    note: "reports seats and engagement, not spend, so no cost figure exists to report",
  },
};

export const PROVIDERS: ProviderDef[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    status: "available",
    fidelity: "measured",
    connectKind: "otel-push",
    blurb: "Per-session token & cost telemetry, pushed to Ascent over OpenTelemetry.",
    capabilities: [
      "Per-repo tokens & cost (OTel git.repository)",
      "Per-user sessions, lines, commits, PRs",
      "Admin Usage/Cost totals (optional, next)",
    ],
    perRepo: "Measured: OTel resource attributes carry the repository, so spend lands on the exact repo.",
    accent: "#d97757",
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    status: "available",
    fidelity: "seats-only",
    connectKind: "admin-pull",
    blurb: "Org seat counts and daily engagement via the Copilot Metrics + Billing APIs.",
    capabilities: [
      "Total seats (org billing)",
      "Daily engaged users",
      "No cost (GitHub does not expose per-seat price)",
    ],
    perRepo:
      "Seats only. Copilot reports at org level and returns no spend, so Ascent records seats and engagement and reports cost as unavailable rather than estimating it.",
    accent: "#7bbcff",
  },
  {
    id: "openai",
    name: "OpenAI · Codex",
    status: "planned",
    fidelity: "allocated",
    connectKind: "admin-pull",
    blurb: "Org & project cost and usage via the Admin Costs API.",
    capabilities: [
      "Cost by project / API key",
      "Codex CLI token usage",
      "Per-repo only if projects map 1:1 to repos",
    ],
    perRepo: "Allocated. Costs group by project, not repo; Ascent allocates by git evidence unless projects map to repos.",
    accent: "#10b981",
  },
];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

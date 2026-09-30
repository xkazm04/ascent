import { describe, expect, it } from "vitest";
import { PROVIDERS } from "@/lib/integrations/providers";
import type { ProviderConnectionRow } from "@/lib/db/provider-credentials";
import { connectionLadder, spendLadder } from "./integrationLadder";
import { connectionCell, connectionCounts, connectionWord, emptyIntegrations, fidelityCell, type IntegrationsData } from "./integrationModel";
import { providerStatusLine } from "./providerStatusLine";

function wire(source: string, over: Partial<IntegrationsData["statuses"][number]> = {}): IntegrationsData["statuses"][number] {
  return { source, lastReceived: new Date().toISOString(), repos: 0, costCents: 0, tokens: 0, seats: 0, sessions: 0, measured: false, ...over };
}

const provider = (id: string) => PROVIDERS.find((item) => item.id === id)!;

describe("integration connection words", () => {
  it("treats an empty org as not configured and does not invent a cost", () => {
    const data = emptyIntegrations("acme");
    expect(connectionCounts(data)).toEqual({ connected: 0, notConfigured: 4, costSources: 0 });
    expect(spendLadder(data).map((step) => step.state)).toEqual(["open", "unmeasured", "unmeasured"]);
    expect(connectionLadder(data, "gitlab").map((step) => step.state)).toEqual(["current", "unmeasured"]);
    expect(connectionLadder(data, "copilot").find((step) => step.key === "cost")?.state).toBe("unmeasured");
    expect(connectionCell("not configured").state).toBe("unmeasured");
    expect(fidelityCell("seats-only")).toEqual({ state: "unmeasured", word: "Seats only" });
  });

  it("connects OpenAI only when a key is stored, and never from a Claude token alone", () => {
    const data = emptyIntegrations("acme");
    data.ingestToken = "asc_otel.acme.secret";
    expect(connectionWord(data, "claude-code")).toBe("not configured");
    data.openai.connection = { hasCredential: true } as ProviderConnectionRow;
    data.encryptionConfigured = true;
    expect(connectionWord(data, "openai")).toBe("connected");
    expect(connectionCounts(data).costSources).toBe(1);
    expect(connectionLadder(data, "openai").find((step) => step.key === "pull")?.state).toBe("open");
  });

  it("connects Copilot when seats land, and the sentence does not print a dollar", () => {
    const data = emptyIntegrations("acme");
    data.statuses = [wire("copilot", { seats: 4, sessions: 2 })];
    expect(connectionWord(data, "copilot")).toBe("connected");
    const line = providerStatusLine(provider("copilot"), data.statuses[0]!);
    expect(line?.text).toContain("no cost reported");
    expect(line?.text).not.toContain("$");
    expect(providerStatusLine(provider("openai"), null)?.text).toContain("Save an admin key");
  });

  it("names a Claude repo miss instead of a zero-dollar success", () => {
    const data = emptyIntegrations("acme");
    data.statuses = [wire("claude-code", { repos: 0, costCents: 0 })];
    expect(connectionWord(data, "claude-code")).toBe("connected");
    expect(spendLadder(data).map((step) => step.state)).toEqual(["reached", "reached", "current"]);
    const line = providerStatusLine(provider("claude-code"), data.statuses[0]!);
    expect(line?.kind).toBe("problem");
    expect(line?.text).toContain("git.repository");
    expect(line?.text).not.toContain("$");
  });
});

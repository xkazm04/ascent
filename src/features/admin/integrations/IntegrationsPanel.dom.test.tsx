// @vitest-environment jsdom
//
// Pins the connect-surface dispatch to CONNECT_SETUP[id], not to connectKind alone. Kind-only
// dispatch was the Copilot fix (the panel used to test `p.id === "claude-code"`, so available
// Copilot offered no way to act) but it mapped every available admin-pull row onto CopilotSetup.
// OpenAI is already admin-pull and planned; flipping it available must not inherit GitHub App pull.
//
// Setup components are mocked to a marker so this file fails when the dispatch changes, not when a
// button label inside Copilot/Claude does. OpenAISetup lives in this module (unshipped stub).

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("./ClaudeCodeSetup", () => ({
  ClaudeCodeSetup: ({ slug }: { slug: string }) => <div data-testid="claude-code-setup">otel:{slug}</div>,
}));
vi.mock("./CopilotSetup", () => ({
  CopilotSetup: ({ slug }: { slug: string }) => <div data-testid="copilot-setup">pull:{slug}</div>,
}));

import { IntegrationsPanel } from "./IntegrationsPanel";
import { CONNECT_SETUP, PROVIDERS, type ProviderDef } from "@/lib/integrations/providers";

let container: HTMLElement;

function setup(providers?: readonly ProviderDef[]) {
  container = render(
    <IntegrationsPanel
      slug="acme"
      ingestToken="asc_otel.acme.abc"
      ingestPath="/api/integrations/ingest"
      {...(providers ? { providers } : {})}
    />,
  ).container;
}

/** The card belonging to one registry row — so "which surface is under which card" is asserted rather
 *  than "which surfaces exist somewhere on the page". */
function cardFor(id: string): HTMLElement {
  const card = container.querySelector(`[data-provider="${id}"]`);
  if (!card) throw new Error(`no card rendered for ${id}`);
  return card as HTMLElement;
}

function withOpenaiAvailable(): ProviderDef[] {
  return PROVIDERS.map((p) => (p.id === "openai" ? { ...p, status: "available" as const } : p));
}

describe("IntegrationsPanel — the connect surface is chosen by provider id, not only connectKind", () => {
  it("renders the OTel setup under the otel-push provider", () => {
    setup();
    expect(cardFor("claude-code").querySelector('[data-testid="claude-code-setup"]')).not.toBeNull();
    expect(cardFor("claude-code").querySelector('[data-testid="copilot-setup"]')).toBeNull();
  });

  it("renders CopilotSetup under the copilot admin-pull provider (the bug: it had no surface at all)", () => {
    setup();
    const card = cardFor("copilot");
    expect(card.querySelector('[data-testid="copilot-setup"]')).not.toBeNull();
    expect(screen.getByTestId("copilot-setup").textContent).toBe("pull:acme");
  });

  it("renders NO connect surface for a planned provider", () => {
    setup();
    const card = cardFor("openai");
    expect(card.querySelector('[data-testid="copilot-setup"]')).toBeNull();
    expect(card.querySelector('[data-testid="claude-code-setup"]')).toBeNull();
    expect(card.querySelector('[data-testid="openai-setup"]')).toBeNull();
  });

  it("puts exactly one surface on the page per available provider", () => {
    setup();
    const available = PROVIDERS.filter((p) => p.status === "available");
    expect(screen.getAllByTestId(/-setup$/).length).toBe(available.length);
  });

  it("maps openai to an explicit none/reason panel, not Copilot's GitHub App pull", () => {
    const openai = PROVIDERS.find((p) => p.id === "openai")!;
    expect(openai.connectKind).toBe("admin-pull");
    expect(openai.status).toBe("planned");
    expect(CONNECT_SETUP.openai.panel).toBe("none");
    expect(CONNECT_SETUP.openai.panel).not.toBe("copilot");
    expect(CONNECT_SETUP.copilot.panel).toBe("copilot");
    expect(CONNECT_SETUP.openai.reason.length).toBeGreaterThan(0);
  });

  it("does not render CopilotSetup when the planned openai admin-pull row is flipped available", () => {
    const providers = withOpenaiAvailable();
    expect(providers.find((p) => p.id === "openai")?.status).toBe("available");
    setup(providers);
    expect(cardFor("copilot").querySelector('[data-testid="copilot-setup"]')).not.toBeNull();
    const card = cardFor("openai");
    expect(card.querySelector('[data-testid="copilot-setup"]')).toBeNull();
    expect(card.querySelector('[data-testid="claude-code-setup"]')).toBeNull();
    const stub = card.querySelector('[data-testid="openai-setup"]');
    expect(stub).not.toBeNull();
    expect(stub?.textContent).toMatch(/not shipped/i);
  });
});

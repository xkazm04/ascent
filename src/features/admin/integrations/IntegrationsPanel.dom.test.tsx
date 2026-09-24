// @vitest-environment jsdom
//
// Pins the connect-surface dispatch to CONNECT_SETUP[id], not to connectKind alone. Kind-only
// dispatch was the Copilot fix (the panel used to test `p.id === "claude-code"`, so available
// Copilot offered no way to act) but it mapped every available admin-pull row onto CopilotSetup.
// OpenAI is admin-pull too and, since backlog row 47, available with its OWN key-based surface
// (OpenAISetup): it must never inherit Copilot's GitHub App pull.
//
// Setup components are mocked to a marker so this file fails when the dispatch changes, not when a
// button label inside a setup panel does.

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
vi.mock("./OpenAISetup", () => ({
  OpenAISetup: ({ slug, encryptionConfigured }: { slug: string; encryptionConfigured: boolean }) => (
    <div data-testid="openai-setup">
      key:{slug}:{String(encryptionConfigured)}
    </div>
  ),
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
      openai={{ connection: null, encryptionConfigured: true }}
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

function withOpenaiPlanned(): ProviderDef[] {
  return PROVIDERS.map((p) => (p.id === "openai" ? { ...p, status: "planned" as const } : p));
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
    setup(withOpenaiPlanned());
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

  it("maps openai to its own key-based panel, not Copilot's GitHub App pull", () => {
    const openai = PROVIDERS.find((p) => p.id === "openai")!;
    expect(openai.connectKind).toBe("admin-pull");
    expect(openai.status).toBe("available");
    expect(CONNECT_SETUP.openai.panel).toBe("openai");
    expect(CONNECT_SETUP.copilot.panel).toBe("copilot");
  });

  it("renders OpenAISetup (and never CopilotSetup) under the available openai card", () => {
    setup();
    expect(cardFor("copilot").querySelector('[data-testid="copilot-setup"]')).not.toBeNull();
    const card = cardFor("openai");
    expect(card.querySelector('[data-testid="copilot-setup"]')).toBeNull();
    expect(card.querySelector('[data-testid="claude-code-setup"]')).toBeNull();
    expect(card.querySelector('[data-testid="openai-setup"]')?.textContent).toBe("key:acme:true");
  });
});

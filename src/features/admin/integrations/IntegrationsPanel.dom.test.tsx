// @vitest-environment jsdom
//
// Pins the connect-surface dispatch to the PROVIDER ROW rather than to a literal id. The regression
// this exists to catch is the one it was written for: the panel tested `p.id === "claude-code"`, so
// GitHub Copilot — `status: "available"`, `connectKind: "admin-pull"` in the registry, with a
// finished owner-gated sync route behind it — rendered a green "Available" badge and no way to act.
//
// The assertions are therefore about the MAPPING (kind → surface), not about either panel's contents:
// both setup components are mocked to a marker, so this file fails when the dispatch changes and not
// when a button label inside one of them does.

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
import { PROVIDERS } from "@/lib/integrations/providers";

let container: HTMLElement;

function setup() {
  container = render(
    <IntegrationsPanel slug="acme" ingestToken="asc_otel.acme.abc" ingestPath="/api/integrations/ingest" />,
  ).container;
}

/** The card belonging to one registry row — so "which surface is under which card" is asserted rather
 *  than "which surfaces exist somewhere on the page". */
function cardFor(id: string): HTMLElement {
  const card = container.querySelector(`[data-provider="${id}"]`);
  if (!card) throw new Error(`no card rendered for ${id}`);
  return card as HTMLElement;
}

describe("IntegrationsPanel — the connect surface is chosen by connectKind + status", () => {
  it("renders the OTel setup under the otel-push provider", () => {
    setup();
    expect(cardFor("claude-code").querySelector('[data-testid="claude-code-setup"]')).not.toBeNull();
    expect(cardFor("claude-code").querySelector('[data-testid="copilot-setup"]')).toBeNull();
  });

  it("renders CopilotSetup under the available admin-pull provider (the bug: it had no surface at all)", () => {
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
  });

  it("puts exactly one surface on the page per available provider — no id survives in the dispatch", () => {
    setup();
    const available = PROVIDERS.filter((p) => p.status === "available");
    expect(screen.getAllByTestId(/-setup$/).length).toBe(available.length);
  });
});

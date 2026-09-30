// @vitest-environment jsdom
// Fixture states the seeded org does not have: a stored OpenAI key reads "connected", and the
// secret field (covered in OpenAIConnect) is not this list. Status is a word, never a hue class.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ProviderConnectionRow } from "@/lib/db/provider-credentials";
import { IntegrationsOverviewV2 } from "./IntegrationsOverview.v2";
import { emptyIntegrations } from "./integrationModel";
import { OpenAIConnectV2 } from "./OpenAIConnect.v2";
import { ForgeConnectV2 } from "./ForgeConnect.v2";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

beforeEach(() => {
  window.location.hash = "";
});

describe("Integrations overview v2", () => {
  it("opens a row and marks the selected one", () => {
    const onOpen = vi.fn();
    const { container } = render(<IntegrationsOverviewV2 data={emptyIntegrations("acme")} onOpen={onOpen} selectedId="gitlab" />);
    fireEvent.click(screen.getByRole("button", { name: /GitLab/ }));
    expect(onOpen).toHaveBeenCalledWith("gitlab");
    expect(container.querySelector("[data-provider='gitlab']")?.closest("[data-selected]")).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/text-emerald|text-lime|text-orange|text-amber|#[0-9a-fA-F]{6}/);
    expect(screen.getAllByText("not configured").length).toBeGreaterThan(0);
  });

  it("says connected when an OpenAI key is stored, without printing a dollar", () => {
    const data = emptyIntegrations("acme");
    data.openai.connection = { hasCredential: true, projectIds: [] } as unknown as ProviderConnectionRow;
    render(<IntegrationsOverviewV2 data={data} onOpen={vi.fn()} />);
    const card = document.querySelector("[data-provider='openai']")?.closest("li");
    expect(card?.textContent).toContain("connected");
    expect(card?.textContent).not.toContain("$");
  });
});

describe("secret fields stay empty", () => {
  it("does not echo an OpenAI key, and hides the field when encryption is off", () => {
    const stored = render(<OpenAIConnectV2 slug="acme" initial={{ hasCredential: true, projectIds: ["proj_a"] } as ProviderConnectionRow} encryptionConfigured />);
    const input = document.getElementById("openai-admin-key") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.value).toBe("");
    expect(input.value).not.toContain("sk-");
    stored.unmount();
    render(<OpenAIConnectV2 slug="acme" initial={null} encryptionConfigured={false} />);
    expect(document.getElementById("openai-admin-key")).toBeNull();
    expect(screen.getByText(/ENCRYPTION_KEY/)).toBeTruthy();
  });

  it("starts the GitLab token empty and calls an unobservable signal unknown", () => {
    render(<ForgeConnectV2 slug="acme" initial={[]} encryptionConfigured={false} />);
    const token = document.getElementById("gitlab-token") as HTMLInputElement;
    expect(token.type).toBe("password");
    expect(token.value).toBe("");
    expect(screen.getAllByText("not observable").length).toBeGreaterThan(0);
    expect(screen.queryByText("missing")).toBeNull();
  });
});

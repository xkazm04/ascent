// @vitest-environment jsdom
//
// The Nebius BYOM card (backlog develop-2026-09-17 row 37): the third connectable provider, an API-key
// kind like OpenRouter. What is pinned is what makes it safe to paste a key into: it posts as `nebius`
// (never falling through to the route's Bedrock default), the key is write-only, another provider's
// saved state never pre-fills it, it invents no model id, and the boundary caution sits above the key.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NebiusByomSettings } from "./NebiusByomSettings";
import type { OrgLlmConfigPublic } from "@/lib/db";

const saved = (over: Partial<OrgLlmConfigPublic>) =>
  ({ provider: "nebius", enabled: true, hasCredentials: true, modelId: "zai-org/GLM-5.3-Flash", ...over }) as OrgLlmConfigPublic;

const card = (initial: OrgLlmConfigPublic | null = null) => (
  <NebiusByomSettings slug="acme" initial={initial} planAllowed encryptionConfigured />
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("NebiusByomSettings", () => {
  it("saves as provider nebius with the typed model and key, then clears the key from the field", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(card());
    fireEvent.change(screen.getByLabelText("Model id"), { target: { value: "zai-org/GLM-5.3-Flash" } });
    const key = screen.getByLabelText("Nebius API key") as HTMLInputElement;
    fireEvent.change(key, { target: { value: "nb-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Saved."));
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ org: "acme", provider: "nebius", modelId: "zai-org/GLM-5.3-Flash", apiKey: "nb-secret" });
    expect(key.value).toBe("");
  });

  it("invents no model id: Save and Test stay disabled until one is typed", () => {
    render(card());
    expect((screen.getByLabelText("Model id") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
  });

  it("never renders a stored key, only that one is configured", () => {
    render(card(saved({})));
    const key = screen.getByLabelText("Nebius API key") as HTMLInputElement;
    expect([key.value, key.type, key.placeholder]).toEqual(["", "password", "configured ••••"]);
    expect((screen.getByLabelText("Model id") as HTMLInputElement).value).toBe("zai-org/GLM-5.3-Flash");
  });

  it("is not pre-filled by another provider's saved config", () => {
    render(card(saved({ provider: "openrouter", modelId: "openai/gpt-4o-mini" })));
    expect((screen.getByLabelText("Model id") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Nebius API key") as HTMLInputElement).placeholder).not.toMatch(/configured/);
    expect(screen.queryByRole("button", { name: "Disable & clear" })).toBeNull();
  });

  it("states it is not in-boundary, above the key field", () => {
    render(card());
    const note = screen.getByRole("note");
    expect(note.textContent).toMatch(/not in-boundary/i);
    expect(note.textContent).toMatch(/repository file samples/i);
    const key = screen.getByLabelText("Nebius API key");
    expect(note.compareDocumentPosition(key) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

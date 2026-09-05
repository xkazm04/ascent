// @vitest-environment jsdom
//
// First tests for the OpenRouter BYOM card — the form that stores a customer's API key and decides
// which model an org's scans run on. The behavior pinned here is the one that had regressed against
// the pattern GatePolicyEditor already established: outcomes must be ANNOUNCED, not merely displayed.
// A `{msg && <p role="status">}` mounts the live region only once there is something to say, and a
// live region inserted after the fact is never read — so "Saved.", "Connection failed." and
// "Disabled and cleared the key." were indistinguishable to a screen reader.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OpenRouterByomSettings } from "./OpenRouterByomSettings";

function stub(body: Record<string, unknown>, ok = true) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const card = (over: Partial<Parameters<typeof OpenRouterByomSettings>[0]> = {}) => (
  <OpenRouterByomSettings slug="acme" initial={null} planAllowed encryptionConfigured {...over} />
);

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpenRouterByomSettings — outcomes are announced, not just shown", () => {
  it("renders the live region BEFORE there is any message to put in it", () => {
    render(card());
    // Present from first paint — that is what makes a later update announceable at all.
    const region = screen.getByRole("status");
    expect(region).toBeTruthy();
    expect(region.textContent).toBe("");
    expect(region.getAttribute("aria-live")).toBe("polite");
  });

  it("announces a successful save into that same region", async () => {
    stub({ ok: true });
    render(card());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Saved."));
  });

  it("prefixes a failure with 'Error:' so the kind isn't conveyed by color alone", async () => {
    stub({ error: "Secret encryption is not configured." }, false);
    render(card());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/^Error: /));
    expect(screen.getByRole("status").textContent).toContain("Secret encryption is not configured.");
  });

  it("reports a failed connection test as an error, not a success", async () => {
    stub({ ok: false, error: "Model did not return a JSON object" });
    render(card());
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/^Error: /));
    expect(screen.getByRole("status").textContent).toContain("JSON object");
  });

  it("marks the action row busy while a request is in flight", async () => {
    let release: (v: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((res) => (release = res))));
    render(card());
    const row = screen.getByRole("button", { name: "Save" }).parentElement!;

    expect(row.getAttribute("aria-busy")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(row.getAttribute("aria-busy")).toBe("true"));

    release(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await waitFor(() => expect(row.getAttribute("aria-busy")).toBe("false"));
  });
});

describe("OpenRouterByomSettings — the key is write-only", () => {
  it("never renders a stored key, only that one is configured", () => {
    render(card({ initial: { provider: "openrouter", hasCredentials: true, modelId: "openai/gpt-4o-mini" } as never }));
    const key = screen.getByPlaceholderText("configured ••••") as HTMLInputElement;
    expect(key.value).toBe("");
    expect(key.type).toBe("password");
  });

  it("clears the typed key from state after a successful save", async () => {
    stub({ ok: true });
    render(card());
    const key = screen.getByPlaceholderText("sk-or-…") as HTMLInputElement;
    fireEvent.change(key, { target: { value: "sk-or-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Saved."));
    expect(key.value).toBe("");
  });
});

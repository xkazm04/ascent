// @vitest-environment jsdom
//
// Pins the Bedrock-card state bleed fix. `initial` is the org's ONE active LLM config, shared by both
// BYOM cards — read unconditionally it made an OpenRouter org's Bedrock card show the OpenRouter model
// slug, a pre-checked "use this provider", and "configured ••••" AWS fields. A Save from that state
// posted no provider, defaulted to "bedrock" server-side, and kept the OpenRouter credential blob →
// the Bedrock resolver returned null → the fail-closed guard aborted EVERY scan for the org with a
// message about ENCRYPTION_KEY, which was never the problem.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { OrgLlmConfigPublic } from "@/lib/db";
import { LlmProviderSettings } from "./LlmProviderSettings";

function config(over: Partial<OrgLlmConfigPublic> = {}): OrgLlmConfigPublic {
  return {
    provider: "bedrock",
    enabled: true,
    modelId: "us.anthropic.claude-sonnet-4-6",
    region: "eu-west-1",
    authMode: "static",
    hasCredentials: true,
    lastValidatedAt: "2026-07-01T10:00:00.000Z",
    lastValidationError: null,
    createdBy: "owner",
    updatedAt: "2026-07-01T10:00:00.000Z",
    ...over,
  };
}

function renderCard(initial: OrgLlmConfigPublic | null) {
  return render(<LlmProviderSettings slug="acme" initial={initial} planAllowed encryptionConfigured />);
}

const modelInput = () => screen.getByPlaceholderText("us.anthropic.claude-sonnet-4-6") as HTMLInputElement;
const keyIdInput = () => screen.getByLabelText("AWS Access Key ID") as HTMLInputElement;
const secretInput = () => document.querySelector<HTMLInputElement>('input[type="password"]')!;
const enabledBox = () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LlmProviderSettings — no cross-provider state bleed", () => {
  it("shows a CLEAN Bedrock card for an org running on OpenRouter", () => {
    renderCard(config({ provider: "openrouter", modelId: "z-ai/glm-5.2", region: null, enabled: true, hasCredentials: true }));

    expect(modelInput().value).toBe("us.anthropic.claude-sonnet-4-6"); // the Bedrock default, NOT the OpenRouter slug
    expect(enabledBox().checked).toBe(false); // never pre-armed by another provider's "enabled"
    expect(keyIdInput().placeholder).toBe("AKIA…"); // not "configured ••••" — no AWS creds are stored
    expect(secretInput().placeholder).toBe("••••••••");
    expect(screen.queryByRole("button", { name: /disable & clear/i })).toBeNull();
    expect(screen.queryByText(/last validated/i)).toBeNull();
  });

  it("round-trips its OWN config for a bedrock org", () => {
    renderCard(config());

    expect(modelInput().value).toBe("us.anthropic.claude-sonnet-4-6");
    expect((screen.getByPlaceholderText("us-east-1") as HTMLInputElement).value).toBe("eu-west-1");
    expect(enabledBox().checked).toBe(true);
    expect(keyIdInput().placeholder).toBe("configured ••••");
    expect(screen.getByRole("button", { name: /disable & clear/i })).toBeInTheDocument();
    expect(screen.getByText(/last validated/i)).toBeInTheDocument();
  });

  it("starts from the defaults when the org has no config at all", () => {
    renderCard(null);
    expect(modelInput().value).toBe("us.anthropic.claude-sonnet-4-6");
    expect(enabledBox().checked).toBe(false);
    expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled();
  });
});

describe("LlmProviderSettings — a provider takeover must carry its own credential", () => {
  it("blocks Save from an OpenRouter org until AWS keys are entered, then posts provider:bedrock with them", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderCard(config({ provider: "openrouter", modelId: "z-ai/glm-5.2", hasCredentials: true }));

    // Without fresh AWS keys the save would keep the OpenRouter secret under provider "bedrock".
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    expect(screen.getByText(/enter the AWS access key and secret/i)).toBeInTheDocument();

    fireEvent.change(keyIdInput(), { target: { value: "AKIAEXAMPLE" } });
    fireEvent.change(secretInput(), { target: { value: "s3cret" } });
    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as Record<string, unknown>;
    expect(body.provider).toBe("bedrock"); // explicit — never the route's implicit default
    expect(body.accessKeyId).toBe("AKIAEXAMPLE");
    expect(body.secretAccessKey).toBe("s3cret");
  });

  it("a bedrock org can still edit model/region without re-entering keys", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderCard(config());

    fireEvent.change(modelInput(), { target: { value: "us.anthropic.claude-haiku-4-5" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as Record<string, unknown>;
    expect(body.provider).toBe("bedrock");
    expect(body.modelId).toBe("us.anthropic.claude-haiku-4-5");
    expect(body.accessKeyId).toBeUndefined(); // omitted → the stored Bedrock credential is kept
  });
});

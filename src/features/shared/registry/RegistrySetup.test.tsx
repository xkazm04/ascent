// @vitest-environment jsdom
//
// Step 1 must send a mode and a telemetry sink on both create and map. The route already persists
// those columns; without the radios the UI always left the schema defaults (git_native / off) and
// never offered hosted-mirror or sink A/B.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { fixtureRegistryView } from "@/lib/org/registry-view.fixture";
import { RegistrySetupActions } from "./RegistrySetup";

const view = fixtureRegistryView("acme", "unmapped")!;

function mockFetch() {
  const fn = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      fullName: "acme/ai-registry",
      scaffolded: true,
      prNumber: 1,
      committed: [".ascent/registry.yaml"],
      scaffoldPrUrl: "https://github.com/acme/ai-registry/pull/1",
    }),
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function postedBody(fetchFn: ReturnType<typeof mockFetch>): Record<string, unknown> {
  const call = fetchFn.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
  return JSON.parse(String((call?.[1] as RequestInit).body)) as Record<string, unknown>;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("RegistrySetupActions — mode and telemetry sink", () => {
  it("offers git-native vs hosted-mirror and a telemetry sink, defaulting to git-native and off", () => {
    render(<RegistrySetupActions view={view} slug="acme" />);
    expect(screen.getByTestId("setup-mode").getAttribute("aria-label")).toBe("Mode");
    expect(screen.getByRole("radio", { name: "git-native" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "hosted-mirror" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("setup-sink").getAttribute("aria-label")).toBe("Telemetry sink");
    expect(screen.getByRole("radio", { name: "off" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "api" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("radio", { name: "registry" }).getAttribute("aria-checked")).toBe("false");
  });

  it("POSTs the chosen mode and sink on create", async () => {
    const fetchFn = mockFetch();
    render(<RegistrySetupActions view={view} slug="acme" />);
    fireEvent.click(screen.getByRole("radio", { name: "hosted-mirror" }));
    fireEvent.click(screen.getByRole("radio", { name: "api" }));
    fireEvent.click(screen.getByRole("button", { name: /Create acme\/ai-registry/ }));
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(postedBody(fetchFn)).toMatchObject({
      create: true,
      name: "ai-registry",
      mode: "hosted_mirror",
      telemetrySink: "api",
    });
  });

  it("POSTs the same choice on map so create and map cannot disagree", async () => {
    const fetchFn = mockFetch();
    render(<RegistrySetupActions view={view} slug="acme" />);
    fireEvent.click(screen.getByRole("radio", { name: "git-native" }));
    fireEvent.click(screen.getByRole("radio", { name: "registry" }));
    fireEvent.click(screen.getByRole("button", { name: /Map an existing repo/ }));
    fireEvent.change(screen.getByLabelText(/owner \/ repo/i), { target: { value: "acme/handbook" } });
    fireEvent.click(screen.getByRole("button", { name: /Map repository/ }));
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(postedBody(fetchFn)).toMatchObject({
      fullName: "acme/handbook",
      mode: "git_native",
      telemetrySink: "registry",
    });
  });
});

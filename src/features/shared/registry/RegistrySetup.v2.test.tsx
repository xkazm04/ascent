// @vitest-environment jsdom
// Prism connect form: the same POST body as the radios, on pressed segments instead.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import { fixtureRegistryView } from "@/lib/org/registry-view.fixture";
import { RegistrySetupV2 } from "./RegistrySetup.v2";

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

describe("RegistrySetupV2", () => {
  it("defaults to git-native and off", () => {
    render(<RegistrySetupV2 view={view} slug="acme" />);
    expect(screen.getByRole("button", { name: "git-native" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "hosted-mirror" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "off" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("POSTs the chosen mode and sink on create", async () => {
    const fetchFn = mockFetch();
    render(<RegistrySetupV2 view={view} slug="acme" />);
    fireEvent.click(screen.getByRole("button", { name: "hosted-mirror" }));
    fireEvent.click(screen.getByRole("button", { name: "api" }));
    fireEvent.click(screen.getByRole("button", { name: /Create acme\/ai-registry/ }));
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(postedBody(fetchFn)).toMatchObject({
      create: true,
      name: "ai-registry",
      mode: "hosted_mirror",
      telemetrySink: "api",
    });
  });

  it("POSTs the same choice on map", async () => {
    const fetchFn = mockFetch();
    render(<RegistrySetupV2 view={view} slug="acme" />);
    fireEvent.click(screen.getByRole("button", { name: "git-native" }));
    fireEvent.click(screen.getByRole("button", { name: "registry" }));
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

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { fixtureRegistryView } from "@/lib/org/registry-view.fixture";
import { RegistryWorkspace } from "./RegistryWorkspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("Registry v2", () => {
  it("keeps unknown fleet coverage and independent usage sources honest", () => {
    const view = fixtureRegistryView("acme", "indexed")!;
    render(<RegistryWorkspace view={view} slug="acme" />);
    expect(screen.getByText("Sync coverage not measured")).toBeTruthy();
    expect(screen.getByText("Direct API invokes · 30d").nextElementSibling?.textContent).toBe("Not measured");
    expect(screen.getByRole("button", { name: /re-index/i })).toBeTruthy();
  });
  it("does not offer mutations to a read-only viewer", () => {
    render(<RegistryWorkspace view={fixtureRegistryView("acme", "no-permission")!} slug="acme" />);
    expect(screen.queryByRole("button", { name: /connect repository|create repository|re-index/i })).toBeNull();
  });
  it("maps the explicitly selected repo and reports server errors inline", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "Repository access denied" }) });
    vi.stubGlobal("fetch", fetcher);
    render(<RegistryWorkspace view={fixtureRegistryView("acme", "unmapped")!} slug="acme" />);
    const input = screen.getByLabelText("Owner / repository");
    expect(input.getAttribute("value")).toBe("");
    fireEvent.change(input, { target: { value: "acme/team-rules" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect repository" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Repository access denied"));
    expect(fetcher.mock.calls[0][0]).toBe("/api/org/acme/registry");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ fullName: "acme/team-rules" });
    expect(refresh).not.toHaveBeenCalled();
  });
  it("creates a repository and refreshes the authoritative server view", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ scaffolded: true, scaffoldPrUrl: "https://github.com/acme/rules/pull/1" }) });
    vi.stubGlobal("fetch", fetcher);
    render(<RegistryWorkspace view={fixtureRegistryView("acme", "unmapped")!} slug="acme" />);
    fireEvent.click(screen.getByRole("button", { name: "Create repository" }));
    fireEvent.change(screen.getByLabelText("Repository name"), { target: { value: "rules" } });
    fireEvent.click(screen.getByRole("button", { name: "Create & connect" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ create: true, name: "rules" });
    expect(screen.getByRole("link", { name: "Review scaffold PR ↗" }).getAttribute("href")).toContain("/pull/1");
  });
  it.each(["scaffold_pr_open", "migrating", "error", "hosted"])("renders the %s state", state => {
    render(<RegistryWorkspace view={fixtureRegistryView("acme", state)!} slug="acme" />);
    expect(screen.getByRole("region", { name: "Registry v2" })).toBeTruthy();
  });
});

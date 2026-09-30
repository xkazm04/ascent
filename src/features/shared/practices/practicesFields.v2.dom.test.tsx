// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MODAL_ROOT_ID } from "@/components/ui/ModalRoot";
import { PLAYBOOK_TEMPLATES } from "@/lib/org/playbook-templates";
import { NewPracticeModalV2 } from "./NewPracticeModal.v2";
import { PlaybookApplyControlsV2 } from "./PlaybookApplyControls.v2";
import { PracticeApplyV2 } from "./PracticeApply.v2";
import { RegistryPracticeApplyV2 } from "./RegistryPracticeApply.v2";
import { RegistrySyncStripV2 } from "./RegistrySyncStrip.v2";
import { UNMAPPED_SYNC, type RegistrySync } from "@/lib/org/registry-sync";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Prism practice fields", () => {
  it("renders the new-practice controls as labeled kit fields and applies a template", async () => {
    const host = document.createElement("div");
    host.id = MODAL_ROOT_ID;
    document.body.append(host);
    render(
      <NewPracticeModalV2 open slug="acme" dimOptions={[{ id: "D1", label: "AI Tooling" }]} onClose={() => {}} onCreated={() => {}} />,
    );
    const title = await screen.findByRole("textbox", { name: "Playbook title" });
    expect(screen.getByRole("combobox", { name: "Start from a template" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Dimension" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Summary (optional)" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add practice" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "Start from a template" }), { target: { value: "0" } });
    expect((title as HTMLInputElement).value).toBe(PLAYBOOK_TEMPLATES[0]?.title);
    expect((screen.getByRole("button", { name: "Add practice" }) as HTMLButtonElement).disabled).toBe(false);
    host.remove();
  });

  it("keeps the registry copy select's value and label", () => {
    render(<RegistryPracticeApplyV2 slug="agent-guidance" title="Agent guidance" repoOptions={["acme/app", "acme/web"]} />);
    const select = screen.getByRole("combobox", { name: 'Repository to copy "Agent guidance" into' }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "acme/web" } });
    expect(select.value).toBe("acme/web");
    expect(screen.getByRole("button", { name: "Copy into a repo →" })).toBeTruthy();
  });

  it("labels an adopted playbook repo and disables Mark applied until a new repo is picked", () => {
    const onApply = vi.fn();
    render(
      <PlaybookApplyControlsV2
        repoOptions={["acme/app"]}
        applied={["acme/app"]}
        pick=""
        onPick={() => {}}
        onApply={onApply}
        onOpenPr={() => {}}
        prBusy={false}
      />,
    );
    expect(screen.getByRole("option", { name: "acme/app · adopted" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Mark applied" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/have adopted this playbook/)).toBeTruthy();
  });

  it("says when the registry is unmapped, and names the repo when it is mapped", () => {
    const { rerender } = render(<RegistrySyncStripV2 sync={UNMAPPED_SYNC} slug="acme" artifact="practices" />);
    expect(screen.getByText(/Nothing is backed by a registry yet: Practices/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Set up the registry" }).getAttribute("href")).toContain("registry");
    const mapped: RegistrySync = {
      ...UNMAPPED_SYNC,
      mapped: true,
      fullName: "acme/registry",
      url: "https://github.com/acme/registry",
      status: "indexed",
      counts: { skills: 2, practices: 3, memory: 1, lessons: 0 },
    };
    rerender(<RegistrySyncStripV2 sync={mapped} slug="acme" artifact="practices" />);
    expect(screen.getByText("acme/registry")).toBeTruthy();
    expect(screen.getByText("mapped, not indexed yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Registry" })).toBeTruthy();
  });
});

describe("PracticeApplyV2 preview", () => {
  it("previews a starter for the selected repo and shows the shape line", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ artifact: { path: "AGENTS.md", body: "# starter" }, shape: { kind: "generic" } }),
    });
    render(<PracticeApplyV2 practiceId="agent-guidance" gapRepos={[{ name: "web", fullName: "acme/web" }]} />);
    expect(screen.getByRole("combobox", { name: "Repository to apply this practice to" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Preview starter" }));
    expect((await screen.findByTestId("practice-preview-shape")).textContent).toBe("Generic starter (no mined pattern yet)");
  });
});

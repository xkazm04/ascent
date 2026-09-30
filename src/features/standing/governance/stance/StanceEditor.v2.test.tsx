// @vitest-environment jsdom

// Prism stance editor: the same draft payload, through FormField controls.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AiStance } from "@/lib/types";
import { StanceEditorV2 } from "./StanceEditor.v2";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const stance: AiStance = {
  permittedTools: ["Claude Code"],
  permittedModels: ["claude-opus"],
  noAiZones: [{ repoGlobs: ["acme/billing-*"], pathGlobs: ["prisma/**"], reason: "PCI" }],
  reviewTiers: [{ tier: "T0", review: "Normal review." }],
  provenance: { requireTrailer: true, requireHumanApproval: false },
};

afterEach(() => vi.unstubAllGlobals());

describe("StanceEditorV2", () => {
  it("seeds the labelled controls and posts the edited draft", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ stance: { version: 2, stance } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StanceEditorV2 org="acme" initial={stance} nextVersion={2} />);

    const tools = screen.getByRole("textbox", { name: "Permitted tools" }) as HTMLTextAreaElement;
    expect(tools.value).toBe("Claude Code");
    expect((screen.getByRole("textbox", { name: "Permitted models" }) as HTMLTextAreaElement).value).toBe("claude-opus");
    expect((screen.getByRole("textbox", { name: "Repo globs" }) as HTMLInputElement).value).toBe("acme/billing-*");
    expect((screen.getByRole("textbox", { name: "Path globs" }) as HTMLInputElement).value).toBe("prisma/**");
    expect((screen.getByRole("textbox", { name: "Why" }) as HTMLInputElement).value).toBe("PCI");
    expect((screen.getByRole("textbox", { name: /T0,/ }) as HTMLInputElement).value).toBe("Normal review.");
    expect((screen.getByRole("checkbox", { name: /attribution trailers/i }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /human approval on AI-attributed/i }) as HTMLInputElement).checked).toBe(false);

    fireEvent.change(tools, { target: { value: "Cursor" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Draft saved"));
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      org: string;
      action: string;
      stance: AiStance;
    };
    expect(body.org).toBe("acme");
    expect(body.action).toBe("draft");
    expect(body.stance.permittedTools).toEqual(["Cursor"]);
    expect(body.stance.noAiZones[0]?.reason).toBe("PCI");
  });

  it("says when no zone is declared", () => {
    render(<StanceEditorV2 org="acme" initial={null} nextVersion={1} />);
    expect(screen.getByText("No zones declared.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish v1" })).toBeTruthy();
  });
});

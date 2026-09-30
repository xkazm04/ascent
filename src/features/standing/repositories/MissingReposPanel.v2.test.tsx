// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MissingReposPanelV2 } from "./MissingReposPanel.v2";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const repo = {
  owner: "acme",
  name: "api",
  fullName: "acme/api",
  url: "https://github.com/acme/api",
  missingSince: "2026-09-01T00:00:00.000Z",
};

describe("MissingReposPanelV2", () => {
  it("renders nothing when every row is gone", () => {
    const { container } = render(<MissingReposPanelV2 org="acme" repos={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the absence and unwatches through the same post", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<MissingReposPanelV2 org="acme" repos={[repo]} />);
    expect(screen.getByText("acme/api")).toBeInTheDocument();
    expect(screen.getByText(/2026-09-01/)).toBeInTheDocument();
    const open = screen.getByRole("link", { name: "Open" });
    expect(open).toHaveAttribute("href", repo.url);
    expect(open).toHaveAttribute("target", "_blank");
    fireEvent.click(screen.getByRole("button", { name: "Unwatch acme/api" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/org/watch",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"watched":false'),
      }),
    );
    vi.unstubAllGlobals();
  });
});

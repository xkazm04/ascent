// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RepoLeaderboardBulkBarV2 } from "./RepoLeaderboardBulkBar.v2";

const segments = [
  { id: "s1", name: "platform" },
  { id: "s2", name: "legacy" },
];

describe("RepoLeaderboardBulkBarV2", () => {
  it("keeps the segment select and disables Add until a segment is chosen", () => {
    const setTarget = vi.fn();
    const onAdd = vi.fn();
    const onClear = vi.fn();
    render(
      <RepoLeaderboardBulkBarV2
        count={2}
        segments={segments}
        target=""
        setTarget={setTarget}
        busy={false}
        error={null}
        onAdd={onAdd}
        onClear={onClear}
      />,
    );
    const select = screen.getByLabelText("Add selected repos to segment");
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    fireEvent.change(select, { target: { value: "s1" } });
    expect(setTarget).toHaveBeenCalledWith("s1");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledOnce();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("adds when a segment is selected and shows the action error", () => {
    const onAdd = vi.fn();
    render(
      <RepoLeaderboardBulkBarV2
        count={1}
        segments={segments}
        target="s2"
        setTarget={() => {}}
        busy={false}
        error="Could not tag."
        onAdd={onAdd}
        onClear={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not tag.");
  });
});

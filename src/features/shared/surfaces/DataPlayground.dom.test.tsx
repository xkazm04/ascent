// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataPlayground } from "./DataPlayground";

describe("surface data studies", () => {
  it("keeps row selection when sorting, paging and searching", () => {
    render(<DataPlayground slug="table" />);
    fireEvent.click(screen.getByLabelText("Select component-kit"));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByRole("status").textContent).toBe("1 selected");
    fireEvent.change(screen.getByLabelText("Find repositories"), { target: { value: "component" } });
    expect((screen.getByLabelText("Select component-kit") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Find repositories"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Readiness/ }));
    const firstRow = screen.getAllByRole("row")[1]!;
    expect(within(firstRow).getByText("docs")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Find repositories"), { target: { value: "unfindable" } });
    expect(screen.getByText(/No repositories match/)).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(1);
  });

  it("returns to the folder root and clears the document preview", () => {
    render(<DataPlayground slug="file-browsing" />);
    fireEvent.click(screen.getByRole("button", { name: /Engineering/ }));
    fireEvent.click(screen.getByRole("button", { name: /Principles.md/ }));
    expect(screen.getByRole("status").textContent).toContain("Engineering");
    fireEvent.click(screen.getByRole("button", { name: /Knowledge/ }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: /Design/ })).toBeTruthy();
  });

  it("unified comparison shows shared context only once", () => {
    render(<DataPlayground slug="diff-comparison" />);
    fireEvent.click(screen.getByRole("button", { name: "Unified" }));
    expect(screen.getAllByText(/"name": "studio"/)).toHaveLength(1);
    expect(screen.getByText(/version.*1/)).toBeTruthy();
    expect(screen.getByText(/verified/)).toBeTruthy();
  });
});

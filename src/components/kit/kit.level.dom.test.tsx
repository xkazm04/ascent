// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DimensionMark, LevelNav, parseDimension, useHashFlag } from "./index";

function Probe() {
  const [open, setOpen] = useHashFlag("outcome");
  return (
    <div>
      <span data-testid="state">{open ? "open" : "closed"}</span>
      <button onClick={() => setOpen(true)}>open</button>
      <button onClick={() => setOpen(false)}>close</button>
    </div>
  );
}

afterEach(() => history.replaceState(null, "", "/"));

describe("useHashFlag: a nested level held in the URL hash", () => {
  it("opens by writing #name, closes by dropping the hash, and follows browser navigation", async () => {
    render(<Probe />);
    expect(screen.getByTestId("state").textContent).toBe("closed");
    fireEvent.click(screen.getByText("open"));
    expect(location.hash).toBe("#outcome");
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("open"));
    fireEvent.click(screen.getByText("close"));
    expect(location.hash).toBe("");
    expect(screen.getByTestId("state").textContent).toBe("closed");
    act(() => {
      location.hash = "outcome";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByTestId("state").textContent).toBe("open");
  });
  it("ignores a different hash", () => {
    location.hash = "other";
    render(<Probe />);
    expect(screen.getByTestId("state").textContent).toBe("closed");
  });
});

describe("DimensionMark", () => {
  it("parses D1..D9 only", () => {
    expect(parseDimension("D9")).toBe(9);
    expect(parseDimension("D0")).toBeNull();
    expect(parseDimension("D10")).toBeNull();
    expect(parseDimension("security")).toBeNull();
  });
  it("names a known dimension with its hue and leaves an unknown one un-hued", () => {
    const { container } = render(
      <>
        <DimensionMark id="D3" label="CI/CD" />
        <DimensionMark id="???" />
      </>,
    );
    const [known, unknown] = Array.from(container.querySelectorAll("[data-role='dimension-mark']")) as HTMLElement[];
    expect(known.style.color).toContain("--spec-3");
    expect(known.title).toBe("CI/CD");
    expect(unknown.style.color).toBe("");
  });
});

describe("LevelNav with a same-page Back", () => {
  it("renders a button (no scroll jump) when the back link carries a handler", () => {
    const onClick = vi.fn();
    render(<LevelNav trail={[{ label: "Live" }, { label: "Outcome" }]} back={{ label: "Cockpit", onClick }} />);
    fireEvent.click(screen.getByRole("button", { name: /Cockpit/ }));
    expect(onClick).toHaveBeenCalled();
  });
  it("still renders a real link for a URL level", () => {
    render(<LevelNav trail={[{ label: "A" }, { label: "B" }]} back={{ label: "Up", href: "/x" }} />);
    expect(screen.getByRole("link", { name: /Up/ }).getAttribute("href")).toBe("/x");
  });
});

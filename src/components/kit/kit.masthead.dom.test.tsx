// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DimensionLine, Masthead } from "./index";

describe("Masthead", () => {
  it("leads with the statement as the page heading, the named phrase heavier, then the figures", () => {
    render(
      <Masthead
        eyebrow="Standing"
        statement="kiro stands at"
        named="L5 · 89"
        lede="Autonomous."
        figures={[{ label: "AI Adoption", value: 86, detail: <span>up 2</span>, title: "over 2 repos" }]}
        aside={<span>trend</span>}
      />,
    );
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toContain("kiro stands at");
    expect(h1.querySelector("b")?.textContent).toBe("L5 · 89");
    expect(screen.getByText("AI Adoption")).toBeTruthy();
    expect(screen.getByTitle("over 2 repos").textContent).toBe("86");
    expect(screen.getByText("up 2")).toBeTruthy();
    expect(document.querySelector('[data-role="masthead-aside"]')).toBeTruthy();
  });

  it("renders no figures row when there is nothing to put in it", () => {
    render(<Masthead statement="x" />);
    expect(document.querySelector('[data-role="masthead-figures"]')).toBeNull();
  });
});

describe("DimensionLine detail and floor", () => {
  it("draws the floor mark at its position and never nests a link inside a row that has a detail", () => {
    render(<DimensionLine dimension={3} label="CI/CD" value={0.8} floor={0.65} href="/x" detail={<a href="/practice">Practice</a>} />);
    const mark = document.querySelector<HTMLElement>('[data-role="dimension-floor"]');
    expect(mark?.style.left).toBe("65%");
    expect(document.querySelector("a a")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("states an unmeasured line as an empty track, never a bar", () => {
    render(<DimensionLine dimension={5} label="Docs" value={null} display="not judged" />);
    expect(screen.getByText("not judged")).toBeTruthy();
    expect(document.querySelector<HTMLElement>('[data-role="dimension-bar"]')?.style.width).toBe("0%");
  });
});

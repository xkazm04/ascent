// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Legend } from "./Legend";
import { STATE_HINT, STATE_LABEL } from "./states";

describe("Legend shows only what the data uses", () => {
  it("renders one row per DISTINCT state, in the caller's order", () => {
    render(<Legend states={["measured", "declared", "measured"]} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(STATE_LABEL.measured);
    expect(items[1]).toHaveTextContent(STATE_LABEL.declared);
    // A static six-row legend is the failure mode: the four unused states must be absent.
    expect(screen.queryByText(STATE_LABEL["not-judged"])).not.toBeInTheDocument();
    expect(screen.queryByText(STATE_LABEL.missing)).not.toBeInTheDocument();
  });

  it("renders nothing at all when there is nothing to key", () => {
    const { container } = render(<Legend states={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("carries the demoted caveat on the row, reachable on hover/focus", () => {
    render(<Legend states={["not-judged"]} />);
    expect(screen.getByRole("listitem")).toHaveAttribute("title", STATE_HINT["not-judged"]);
  });

  it("uses the REAL symbol, not an approximation — each row's swatch is the state's own mark", () => {
    render(<Legend states={["not-judged", "missing"]} />);
    // The not-judged swatch carries the shared hatch defs; the missing swatch draws no rect at all.
    const swatches = screen.getAllByRole("img");
    expect(swatches).toHaveLength(2);
    expect(swatches[0]!.querySelector("pattern")).not.toBeNull();
    expect(swatches[1]!.querySelectorAll("[data-swatch]")).toHaveLength(0);
  });

  it("appends domain-specific extra rows after the states", () => {
    render(
      <Legend
        states={["measured"]}
        extra={[{ id: "you", label: "You", swatch: <svg role="img" aria-label="You marker" />, hint: "Your own repository." }]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[1]).toHaveTextContent("You");
    expect(items[1]).toHaveAttribute("title", "Your own repository.");
  });
});

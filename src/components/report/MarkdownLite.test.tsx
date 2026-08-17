// @vitest-environment jsdom
//
// The four-construct renderer for model prose. Pinned: (1) legacy single-paragraph summaries render
// as one <p> unchanged; (2) blank lines split paragraphs and "- " lines become a list; (3) **bold**
// and `code` render as elements, an UNCLOSED marker stays literal text; (4) nothing else is
// interpreted — a link or an HTML tag in model output prints as text, never as markup (the summary
// describes untrusted repository content).

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownLite, parseBlocks } from "./MarkdownLite";

describe("parseBlocks", () => {
  it("treats a marker-free string as one paragraph (legacy summaries)", () => {
    expect(parseBlocks("Testing is the strongest dimension. 1033 test files.")).toEqual([
      { kind: "p", text: "Testing is the strongest dimension. 1033 test files." },
    ]);
  });

  it("splits on blank lines and gathers bullets into one list, joining wrapped bullet lines", () => {
    const text = "**Strong.** Coverage wired.\n\n- first point\n  continues here\n- second\n\nClosing line.";
    expect(parseBlocks(text)).toEqual([
      { kind: "p", text: "**Strong.** Coverage wired." },
      { kind: "ul", items: ["first point continues here", "second"] },
      { kind: "p", text: "Closing line." },
    ]);
  });
});

describe("MarkdownLite", () => {
  it("renders bold and code as elements", () => {
    render(<MarkdownLite text="Run `npm test` and note the **threshold**." />);
    expect(screen.getByText("npm test").tagName).toBe("CODE");
    expect(screen.getByText("threshold").tagName).toBe("STRONG");
  });

  it("leaves an unclosed marker as literal text rather than swallowing the rest of the line", () => {
    const { container } = render(<MarkdownLite text="a **b and `c" />);
    expect(container.textContent).toBe("a **b and `c");
    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector("code")).toBeNull();
  });

  it("never renders links or HTML from model output", () => {
    const { container } = render(<MarkdownLite text='See [x](https://evil.example) and <img src=x onerror=alert(1)>' />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("[x](https://evil.example)");
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

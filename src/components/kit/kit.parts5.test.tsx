import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BarRow, Caption, Display, FillBar, FilterBar, FilterCount, Notice, SortHead } from "./index";

describe("kit parts 5 (promoted from the Prism v2 compositions)", () => {
  it("Notice announces an error with a glyph and the words, and an info notice politely", () => {
    const err = renderToStaticMarkup(<Notice className="mt-3">Save failed</Notice>);
    expect(err).toContain('role="alert"');
    expect(err).toContain("! ");
    expect(err).toContain("Save failed");
    const info = renderToStaticMarkup(<Notice tone="info">Saved</Notice>);
    expect(info).toContain('role="status"');
    expect(info).not.toContain("! ");
  });

  it("FilterCount shows the clear action only while a filter is active", () => {
    const on = renderToStaticMarkup(<FilterBar><FilterCount shown={3} total={9} active onClear={() => {}} /></FilterBar>);
    expect(on).toContain("3 of 9");
    expect(on).toContain("Clear filters");
    const off = renderToStaticMarkup(<FilterCount shown={9} total={9} active={false} onClear={() => {}} />);
    expect(off).not.toContain("Clear filters");
  });

  it("FillBar clamps the width and names itself only when given a label", () => {
    expect(renderToStaticMarkup(<FillBar value={140} label="140%" />)).toContain("width:100%");
    expect(renderToStaticMarkup(<FillBar value={Number.NaN} />)).toContain("width:0%");
    expect(renderToStaticMarkup(<FillBar value={50} />)).toContain('aria-hidden="true"');
    const row = renderToStaticMarkup(<ul><BarRow name="octo" value={40} readout="40%" label="40% AI" /></ul>);
    expect(row).toContain("octo");
    expect(row).toContain('aria-label="40% AI"');
  });

  it("SortHead sets aria-sort and a direction glyph on the active column only", () => {
    const row = (active: boolean) =>
      renderToStaticMarkup(<table><thead><tr><SortHead active={active} dir="desc" onSort={() => {}} idle>Score</SortHead></tr></thead></table>);
    expect(row(true)).toContain('aria-sort="descending"');
    expect(row(true)).toContain("▼");
    expect(row(false)).not.toContain("aria-sort");
    expect(row(false)).toContain("↕");
  });

  it("Display and Caption render as inline elements on request", () => {
    expect(renderToStaticMarkup(<Display as="span" level="figure">12</Display>)).toMatch(/^<span /);
    expect(renderToStaticMarkup(<Caption as="span">note</Caption>)).toMatch(/^<span /);
  });
});

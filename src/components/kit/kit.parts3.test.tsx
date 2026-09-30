// Kit batch 3 (2026-09-30): DataTable options, the hue-versus-meaning treatments (DimensionLine shortfall,
// Masthead tone) and the Trend part. Static markup, so no DOM environment is needed.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DataTable, DimensionLine, Masthead, Trend, bandDomain } from "./index";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const head = <tr><th>A</th></tr>;

describe("DataTable options", () => {
  it("renders exactly the old markup when no option is set (Altimeter is unchanged)", () => {
    const out = html(<DataTable head={head}><tr><td>1</td></tr></DataTable>);
    expect(out).toContain("overflow-x-auto rounded-2xl border border-divider");
    expect(out).toContain('class="w-full type-body"');
    expect(out).toContain("bg-surface/60 type-label tracking-[0.2em] text-slate-500");
    expect(out).toContain("divide-y divide-divider");
    expect(out).not.toContain("<tfoot");
    expect(out).not.toContain("sticky");
    expect(out).toContain('data-density="comfortable"');
  });

  it("carries density, a foot, and the sticky modes as attributes and a tfoot", () => {
    const out = html(
      <DataTable head={head} density="compact" foot={<tr><td>avg</td></tr>} stickyHead="page" stickyFirstCol>
        <tr><td>1</td></tr>
      </DataTable>,
    );
    expect(out).toContain('data-density="compact"');
    expect(out).toContain('data-sticky="page"');
    expect(out).toContain('data-sticky-first-col="true"');
    expect(out).toContain('<tfoot data-role="data-table-foot" class="border-t border-divider">');
    expect(out).toContain("lg:overflow-visible");
    // The page-sticky head is drawn by th CSS, not by the thead itself.
    expect(out).not.toContain("sticky top-0");
  });

  it("scroll-sticky is the default whenever maxHeight is set, and off when it is not", () => {
    expect(html(<DataTable head={head} maxHeight="20rem"><tr /></DataTable>)).toContain("sticky top-0 z-10");
    expect(html(<DataTable head={head} maxHeight="20rem" stickyHead="page"><tr /></DataTable>)).not.toContain("sticky top-0");
  });

  it("plain hands the frame, row rules and type to the caller; sheet only tags the variant", () => {
    const plain = html(<DataTable head={head} variant="plain" tableClassName="w-full text-left"><tr /></DataTable>);
    expect(plain).toContain('data-variant="plain"');
    expect(plain).not.toContain("rounded-2xl");
    expect(plain).not.toContain("divide-y");
    expect(plain).not.toContain("type-body");
    expect(plain).toContain('class="w-full text-left"');
    const sheet = html(<DataTable head={head} variant="sheet"><tr /></DataTable>);
    expect(sheet).toContain('data-variant="sheet"');
    expect(sheet).toContain("rounded-2xl border border-divider");
  });

  it("size sm swaps the table type class; labelledBy makes a focusable named region", () => {
    expect(html(<DataTable head={head} size="sm"><tr /></DataTable>)).toContain("type-body-sm");
    const out = html(<DataTable head={head} labelledBy="h"><tr /></DataTable>);
    expect(out).toContain('role="region"');
    expect(out).toContain('tabindex="0"');
    expect(out).toContain('aria-labelledby="h"');
  });
});

describe("DimensionLine hue-versus-meaning", () => {
  it("draws a hatched shortfall from the value to the floor, hidden until Prism shows it", () => {
    const out = html(<DimensionLine dimension={3} label="CI" value={0.4} floor={0.65} />);
    const m = out.match(/<span[^>]*data-role="dimension-shortfall"[^>]*>/)?.[0] ?? "";
    expect(m).toContain("hidden");
    expect(m).toMatch(/left:40%/);
    expect(m).toMatch(/width:25%/);
    expect(m).toContain("repeating-linear-gradient(90deg, var(--spec-3, var(--color-accent)) 0 2px, transparent 2px 5px)");
    expect(m).toContain("opacity:0.45");
  });

  it("draws no shortfall at or above the floor, without a floor, or unmeasured", () => {
    expect(html(<DimensionLine dimension={1} label="x" value={0.7} floor={0.65} />)).not.toContain("dimension-shortfall");
    expect(html(<DimensionLine dimension={1} label="x" value={0.7} />)).not.toContain("dimension-shortfall");
    expect(html(<DimensionLine dimension={1} label="x" value={null} floor={0.65} />)).not.toContain("dimension-shortfall");
  });

  it("marks a healthy full-height bar so Prism can desaturate it", () => {
    expect(html(<DimensionLine dimension={2} label="x" value={0.85} />)).toContain('data-high="true"');
    expect(html(<DimensionLine dimension={2} label="x" value={0.84} />)).not.toContain("data-high");
  });
});

describe("Masthead tone", () => {
  it("carries status as data-tone, a leading glyph and a word, never as a hue", () => {
    const out = html(<Masthead statement="s" figures={[{ label: "L", value: 42, tone: "risk", color: "#ff0000" }]} />);
    expect(out).toContain('data-tone="risk"');
    expect(out).toContain("▲");
    expect(out).toContain("At risk: ");
    expect(out).not.toContain("#ff0000");
  });

  it("keeps the color prop working when no tone is given (Altimeter callers)", () => {
    expect(html(<Masthead statement="s" figures={[{ label: "L", value: 42, color: "#ff0000" }]} />)).toContain("color:#ff0000");
  });
});

describe("Trend", () => {
  it("is the kit part, sized 240x56, with band edges and first and last values printed", () => {
    const out = html(<Trend values={[50, 55, 61, 70]} label="last 30 days" />);
    expect(out).toContain('data-kit="trend"');
    expect(out).toContain('width="240" height="56"');
    expect(out).toContain('data-role="trend-first"');
    expect(out).toContain('data-role="trend-last"');
    expect(out).toContain('data-role="trend-end"');
    expect(out).toContain("aria-label=\"Maturity last 30 days: 50 to 70 over 4 scans\"");
    expect(out.match(/data-role="trend-edge"/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it("says so in words below the forecast minimum instead of drawing a line", () => {
    const out = html(<Trend values={[50, 61]} label="last 30 days" />);
    expect(out).toContain('data-role="trend-empty"');
    expect(out).toContain("2 of 3 scans");
    expect(out).not.toContain("<svg");
  });

  it("draws against the level bands touched, padded one band each side", () => {
    // 50 is L3 (45-64), 70 is L4 (65-84): domain L2..L5 = 25..100.
    const d = bandDomain([50, 55, 70]);
    expect([d.lo, d.hi]).toEqual([25, 100]);
    expect(d.edges.map((e) => e.level)).toEqual(["L2", "L3", "L4", "L5"]);
    // A series inside the bottom band pads only upward.
    expect(bandDomain([3, 10]).lo).toBe(0);
    expect(bandDomain([3, 10]).edges.map((e) => e.level)).toEqual(["L1", "L2"]);
  });
});

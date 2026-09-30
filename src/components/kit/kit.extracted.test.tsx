// Pins the parts extracted from hand-rolled look-alikes (Movement, VoidMark, FilterMenu, HairlineList,
// HairlineGrid): each carries its data-kit hook, and the Altimeter classes/markup the call sites used to
// spell out by hand survive as the parts' own.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterMenu, HairlineGrid, HairlineList, Movement, RowList, VoidMark } from "./index";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("extracted kit parts", () => {
  it("Movement prints the arrow, the magnitude, the basis and a spoken sentence", () => {
    const out = html(<Movement delta={4} basis="vs last week" title="why" />);
    expect(out).toContain('data-kit="movement"');
    expect(out).toContain('data-dir="up"');
    expect(out).toContain("▲4");
    expect(out).toContain("vs last week");
    expect(out).toContain("up 4 points vs last week");
    expect(html(<Movement delta={-2} />)).toContain("down 2 points this period");
  });

  it("Movement renders nothing for a held or missing delta, and honours a pinned tone class", () => {
    expect(html(<Movement delta={0} />)).toBe("");
    expect(html(<Movement delta={null} />)).toBe("");
    expect(html(<Movement delta={3} toneClass={(up) => (up ? "text-emerald-400" : "text-red-400")} />)).toContain('class="text-emerald-400"');
  });

  it("VoidMark is a role=img absence with the shared caveat, boxed on request", () => {
    const out = html(<VoidMark subject="Fleet average · D3" label="No fleet average for D3" />);
    expect(out).toContain('data-kit="void-mark"');
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="No fleet average for D3"');
    expect(out).toContain("Fleet average · D3");
    expect(html(<VoidMark boxed />)).toContain("h-7 w-9");
  });

  it("HairlineList is an open ruled list; RowList is the framed one", () => {
    const open = html(<HairlineList className="mt-3"><li>a</li></HairlineList>);
    expect(open).toContain('data-kit="hairline-list"');
    expect(open).toContain("divide-y divide-divider border-y border-divider mt-3");
    expect(html(<HairlineList as="div">x</HairlineList>)).toMatch(/^<div /);
    expect(html(<RowList radius="xl"><li>a</li></RowList>)).toContain("rounded-xl border border-divider");
  });

  it("HairlineGrid carries the ledger classes and the hook", () => {
    const out = html(<HairlineGrid className="lg:grid-cols-3">x</HairlineGrid>);
    expect(out).toContain('data-kit="hairline-grid"');
    expect(out).toContain("grid gap-px overflow-hidden rounded-2xl border border-divider bg-divider lg:grid-cols-3");
  });

  it("FilterMenu renders a closed trigger with the selection count and its hook", () => {
    const out = html(<FilterMenu label="Type" options={[{ value: "a", label: "A" }]} selected={new Set(["a"])} onToggle={() => {}} onClear={() => {}} />);
    expect(out).toContain('data-kit="filter-menu"');
    expect(out).toContain('aria-haspopup="listbox"');
    expect(out).toContain(">1<");
    expect(out).not.toContain('role="listbox"');
  });
});

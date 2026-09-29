// Pins the v2 primitives' contract: data-kit hooks and roles the Prism stylesheet keys on, the honesty rules
// (unmeasured is an empty track, invented content carries a tag), and the level chrome's accessibility.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DimensionLine, Display, EvidencePanel, Eyebrow, Frame, GhostAction, HonestyTag, LevelNav, Plate, PrimaryAction, SectionHead, SpectralRule,
} from "./index";

const html = (n: React.ReactElement) => renderToStaticMarkup(n);

describe("kit v2 type", () => {
  it("Display renders the statement and the named phrase as <b>", () => {
    const out = html(<Display as="h2" level="section" named="Nine lines out.">One line in.</Display>);
    expect(out).toContain('data-kit="display"');
    expect(out).toContain('data-level="section"');
    expect(out).toContain('<b data-role="display-named">Nine lines out.</b>');
    expect(out.startsWith("<h2")).toBe(true);
  });
  it("Eyebrow and SectionHead carry their hooks", () => {
    expect(html(<Eyebrow>x</Eyebrow>)).toContain('data-kit="eyebrow"');
    const head = html(<SectionHead eyebrow="E" title="T" named="N" lede="L" />);
    for (const k of ["section-head", "eyebrow", "display", "lede"]) expect(head).toContain(`data-kit="${k}"`);
  });
});

describe("kit v2 structure", () => {
  it("Frame draws hairlines, never a box", () => {
    const out = html(<Frame edge="both">x</Frame>);
    expect(out).toContain("border-y border-divider");
    expect(out).not.toContain("rounded");
  });
  it("DimensionLine: bar width is the clamped value, hue is the dimension's, unmeasured is an empty track", () => {
    const on = html(<DimensionLine dimension={4} label="Agentic" value={1.7} />);
    expect(on).toContain("width:100%");
    expect(on).toContain("var(--spec-4");
    const off = html(<DimensionLine dimension={7} label="Commits" value={null} />);
    expect(off).toContain("width:0%");
    expect(off).toContain("unmeasured");
    expect(html(<DimensionLine dimension={1} label="x" value={0.5} honesty="illustrative" />)).toContain("Illustrative");
  });
  it("EvidencePanel takes its hue from the dimension and numbers the excerpt", () => {
    const out = html(<EvidencePanel dimension={3} title="ci.yml" code={["a", "b"]} facts={[{ label: "k", value: "v" }]} honesty="illustrative" />);
    expect(out).toContain("--spec-3");
    expect(out).toContain('data-role="evidence-code"');
    expect(out).toContain("Illustrative");
    expect(out.match(/select-none/g)?.length).toBe(2);
  });
  it("Plate lights only the cells with evidence", () => {
    const out = html(<Plate name="Augmented" band={[45, 64]} cells={[true, false, true]} selected />);
    expect(out.match(/plate-cell-lit/g)?.length).toBe(2);
    expect(out.match(/plate-cell-dark/g)?.length).toBe(1);
  });
  it("LevelNav marks the current crumb and links Back / prev / next", () => {
    const out = html(<LevelNav trail={[{ label: "Ascent", href: "/" }, { label: "D3" }]} back={{ label: "Back", href: "/" }} prev={{ label: "P", href: "/p" }} next={{ label: "N", href: "/n" }} />);
    expect(out).toContain('aria-label="Level"');
    expect(out).toContain('aria-current="page"');
    for (const r of ["level-back", "level-prev", "level-next"]) expect(out).toContain(r);
  });
});

describe("kit v2 marks and actions", () => {
  it("HonestyTag labels both kinds", () => {
    expect(html(<HonestyTag kind="stylised" />)).toContain("Stylised");
    expect(html(<HonestyTag />)).toContain("Illustrative");
  });
  it("SpectralRule limits hues when asked", () => {
    expect(html(<SpectralRule dimensions={[1, 9]} />)).toContain("var(--spec-1, var(--color-accent)), var(--spec-9");
  });
  it("Primary and Ghost render links with the kind hook, buttons without href", () => {
    expect(html(<PrimaryAction href="/launch">Go</PrimaryAction>)).toMatch(/<a [^>]*data-kind="primary"/);
    expect(html(<GhostAction>Go</GhostAction>)).toMatch(/<button [^>]*data-kind="ghost"/);
  });
});

// Pins what the Prism stylesheet and the specimen depend on: every part renders its data-kit hook and
// stable data-role, and the Altimeter look survives as the parts' own classes (the un-themed baseline).
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Chip, DataTable, KeyValue, ListRow, ListRows, Panel, RowList, Section, Segmented, SettingRow, StatStrip, StatTile, Toolbar } from "./index";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("kit parts", () => {
  it("Panel keeps the Surface look and carries the hook, per tone and radius", () => {
    const base = html(<Panel>x</Panel>);
    expect(base).toContain('data-kit="panel"');
    expect(base).toContain("rounded-2xl border border-divider bg-surface/40");
    expect(base).toContain("p-6");
    expect(html(<Panel tone="strong" pad="none">x</Panel>)).toContain("bg-surface-strong/40");
    expect(html(<Panel tone="accent" radius="xl">x</Panel>)).toMatch(/data-tone="accent"[^>]*class="rounded-xl border border-accent\/25/);
  });

  it("Section wraps SectionHeading without changing its markup", () => {
    const out = html(<Section title="T" kicker="K" size="sm" />);
    expect(out).toContain('data-kit="section"');
    expect(out).toContain('data-size="sm"');
    expect(out).toContain(">T<");
  });

  it("StatStrip and StatTile keep the ledger classes; a href makes the tile a link", () => {
    const out = html(
      <StatStrip cols={3}>
        <StatTile label="A" value={1} />
        <StatTile label="B" value={2} href="#b" />
      </StatStrip>,
    );
    expect(out).toContain("gap-px overflow-hidden rounded-2xl border border-divider bg-divider sm:grid-cols-3");
    expect(out).toContain('<a href="#b"');
    expect(out.match(/data-kit="stat-tile"/g)).toHaveLength(2);
  });

  it("KeyValue renders one row per item in both layouts", () => {
    const items = [{ key: "a", value: "1" }, { key: "b", value: "2", hint: "h" }];
    expect(html(<KeyValue items={items} />).match(/data-role="key-value-row"/g)).toHaveLength(2);
    expect(html(<KeyValue items={items} layout="stack" />)).toContain('data-layout="stack"');
  });

  it("ListRow renders a link or a plain row, and only reserves the trailing column when given one", () => {
    const linked = html(<ListRows><ListRow href="/x" leading={1} title="t" trailing={<i />} /></ListRows>);
    expect(linked).toContain('href="/x"');
    expect(linked).toContain("sm:grid-cols-[minmax(0,1fr)_16rem]");
    const plain = html(<ListRow title="t" />);
    expect(plain).not.toContain("<a ");
    expect(plain).not.toContain("16rem");
  });

  it("RowList takes both radii", () => {
    expect(html(<RowList radius="xl">x</RowList>)).toContain("rounded-xl border border-divider");
  });

  it("Chip exposes its dimension for the Prism hue", () => {
    expect(html(<Chip dimension={4}>D4</Chip>)).toContain('data-dimension="4"');
  });

  it("Segmented marks the active option and renders links as links", () => {
    const buttons = html(<Segmented label="P" value="b" options={[{ key: "a", label: "A" }, { key: "b", label: "B" }]} />);
    expect(buttons).toContain('aria-pressed="true"');
    expect(buttons).toContain('role="group"');
    const links = html(<Segmented nav variant="soft" label="V" value="a" options={[{ key: "a", label: "A", href: "/a" }]} />);
    expect(links).toContain("<nav");
    expect(links).toContain('aria-current="page"');
  });

  it("Toolbar, SettingRow and DataTable carry their hooks", () => {
    expect(html(<Toolbar left="l" right="r" data-tour="x" />)).toContain('data-tour="x"');
    expect(html(<SettingRow label="L" control={<b />} />)).toContain('data-kit="setting-row"');
    const table = html(<DataTable head={<tr />} caption="c" maxHeight="10rem"><tr /></DataTable>);
    expect(table).toContain("sticky top-0");
    expect(table).toContain("max-height:10rem");
  });
});

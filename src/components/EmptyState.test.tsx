// Pins the canonical empty/notice primitive (src/components/EmptyState.tsx) — the one element every
// hand-rolled empty/error state routes through (SignInNotice, OrgEmpty, SectionEmpty, the trends
// empty/error states, the repo-picker empties). A regression in its conditional render branching
// multiplies across every empty surface in the product, and the page-variant title is the document
// <h1> (a11y), so we lock the render branches.
//
// EmptyState owns NO hooks (it is explicitly server/client safe), so — exactly like
// report-document.test.ts — we invoke the component function directly and walk the returned React
// element tree, asserting on node type / props / children. No jsdom / DOM render needed. The
// next/link <Link> appears in the tree as an element whose props carry `href`, which is all we read.
//
// The invariants this primitive must never break:
//   1. CORE PROPS RENDER — title, body and icon each appear when supplied (icon is aria-hidden).
//   2. VARIANT HEADING — variant="page" renders the title as an <h1> (the page heading); variant=
//      "section" renders it as a non-heading <div>.
//   3. ACTION-ROW GATING — the action row appears iff there are actions OR children; with neither it
//      is absent. Actions render as links carrying their href/label; primary vs non-primary pick the
//      accent vs outline class.
//   4. NO CRASH ON OMITTED OPTIONALS — every prop is optional; building the tree with none must not throw.

import { describe, it, expect } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { EmptyState, type EmptyStateAction } from "./EmptyState";

// ── React element-tree walker (pure; mirrors error.test.ts / report-document.test.ts) ───────────────
type El = ReactElement<{
  className?: string;
  href?: string;
  children?: ReactNode;
  "aria-hidden"?: unknown;
}>;

/** Depth-first list of every React element in the tree. */
function flatten(node: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const n of node) flatten(n, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as El;
  out.push(el);
  flatten(el.props?.children, out);
  return out;
}

/** Concatenate the primitive (string/number) descendants of a node into one string. */
function textOf(node: ReactNode): string {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node as El).props?.children);
  return "";
}

type Props = Parameters<typeof EmptyState>[0];

/** Build the flat element list for an EmptyState render. */
function tree(props: Props): El[] {
  return flatten(EmptyState(props));
}

/** Elements whose type is the next/link <Link> (a function/object component, not a host string). */
function links(els: El[]): El[] {
  return els.filter((el) => typeof el.type !== "string" && el.props?.href != null);
}

const action = (o: Partial<EmptyStateAction> = {}): EmptyStateAction => ({
  label: "Go",
  href: "/go",
  ...o,
});

describe("EmptyState — core props render", () => {
  it("renders the title text", () => {
    const els = tree({ title: "Nothing here yet" });
    expect(els.some((el) => textOf(el) === "Nothing here yet")).toBe(true);
  });

  it("renders the body text", () => {
    const els = tree({ title: "T", body: "Body copy goes here" });
    expect(els.some((el) => textOf(el) === "Body copy goes here")).toBe(true);
  });

  it("renders the icon as an aria-hidden node", () => {
    const els = tree({ icon: "📭", title: "T" });
    const iconNode = els.find((el) => textOf(el) === "📭");
    expect(iconNode).toBeDefined();
    expect(iconNode!.props["aria-hidden"]).toBe("true");
  });

  it("renders the alert node when provided", () => {
    const els = tree({ title: "T", alert: "Your session expired" });
    expect(els.some((el) => textOf(el).includes("Your session expired"))).toBe(true);
  });
});

describe("EmptyState — variant heading element (a11y)", () => {
  it('variant="page" renders the title as an <h1>', () => {
    const els = tree({ title: "Page Title", variant: "page" });
    const h1 = els.find((el) => el.type === "h1");
    expect(h1).toBeDefined();
    expect(textOf(h1!)).toBe("Page Title");
  });

  it('default variant (page) renders the title as an <h1>', () => {
    const els = tree({ title: "Defaults To Page" });
    expect(els.some((el) => el.type === "h1")).toBe(true);
  });

  it('variant="section" renders the title as a non-heading <div> (no <h1>)', () => {
    const els = tree({ title: "Section Title", variant: "section" });
    expect(els.some((el) => el.type === "h1")).toBe(false);
    const titleNode = els.find((el) => textOf(el) === "Section Title");
    expect(titleNode).toBeDefined();
    expect(titleNode!.type).toBe("div");
  });
});

describe("EmptyState — action row gating", () => {
  it("renders actions as links carrying their href and label", () => {
    const els = tree({ title: "T", actions: [action({ label: "Sign in", href: "/signin" })] });
    const ls = links(els);
    expect(ls).toHaveLength(1);
    expect(ls[0].props.href).toBe("/signin");
    expect(textOf(ls[0])).toBe("Sign in");
  });

  it("primary action uses the accent class; non-primary uses the outline class", () => {
    const els = tree({
      title: "T",
      actions: [action({ label: "Primary", href: "/p", primary: true }), action({ label: "Outline", href: "/o" })],
    });
    const ls = links(els);
    const primary = ls.find((el) => textOf(el) === "Primary")!;
    const outline = ls.find((el) => textOf(el) === "Outline")!;
    expect(primary.props.className).toContain("bg-accent");
    expect(outline.props.className).toContain("border");
    expect(outline.props.className).not.toContain("bg-accent");
  });

  it("renders children inside the action row alongside actions", () => {
    const els = tree({ title: "T", children: "CTA-CHILD", actions: [action()] });
    expect(els.some((el) => textOf(el).includes("CTA-CHILD"))).toBe(true);
    expect(links(els)).toHaveLength(1);
  });

  it("renders the action row when only children are present (no actions)", () => {
    const els = tree({ title: "T", children: "ONLY-CHILD" });
    expect(els.some((el) => textOf(el).includes("ONLY-CHILD"))).toBe(true);
    expect(links(els)).toHaveLength(0);
  });

  it("omits the action row entirely when there are no actions and no children", () => {
    const els = tree({ title: "T", body: "B" });
    expect(links(els)).toHaveLength(0);
    // No descendant carries the action-row flex layout class.
    expect(els.some((el) => (el.props.className ?? "").includes("flex-wrap"))).toBe(false);
  });
});

describe("EmptyState — no crash on omitted optionals", () => {
  it("does not throw when invoked with no props", () => {
    expect(() => tree({})).not.toThrow();
  });

  it("renders nothing but the wrapper when given no props (no icon/title/body/actions)", () => {
    const els = tree({});
    expect(els).toHaveLength(1); // just the outer <div> wrapper
    expect(els[0].type).toBe("div");
  });

  it("does not throw when title is omitted but actions are present", () => {
    expect(() => tree({ actions: [action()] })).not.toThrow();
  });
});

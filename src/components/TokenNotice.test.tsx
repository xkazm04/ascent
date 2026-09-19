// Pins the token-share failure panel (src/components/TokenNotice.tsx): expired / revoked / empty
// capability links used to render title+body and stop, which read as a peaceful empty and left the
// viewer with no way off the page. The panel must always offer Home, optionally Scan, and look like
// a failure (danger kicker + shared CTA classes), not like EmptyState's empty-success.

import { describe, it, expect } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { CTA_OUTLINE, CTA_PRIMARY } from "@/lib/ui";
import { TokenNotice } from "./TokenNotice";

type El = ReactElement<{
  className?: string;
  href?: string;
  children?: ReactNode;
}>;

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

function textOf(node: ReactNode): string {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node as El).props?.children);
  return "";
}

type Props = Parameters<typeof TokenNotice>[0];

function tree(props: Props): El[] {
  return flatten(TokenNotice(props));
}

function links(els: El[]): El[] {
  return els.filter((el) => typeof el.type !== "string" && el.props?.href != null);
}

describe("TokenNotice — recovery is always present", () => {
  it("always renders a Home link to /", () => {
    const ls = links(tree({ title: "Link expired or invalid", body: "Ask an owner for a fresh one." }));
    const home = ls.find((el) => el.props.href === "/");
    expect(home).toBeDefined();
    expect(textOf(home!)).toContain("Home");
  });

  it("still renders Home to / when a Scan CTA is also present", () => {
    const ls = links(tree({ title: "T", body: "B", repo: "acme/api" }));
    expect(ls.some((el) => el.props.href === "/")).toBe(true);
    expect(ls.some((el) => el.props.href === "/report?repo=acme%2Fapi")).toBe(true);
  });
});

describe("TokenNotice — Scan only when a repo is known", () => {
  it("does not offer a Scan CTA without a repo", () => {
    const ls = links(tree({ title: "T", body: "B" }));
    expect(ls).toHaveLength(1);
    expect(ls[0].props.href).toBe("/");
  });

  it("Scan is primary and Home is outline when a repo is known", () => {
    const ls = links(tree({ title: "T", body: "B", repo: "acme/api" }));
    const scan = ls.find((el) => textOf(el).startsWith("Scan "))!;
    const home = ls.find((el) => el.props.href === "/")!;
    expect(scan.props.className).toBe(CTA_PRIMARY);
    expect(home.props.className).toBe(CTA_OUTLINE);
  });

  it("Home uses the primary CTA class when it is the only recovery", () => {
    const home = links(tree({ title: "T", body: "B" }))[0];
    expect(home.props.className).toBe(CTA_PRIMARY);
  });
});

describe("TokenNotice — failure, not empty success", () => {
  it("renders the danger Unavailable kicker (not a quiet empty)", () => {
    const els = tree({ title: "Link revoked", body: "Ask an org owner for a fresh one." });
    const kicker = els.find((el) => textOf(el) === "Unavailable");
    expect(kicker).toBeDefined();
    expect(kicker!.props.className).toContain("text-danger");
  });

  it("still renders the title and body", () => {
    const els = tree({ title: "Link expired or invalid", body: "This shared war-room link is no longer valid." });
    expect(els.some((el) => textOf(el) === "Link expired or invalid")).toBe(true);
    expect(els.some((el) => textOf(el) === "This shared war-room link is no longer valid.")).toBe(true);
  });
});

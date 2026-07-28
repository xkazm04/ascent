// @vitest-environment jsdom
//
// The public register's three contracts, pinned at the page seam:
//
//  1. SERVER-RENDERED. The default export is an async SERVER component with no "use client" anywhere
//     in the ranking path — awaiting it and rendering the returned element produces the full board as
//     HTML, which is what a crawler sees. A client-only ranking would fail this outright.
//  2. NO PRIVATE REPO. Whatever the page is handed, nothing about a private repository is rendered —
//     the data layer's per-row refusal (data.test.ts) is the enforcement, this is the surface proof.
//  3. MOCK PROVENANCE SURVIVES. A preview-scored repo is never given a rank position and always
//     carries the `demo` qualifier — no code path renders it as an ordinary board entry.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { getPublicRegister } = vi.hoisted(() => ({ getPublicRegister: vi.fn() }));

vi.mock("@/lib/register/data", () => ({ getPublicRegister }));
// The shared site chrome suspends outside the Next runtime; it is not what this page owns.
vi.mock("@/components/Brand", () => ({
  SiteHeader: () => <header />,
  SiteFooter: () => <footer />,
}));
vi.mock("@/lib/db/mode", () => ({ getDbMode: () => "static", dbModeLabel: () => "a local database" }));

import LeaderboardPage, { generateMetadata } from "./page";
import type { RegisterEntry } from "@/lib/register/data";

function entry(over: Partial<RegisterEntry> = {}): RegisterEntry {
  const fullName = over.fullName ?? "acme/api";
  const [owner = "acme", name = "api"] = fullName.split("/");
  return {
    owner,
    name,
    fullName,
    level: "L3",
    levelName: "Established",
    overall: 70,
    adoption: 60,
    rigor: 80,
    dimensions: { D1: 70 },
    primaryLanguage: "TypeScript",
    stars: 5,
    scannedAt: "2026-07-20T00:00:00.000Z",
    href: `/report/${fullName}`,
    engineProvider: "anthropic",
    verified: true,
    ...over,
  };
}

const registry = (over: Record<string, unknown> = {}) => ({
  entries: [entry()],
  unverified: [],
  totalVerified: 1,
  totalRepos: 1,
  page: 1,
  perPage: 25,
  totalPages: 1,
  windowed: false,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("/leaderboard — server-rendered and crawlable", () => {
  it("has no 'use client' directive in the page or its ranking table", () => {
    // A DIRECTIVE, not the string — LeaderboardTable's header comment mentions "use client" precisely
    // to record that it must never carry one.
    const directive = (p: string) => /^\s*["']use client["']/m.test(readFileSync(join(process.cwd(), p), "utf8"));
    expect(directive("src/app/leaderboard/page.tsx")).toBe(false);
    expect(directive("src/components/leaderboard/LeaderboardTable.tsx")).toBe(false);
    expect(directive("src/components/leaderboard/RegisterPager.tsx")).toBe(false);
  });

  it("renders the ranking as HTML from the server component itself", async () => {
    getPublicRegister.mockResolvedValue(registry());
    render(await LeaderboardPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { level: 1, name: /AI-native register/i })).toBeTruthy();
    expect(screen.getByText("acme/api")).toBeTruthy();
    expect(screen.getByText("01")).toBeTruthy(); // a real board position
  });

  it("emits a self-referencing canonical + OpenGraph metadata per page", async () => {
    const p1 = await generateMetadata({ searchParams: Promise.resolve({}) });
    expect(p1.alternates?.canonical).toBe("/leaderboard");
    expect(p1.openGraph?.title).toBeTruthy();

    const p3 = await generateMetadata({ searchParams: Promise.resolve({ page: "3" }) });
    expect(p3.alternates?.canonical).toBe("/leaderboard?page=3");
  });

  it("offsets rank numbers by the page so page 2 doesn't restart at 01", async () => {
    getPublicRegister.mockResolvedValue(
      registry({ page: 2, perPage: 25, totalPages: 2, totalVerified: 26, entries: [entry()] }),
    );
    render(await LeaderboardPage({ searchParams: Promise.resolve({ page: "2" }) }));
    expect(screen.getByText("26")).toBeTruthy();
    // Pagination is anchor-based so a crawler can follow it.
    expect(screen.getByRole("link", { name: /Previous/i }).getAttribute("href")).toBe("/leaderboard");
  });
});

describe("/leaderboard — nothing private, nothing silently ranked", () => {
  it("renders no private repository (the data layer never hands one over)", async () => {
    // The producer's contract: private rows are dropped before the page ever sees them.
    getPublicRegister.mockResolvedValue(registry());
    const { container } = render(await LeaderboardPage({ searchParams: Promise.resolve({}) }));
    expect(container.innerHTML).not.toMatch(/private/i);
  });

  it("labels a mock-scored repo `demo` and refuses to give it a rank", async () => {
    getPublicRegister.mockResolvedValue(
      registry({
        entries: [],
        totalVerified: 0,
        totalPages: 1,
        unverified: [entry({ fullName: "acme/demo", engineProvider: "mock", verified: false, overall: 99 })],
      }),
    );
    render(await LeaderboardPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("demo")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: /Preview scans — not ranked/i })).toBeTruthy();
    // No board position anywhere — the unranked table draws an em dash instead.
    expect(screen.queryByText("01")).toBeNull();
    // …and the empty ranked state says WHY, rather than implying nothing was ever scanned.
    expect(screen.getByText(/Nothing model-scored yet/i)).toBeTruthy();
  });
});

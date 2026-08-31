// @vitest-environment jsdom
//
// UAT `TOMAS-L1-05` (recurrence 2, downgraded major → polish). On a configured-but-empty database the
// register's explicit empty state landed — and the counter above it survived, so the section headed
// "The register" opened by announcing "0 public repos rated" on a page whose whole proposition is
// "now it has an index". A count is a claim; zero is not one worth making.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PublicScanGallery } from "@/lib/db";
import { IndexGallery } from "./IndexGallery";

const row = (fullName: string) => ({
  fullName,
  owner: fullName.split("/")[0]!,
  name: fullName.split("/")[1]!,
  level: "L3",
  levelName: "Managed",
  overall: 71,
  adoption: 68,
  rigor: 74,
  dimensions: {},
  posture: "ai-native",
  primaryLanguage: "TypeScript",
  stars: 12,
  scannedAt: "2026-08-30T00:00:00Z",
  href: "/report/acme/web",
});

const gallery = (over: Partial<PublicScanGallery> = {}): PublicScanGallery =>
  ({ recent: [], topAiNative: [], totalRepos: 0, dbMode: "postgres", ...over }) as unknown as PublicScanGallery;

describe("IndexGallery — the register's counter", () => {
  it("says nothing about the corpus size when the corpus is empty", () => {
    render(<IndexGallery gallery={gallery()} />);
    expect(screen.queryByText(/repos? rated/i)).toBeNull();
    // …but the section still explains itself in words, which is the part that was already right.
    expect(screen.getByText(/No public scans yet/i)).toBeInTheDocument();
  });

  it("keeps the count — and the provenance stamp beside it — as soon as there is one repo", () => {
    render(<IndexGallery gallery={gallery({ totalRepos: 1, recent: [row("acme/web")] as never })} />);
    expect(screen.getByText(/1 public repo rated/i)).toBeInTheDocument();
    expect(screen.getByText(/Served live from/i)).toBeInTheDocument();
  });

  it("keeps the provenance stamp on an empty corpus — the counter goes, the honesty stays", () => {
    render(<IndexGallery gallery={gallery()} />);
    expect(screen.getByText(/Served live from/i)).toBeInTheDocument();
  });
});

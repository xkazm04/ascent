// GOLDEN-TRIO: do not lead with ROI. /about's hero lede and search snippet used to open the pitch
// with "the highest-ROI path…". The score is table stakes; the first sentence a visitor or crawler
// reads is score + ladder + evidence, the same three ingredients as siteDescription().

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { DIMENSIONS, LEVELS } from "@/lib/maturity/model";
import { DIMENSION_COUNT, LEVEL_COUNT, siteDescription } from "@/lib/site";

vi.mock("@/components/Brand", () => ({ SiteHeader: () => null }));
const { mockGallery } = vi.hoisted(() => ({ mockGallery: vi.fn() }));
vi.mock("@/components/about/AboutLanding", () => ({ AboutLanding: () => null }));
vi.mock("@/lib/db", () => ({ getPublicScanGallery: mockGallery }));
vi.mock("@/lib/scan-read-door", () => ({ degradeTo: <T,>(_read: string, fallback: T) => () => fallback }));

import AboutPage, { metadata, revalidate } from "./page";

const ROOT = process.cwd();
const SURFACE_DIRS = [join(ROOT, "src/app/about"), join(ROOT, "src/components/about")];

function walkSurfaces(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...walkSurfaces(p));
    else if (/\.(ts|tsx)$/.test(name.name) && !/\.test\./.test(name.name) && !/\.spec\./.test(name.name)) {
      out.push(p);
    }
  }
  return out;
}

const ROI_LEAD = /highest-ROI|highest ROI/i;

describe("/about does not lead with ROI", () => {
  const files = SURFACE_DIRS.flatMap(walkSurfaces);

  it("zero production surfaces contain highest-ROI", () => {
    expect(files.length).toBeGreaterThan(0);
    const hits = files.filter((p) => ROI_LEAD.test(readFileSync(p, "utf8")));
    expect(hits.map((p) => relative(ROOT, p).split("\\").join("/"))).toEqual([]);
  });

  it("the search snippet names score, ladder and evidence at the current rubric counts", () => {
    const description = String(metadata.description);
    expect(description).toContain(`${LEVEL_COUNT}-level`);
    expect(description).toContain(`${DIMENSION_COUNT} dimensions`);
    expect(description).toMatch(/score/i);
    expect(description).toMatch(/ladder/i);
    expect(description).toMatch(/evidence/i);
    expect(description).not.toMatch(ROI_LEAD);
  });

  it("those ingredients match siteDescription() (the site-wide snippet it must stay aligned with)", () => {
    const site = siteDescription();
    expect(site).toContain(`${LEVELS.length}-level`);
    expect(site).toContain(`${DIMENSIONS.length} dimensions`);
    expect(site).toMatch(/score/i);
    expect(site).toMatch(/ladder/i);
    expect(site).toMatch(/evidence/i);
    expect(site).not.toMatch(ROI_LEAD);
    expect(LEVEL_COUNT).toBe(LEVELS.length);
    expect(DIMENSION_COUNT).toBe(DIMENSIONS.length);
  });

  it("the hero interpolates the same model counts rather than typing them", () => {
    const hero = readFileSync(join(ROOT, "src/components/about/AboutHero.tsx"), "utf8");
    expect(hero).toMatch(
      /score on a \$\{LEVELS\.length\}-level maturity ladder across \$\{DIMENSIONS\.length\} dimensions/,
    );
    expect(hero).toMatch(/with evidence and a roadmap to the next level/);
  });
});

// Card about-1: the deck's X-Ray + ROI panes run on the cached public gallery. The page is the server
// boundary: it reads once, hands plain props to the client deck, and a failed read is the illustration.
describe("/about reads the public fleet on the server", () => {
  type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
  const landingProps = (tree: unknown) => {
    const kids = ((tree as El).props.children as El[]).flat();
    const landing = kids.find((k) => k && (k.props as { heroBg?: unknown }).heroBg !== undefined);
    expect(landing).toBeDefined();
    return landing!.props as { gallery?: unknown; heroBg?: string };
  };

  it("calls getPublicScanGallery({ recentLimit: 40 }) once and passes the result to AboutLanding", async () => {
    mockGallery.mockReset();
    const g = { recent: [], topAiNative: [], totalRepos: 0, dbMode: "static" };
    mockGallery.mockResolvedValue(g);
    const props = landingProps(await AboutPage());
    expect(mockGallery).toHaveBeenCalledTimes(1);
    expect(mockGallery).toHaveBeenCalledWith({ recentLimit: 40 });
    expect(props.gallery).toBe(g);
  });

  it("a rejected read degrades to null (the illustration), never a 500", async () => {
    mockGallery.mockReset();
    mockGallery.mockRejectedValue(new Error("Can't reach database server"));
    const props = landingProps(await AboutPage());
    expect(props.gallery).toBeNull();
  });

  it("revalidates on the gallery cache's 60 s window", () => {
    expect(revalidate).toBe(60);
  });
});

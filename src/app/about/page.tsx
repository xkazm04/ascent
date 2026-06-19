import type { Metadata } from "next";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SiteHeader } from "@/components/Brand";
import { AboutLanding } from "@/components/about/AboutLanding";

export const metadata: Metadata = {
  title: "About Ascent — the maturity index for AI-native engineering",
  description:
    "Ascent scores your organization's AI-development maturity and shows the highest-ROI path from manual development to a fully LLM-based, governed engineering org.",
};

// The hero's generated backdrop is optional depth — only pass it when the file exists, so the hero
// degrades to its CSS strata/glow instead of a broken image.
const HERO_BG = "/brand/proto/about-hero-bg.png";

export default function AboutPage() {
  const bg = existsSync(join(process.cwd(), "public", HERO_BG)) ? HERO_BG : undefined;
  return (
    <>
      <SiteHeader />
      <AboutLanding heroBg={bg} />
    </>
  );
}

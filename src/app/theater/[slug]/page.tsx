// /theater/<slug> — the standing runner's THEATER: a chrome-less, full-screen page for a passive third
// monitor (spark theater-upgrade, 2026-09-18). The shell, header, transport and cues live in
// src/features/inflight/live/theater/.
//
// WHY OUTSIDE /org/[slug]: that segment's layout wraps every page in OrgShell — header, rail, program
// strip, the guidance drawer — and a screen read from across the room must carry none of it. So this
// route sits beside it and REPEATS the shell's access gates, in the same order and with the same
// outcomes, instead of inheriting them: no database → the same notice; the Supabase wall without a
// viewer → the same sign-in (returning here); the retired session stack without a session → the same
// sign-in; a viewer who cannot read the org (`canReadOrg`) → the same "No access". The pulse route it
// polls repeats its own gate, so a page that slipped through would still read nothing.
//
// Query: `?sound=1` preselects sound (a click still has to unlock it — the page says so); `?hero=<id>`
// picks a hero from theaterHeroSlot.ts; `?demo=1|running|paused-spend|paused-session|idle|none`
// renders the FIXTURE on a deterministic clock (`&demoAt=<seconds>` starts it later). The demo reads no
// org data at all — it is the same page for every slug — so it skips the gates, which is what lets the
// prototype round run it on a box with no database.

import { TheaterShell } from "@/features/inflight/live/theater/TheaterShell";
import { demoScenario } from "@/features/inflight/live/theater/theaterFixture";
import { theaterGate } from "./theaterGate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Theater · Ascent", robots: { index: false, follow: false } };

type Search = Record<string, string | string[] | undefined>;
const one = (sp: Search, k: string): string | undefined => {
  const v = sp[k];
  return Array.isArray(v) ? v[0] : v;
};

export default async function TheaterPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const soundPreselect = one(sp, "sound") === "1";
  const heroId = one(sp, "hero") ?? null;
  const demo = one(sp, "demo");
  if (demo) {
    const startAtS = Math.max(0, Math.trunc(Number(one(sp, "demoAt"))) || 0);
    return <TheaterShell source={{ kind: "demo", slug, scenario: demoScenario(demo), startAtS }} soundPreselect={soundPreselect} heroId={heroId} />;
  }
  const denied = await theaterGate(slug);
  if (denied) return denied;
  return <TheaterShell source={{ kind: "org", slug }} soundPreselect={soundPreselect} heroId={heroId} />;
}

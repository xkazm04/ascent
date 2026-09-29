"use client";

// The Prism landing ("Read its spectrum"): the contest-winning brand and page, ported next to the current
// landing and selected with /?landing=prism. The server page renders the FAQ JSON-LD and passes the
// deployment's real wiring (demo org, source URL, sign-in mode); this owns everything the visitor sees.
//
// Nothing here re-implements the product: levels, dimensions, weights and posture labels are read from
// the rubric (prismModel.ts), and the scan dialog is the real ScanModal (its own trigger pressed by the
// calls to action, its `?scan=1` deep link as the no-script fallback), so the wall, quota meter and consent
// flow are the ones the current landing uses.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScanModal, type AuthMode } from "@/components/landing/prototypes/index/ScanModal";
import "./prism.css";
import { usePrefersReducedMotion, usePrismRoute } from "./hooks";
import { PrismBeyond } from "./PrismBeyond";
import { PrismBrand } from "./PrismBrand";
import { PrismDefs } from "./PrismDefs";
import { PrismHero } from "./PrismHero";
import { PrismLadder } from "./PrismLadder";
import { PrismLaunch } from "./PrismLaunch";
import { PrismLines } from "./PrismLines";
import { PrismMethod } from "./PrismMethod";
import { PrismScanProvider } from "./PrismScanLink";
import { PrismScene } from "./PrismScene";
import { PrismTop } from "./PrismTop";
import { PRISM_NAV_IDS } from "./prismNav";
import { DEFAULT_ARCHETYPE, lineHash, nextLine, prevLine, type Archetype } from "./prismModel";
import type { PrismLinks } from "./prismLinks";
import { useScene } from "./useScene";
import { usePrismHero } from "./usePrismHero";
import { usePrismScroll } from "./usePrismScroll";

export interface PrismLandingProps {
  links: PrismLinks;
  exampleRepos?: string[];
  auth: AuthMode;
  gated: boolean;
}

const go = (hash: string) => {
  window.location.hash = hash;
};

export function PrismLanding({ links, exampleRepos, auth, gated }: PrismLandingProps) {
  const reduced = usePrefersReducedMotion();
  const [arch, setArch] = useState<Archetype>(DEFAULT_ARCHETYPE);
  const route = usePrismRoute();
  const rootRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const scanHostRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const openLine = useCallback((i: number, from: HTMLElement | null) => {
    openerRef.current = from;
    go(lineHash(i));
  }, []);

  const hero = usePrismHero({ rootRef, heroRef, canvasRef, reduced, arch, paused: route != null, onOpen: openLine });
  const scene = useScene(route, reduced, hero.engineRef, flashRef);
  const scroll = usePrismScroll(PRISM_NAV_IDS);
  const mobile = hero.layout?.mobile ?? false;

  // Presses the real ScanModal's own (hidden) trigger; see PrismScanLink for why not the deep link.
  const openScan = useCallback(() => {
    const trigger = scanHostRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
    trigger?.click();
    return !!trigger;
  }, []);

  // One level up: evidence -> its line -> the page.
  const up = useCallback(() => {
    if (route?.e != null) go(lineHash(route.i));
    else go("#/");
  }, [route]);

  // The page's own document flags: smooth in-page scrolling and the Void backdrop while this landing is mounted.
  useEffect(() => {
    document.documentElement.setAttribute("data-prism", "");
    return () => document.documentElement.removeAttribute("data-prism");
  }, []);

  // The scene is a modal: freeze the page behind it, and hand focus back to whatever opened it.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (scene.open) {
      document.body.style.overflow = "hidden";
    } else if (wasOpen.current) {
      document.body.style.overflow = "";
      const o = openerRef.current;
      if (o && document.contains(o)) o.focus({ preventScroll: true });
    }
    wasOpen.current = scene.open;
    return () => {
      document.body.style.overflow = "";
    };
  }, [scene.open]);

  // Keys: 1-9 open a line from the top of the page; in a scene, Esc goes up and the arrows step lines.
  const keyState = useRef({ route, up });
  useEffect(() => {
    keyState.current = { route, up };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { route: r, up: back } = keyState.current;
      if (!r) {
        if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey && document.activeElement === document.body && window.scrollY < window.innerHeight * 0.5) {
          const i = Number(e.key) - 1;
          openLine(i, rootRef.current?.querySelectorAll<HTMLElement>(".ray-label")[i] ?? null);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        back();
      } else if (e.key === "ArrowRight" && r.e == null) go(lineHash(nextLine(r.i)));
      else if (e.key === "ArrowLeft" && r.e == null) go(lineHash(prevLine(r.i)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openLine]);

  const cls = useMemo(
    () => ["prism-root", hero.phase.ready && "ready", hero.phase.labels && "labels"].filter(Boolean).join(" "),
    [hero.phase.ready, hero.phase.labels],
  );

  return (
    <PrismScanProvider value={openScan}>
      <div ref={rootRef} className={cls}>
        <PrismDefs />
        <PrismTop links={links} paper={scroll.paper} active={scroll.active} progressRef={scroll.progressRef} />
        <main id="main" inert={scene.open}>
          <PrismHero
            heroRef={heroRef}
            canvasRef={canvasRef}
            links={links}
            layout={hero.layout}
            ready={hero.phase.ready}
            hover={hero.hover}
            shown={hero.shown}
            arch={arch}
            setArch={setArch}
            setHover={hero.setHover}
            onOpen={openLine}
            onSkip={() => hero.engineRef.current?.skipIntro()}
          />
          <PrismLines arch={arch} onOpen={openLine} />
          <PrismLadder arch={arch} reduced={reduced} />
          <PrismMethod />
          <PrismBeyond links={links} />
          <PrismBrand reduced={reduced} />
          <PrismLaunch links={links} />
        </main>
        <PrismScene
          index={scene.shownI}
          ev={route?.e ?? null}
          arch={arch}
          open={scene.open}
          live={scene.live}
          reduced={reduced}
          mobile={mobile}
          go={go}
          up={up}
        />
        <div className="flash" ref={flashRef} aria-hidden="true"></div>
        {/* The real scan dialog. Its own trigger is not part of this design: the calls to action press it
            (PrismScanLink), so it is kept out of the layout; the dialog itself portals to the app's modal host. */}
        <div hidden ref={scanHostRef}>
          <ScanModal examples={exampleRepos} auth={auth} gated={gated} />
        </div>
      </div>
    </PrismScanProvider>
  );
}

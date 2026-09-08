"use client";

// Where the scene keeps the viewer's language — the stand-in for an app's i18n store. The display
// primitives (primitives.tsx) read it through `useSceneLocale()`; no call site passes a locale, so
// none can forget one. (In the measured application, a primitive that ACCEPTED a locale prop and
// defaulted it was locale-blind at ~96% of call sites; binding the locale inside it fixed ~212 at
// once.) The context is the only way in: `override` exists for the rare fixed-locale render.

import { createContext, useContext } from "react";
import type { Locale } from "./vocabulary";

export const LocaleContext = createContext<Locale>("en-US");

export function useSceneLocale(override?: Locale): Locale {
  const active = useContext(LocaleContext);
  return override ?? active;
}
